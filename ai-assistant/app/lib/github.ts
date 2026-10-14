import { prisma } from '@/app/lib/prisma'
import type { Prisma } from '../generated/prisma/wasm.js'
import { sliceWindow } from '@/app/lib/truncate'
import { decodeBase64 } from '@/app/lib/base64'

/**
 * Integración con GitHub: lectura por defecto y escritura segura mediante PR.
 *
 * Por qué existe
 * --------------
 * El usuario quiere poder "agregar repositorios" y que ARIA los lea para
 * proponer ideas de arreglo (bugs, issues, deuda técnica). Los cambios nunca se
 * aplican a la rama principal: cuando el usuario lo pide de forma explícita se
 * crea una rama `aria/*`, se escriben allí los archivos y se abre un PR.
 *
 * Token
 * -----
 * `GITHUB_TOKEN` es OPCIONAL. Los repos públicos se pueden leer sin token, pero
 * el límite sin autenticar es de 60 peticiones/hora por IP; con un token
 * (fine-grained, `Contents: read` y `Issues: read`) sube a 5.000/hora. Para
 * crear PRs requiere además `Contents: write`, `Pull requests: write` y el
 * interruptor explícito `GITHUB_WRITE_ENABLED=true`.
 */

const GITHUB_API = 'https://api.github.com'

/**
 * Topes de tamaño de los resultados de GitHub (caracteres o número de items).
 * Se aplican en el origen para no arrastrar miles de tokens al contexto del
 * modelo en cada ronda. `readFile` se compensa con `offset`/`next_offset`.
 */
export const GITHUB_LIMITS = {
  readme: 1500,
  listFiles: 150,
  readFile: 8000,
  /** Líneas por defecto si se pide una ventana por rango de líneas. */
  readFileLines: 400,
  issues: 10,
  issueBody: 200,
  /**
   * Máximo de archivos por PR o por tanda de parches. Antes 5: con token el
   * rate limit (5000/h) no es el cuello de botella, así que el tope solo acota
   * el radio de explosión. 10 cubre un cambio lógico (renombrar una función y
   * ajustar sus llamadas) sin permitir refactors enormes en un solo PR.
   */
  writeFiles: 10,
  writeChars: 200_000,
  /** Operaciones {search, replace} por llamada a github_apply_patch. */
  patchOps: 20,
  /** Tamaño máximo de un bloque `search`, para que no se pueda "pegar el archivo entero" y borrarlo. */
  patchSearchChars: 20_000,
  /** Líneas netas eliminadas toleradas por archivo (eliminadas − añadidas). */
  patchMaxRemovedLines: 120,
  /** No se parchean archivos mayores: la Contents API devuelve contenido hasta ~1 MB. */
  patchFileBytes: 500_000,
  /** Check runs analizados por commit (se piden con filter=latest). */
  checkRuns: 50,
  /** Caracteres por mensaje de detalle de un check (salida o anotación). */
  checkTextChars: 300,
  /** Anotaciones leídas por cada check fallido. */
  checkAnnotations: 5,
} as const

export interface GithubRepoRef {
  /** Formato canónico `owner/repo`. */
  repo: string
  /** Comentario libre del usuario (para qué lo usa). */
  note?: string
  addedAt: string
}

const REPOS_KEY = 'github:repos'
// Los repos configurados no caducan de forma práctica (10 años).
const REPOS_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000

/**
 * Correcciones automáticas permitidas sobre una MISMA rama `aria/*`.
 *
 * Tras abrir un pull request (o aplicar el primer parche), ARIA puede corregir
 * ese mismo PR como máximo esta cantidad de veces. Sin este tope, un CI que
 * falla siempre por una causa que el modelo no entiende produce un bucle de
 * parches y de cuota. Al superarlo, `applyPatch` rechaza el parche y pide
 * revisión humana (no es un fallo: es la red de seguridad).
 */
export const MAX_FIX_ATTEMPTS = 2

/** Vigencia del contador de correcciones por rama (se limpia solo). */
const FIX_ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1000

export function hasGithubToken(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim())
}

export function githubWriteEnabled(): boolean {
  return process.env.GITHUB_WRITE_ENABLED?.trim().toLowerCase() === 'true'
}

/** Acepta `owner/repo`, URLs de GitHub y remotos SSH. Devuelve null si no es válido. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split(/[?#]/)[0]

  const parts = cleaned.split('/')
  if (parts.length < 2) return null
  const [owner, repo] = parts
  const valid = /^[A-Za-z0-9_.-]+$/
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null
  return { owner, repo }
}

export function canonicalRepo(input: string): string | null {
  const parsed = parseRepo(input)
  return parsed ? `${parsed.owner}/${parsed.repo}` : null
}

/* ------------------------- persistencia de repos ------------------------- */

export async function getRepos(): Promise<GithubRepoRef[]> {
  try {
    const row = await prisma.sessionContext.findUnique({ where: { key: REPOS_KEY } })
    const value = row?.value
    if (!Array.isArray(value)) return []
    return (value as unknown[]).filter(
      (r): r is GithubRepoRef =>
        typeof r === 'object' && r !== null && typeof (r as GithubRepoRef).repo === 'string',
    )
  } catch {
    return []
  }
}

async function saveRepos(repos: GithubRepoRef[]): Promise<void> {
  const expiresAt = new Date(Date.now() + REPOS_TTL_MS)
  const value = repos as unknown as Prisma.InputJsonValue
  await prisma.sessionContext.upsert({
    where: { key: REPOS_KEY },
    update: { value, expiresAt },
    create: { key: REPOS_KEY, value, expiresAt },
  })
}

export async function addRepo(
  input: string,
  note?: string,
): Promise<{ ok: true; repos: GithubRepoRef[] } | { ok: false; error: string }> {
  const canonical = canonicalRepo(input)
  if (!canonical) {
    return { ok: false, error: 'Formato inválido. Usa "owner/repo" o la URL del repositorio.' }
  }

  // Verifica que exista y sea accesible antes de guardarlo (evita typos).
  const check = await ghFetch(`/repos/${canonical}`)
  if (!check.ok) {
    return { ok: false, error: describeError(check.status, check.data) }
  }

  const repos = await getRepos()
  const trimmedNote = note?.trim().slice(0, 200)
  const existing = repos.find((r) => r.repo.toLowerCase() === canonical.toLowerCase())
  let next: GithubRepoRef[]
  if (existing) {
    existing.note = trimmedNote || existing.note
    next = repos
  } else {
    next = [{ repo: canonical, note: trimmedNote, addedAt: new Date().toISOString() }, ...repos]
  }
  await saveRepos(next)
  return { ok: true, repos: next }
}

export async function removeRepo(input: string): Promise<GithubRepoRef[]> {
  const canonical = canonicalRepo(input)
  const repos = await getRepos()
  const next = canonical
    ? repos.filter((r) => r.repo.toLowerCase() !== canonical.toLowerCase())
    : repos
  await saveRepos(next)
  return next
}

/* ------------------- correcciones automáticas por rama ------------------- */

/**
 * Contador de correcciones automáticas sobre una rama `aria/*`.
 *
 * Se guarda en `SessionContext` (igual que la lista de repos) porque el estado
 * debe sobrevivir entre turnos: la corrección de un PR ocurre en una petición
 * distinta a la de apertura. Es best-effort: si la base falla, se devuelve 0 y
 * no se bloquea nada (mejor un parche de más que romper la herramienta).
 */
function fixAttemptsKey(repo: string, branch: string): string {
  // `key` es único en la tabla y Postgres lo admite como texto; el límite es
  // solo para no guardar claves absurdas si llegara una rama gigante.
  return `github:fix:${repo.toLowerCase()}:${branch}`.slice(0, 200)
}

/** Correcciones ya registradas para una rama (0 si no hay datos o falla la DB). */
export async function getFixAttempts(repo: string, branch: string): Promise<number> {
  try {
    const row = await prisma.sessionContext.findUnique({
      where: { key: fixAttemptsKey(repo, branch) },
    })
    const value = row?.value as { count?: unknown } | null | undefined
    const count = value?.count
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

/** Suma una corrección a la rama y devuelve el total (o el previo si falla la DB). */
async function recordFixAttempt(repo: string, branch: string): Promise<number> {
  const key = fixAttemptsKey(repo, branch)
  const previous = await getFixAttempts(repo, branch)
  const next = previous + 1
  try {
    const expiresAt = new Date(Date.now() + FIX_ATTEMPTS_TTL_MS)
    const value = { count: next } as unknown as Prisma.InputJsonValue
    await prisma.sessionContext.upsert({
      where: { key },
      update: { value, expiresAt },
      create: { key, value, expiresAt },
    })
    return next
  } catch {
    return previous
  }
}

/* ------------------------------ API de GitHub ---------------------------- */

interface GhResult {
  ok: boolean
  status: number
  data: unknown
}

async function ghFetch(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<GhResult> {
  const token = process.env.GITHUB_TOKEN?.trim()
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ARIA-Assistant',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (err) {
    return { ok: false, status: 0, data: { message: String(err) } }
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data }
}

function describeError(status: number, data: unknown): string {
  const message =
    typeof data === 'object' && data !== null && typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : ''
  if (status === 404) return 'No encontré el repositorio o el archivo (¿es privado y falta GITHUB_TOKEN?).'
  if (status === 403 || status === 429) {
    return (
      'GitHub limitó las peticiones (rate limit). Sin GITHUB_TOKEN el límite es 60/hora; ' +
      'configura un token para subirlo a 5.000/hora. ' + message
    ).trim()
  }
  if (status === 401) return 'GITHUB_TOKEN inválido o caducado.'
  if (status === 409) return `GitHub rechazó el cambio por un conflicto: ${message || 'la rama cambió'}`
  if (status === 422) return `GitHub rechazó los datos del cambio: ${message || 'validación fallida'}`
  if (status === 0) return `No pude contactar con GitHub: ${message}`
  return `GitHub respondió ${status}${message ? `: ${message}` : ''}`
}

/* --------------------- escritura segura mediante pull request ----------- */

export interface GithubFileChange {
  path: string
  content: string
}

export interface GithubPullRequestInput {
  repo: string
  title: string
  body?: string
  branch?: string
  changes: GithubFileChange[]
}

function cleanRepoPath(path: string): string | null {
  const clean = path.trim().replace(/^\/+/, '').replace(/\\/g, '/')
  if (!clean || clean.includes('\0') || clean.split('/').some((part) => part === '..')) return null
  // Los workflows pueden ejecutar código con secretos y requieren permisos extra.
  if (clean.toLowerCase().startsWith('.github/workflows/')) return null
  return clean
}

function branchSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\.{2,}|\/{2,}/g, '-')
    .replace(/^[./-]+|[./-]+$/g, '')
    .slice(0, 60)
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Crea cambios únicamente en una rama nueva y abre un PR. No borra archivos,
 * no hace merge y nunca actualiza directamente la rama por defecto.
 */
export async function createPullRequest(input: GithubPullRequestInput): Promise<string> {
  const parsed = repoFrom(input.repo)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  if (!hasGithubToken()) return JSON.stringify({ error: 'Falta GITHUB_TOKEN para crear el pull request.' })
  if (!githubWriteEnabled()) {
    return JSON.stringify({
      error:
        'La escritura segura está desactivada. Define GITHUB_WRITE_ENABLED=true y usa un token ' +
        'fine-grained con Contents: write y Pull requests: write.',
    })
  }

  const title = input.title?.trim().slice(0, 200)
  if (!title) return JSON.stringify({ error: 'Falta el título del pull request.' })
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    return JSON.stringify({ error: 'El pull request necesita al menos un archivo.' })
  }
  if (input.changes.length > GITHUB_LIMITS.writeFiles) {
    return JSON.stringify({ error: `Máximo ${GITHUB_LIMITS.writeFiles} archivos por pull request.` })
  }

  const changes: GithubFileChange[] = []
  const seen = new Set<string>()
  let totalChars = 0
  for (const change of input.changes) {
    if (!change || typeof change.path !== 'string' || typeof change.content !== 'string') {
      return JSON.stringify({ error: 'Cada cambio necesita path y content de texto.' })
    }
    const path = cleanRepoPath(change.path)
    if (!path) {
      return JSON.stringify({
        error: `Ruta no permitida: "${change.path}". No se aceptan rutas relativas ni workflows.`,
      })
    }
    const key = path.toLowerCase()
    if (seen.has(key)) return JSON.stringify({ error: `Archivo repetido en el cambio: "${path}".` })
    seen.add(key)
    totalChars += change.content.length
    changes.push({ path, content: change.content })
  }
  if (totalChars > GITHUB_LIMITS.writeChars) {
    return JSON.stringify({ error: `Contenido total demasiado grande (máximo ${GITHUB_LIMITS.writeChars} caracteres).` })
  }

  const { owner, repo } = parsed
  const repoInfo = await ghFetch(`/repos/${owner}/${repo}`)
  if (!repoInfo.ok) return JSON.stringify({ error: describeError(repoInfo.status, repoInfo.data) })
  const base = (repoInfo.data as { default_branch?: string }).default_branch || 'main'

  const baseRef = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`)
  if (!baseRef.ok) return JSON.stringify({ error: describeError(baseRef.status, baseRef.data) })
  const baseSha = (baseRef.data as { object?: { sha?: string } }).object?.sha
  if (!baseSha) return JSON.stringify({ error: 'GitHub no devolvió el SHA de la rama principal.' })

  const requested = branchSlug(input.branch ?? title) || 'cambio'
  const branch = `aria/${requested}-${Date.now().toString(36)}`
  const createRef = await ghFetch(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: baseSha },
  })
  if (!createRef.ok) return JSON.stringify({ error: describeError(createRef.status, createRef.data) })

  const written: string[] = []
  for (const change of changes) {
    const encodedPath = change.path.split('/').map(encodeURIComponent).join('/')
    const current = await ghFetch(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    )
    if (!current.ok && current.status !== 404) {
      return JSON.stringify({
        error: describeError(current.status, current.data),
        branch,
        written,
        note: 'La rama quedó creada para poder revisar o recuperar el trabajo parcial.',
      })
    }
    const sha = current.ok ? (current.data as { sha?: string }).sha : undefined
    const update = await ghFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body: {
        message: `${title}: ${change.path}`.slice(0, 250),
        content: encodeBase64(change.content),
        branch,
        ...(sha ? { sha } : {}),
      },
    })
    if (!update.ok) {
      return JSON.stringify({
        error: describeError(update.status, update.data),
        branch,
        written,
        note: 'La rama quedó creada para poder revisar o recuperar el trabajo parcial.',
      })
    }
    written.push(change.path)
  }

  const pull = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: {
      title,
      head: branch,
      base,
      body:
        input.body?.trim().slice(0, 20_000) ||
        'Cambios preparados por ARIA en una rama aislada. Revisa las pruebas y el diff antes de fusionar.',
    },
  })
  if (!pull.ok) {
    return JSON.stringify({
      error: describeError(pull.status, pull.data),
      branch,
      written,
      note: 'Los commits están en la rama; solo falló la creación del pull request.',
    })
  }

  const data = pull.data as { number?: number; html_url?: string }
  return JSON.stringify({
    success: true,
    repo: `${owner}/${repo}`,
    base,
    branch,
    files: written,
    pull_request: data.number ?? null,
    url: data.html_url ?? null,
    merged: false,
    note: 'No se modificó la rama principal. El cambio requiere revisión y merge manual.',
  })
}

function repoFrom(input: string): { owner: string; repo: string } | null {
  return parseRepo(input)
}

/* ------------------------- edición precisa por parches ------------------- */

export interface GithubPatchOp {
  path: string
  /** Bloque literal a encontrar; debe coincidir EXACTAMENTE una vez. */
  search: string
  /** Texto que reemplaza a `search`. */
  replace: string
  /** SHA del blob que se leyó con github_read_file; si no coincide, se aborta. */
  baseSha?: string
}

export interface GithubApplyPatchInput {
  repo: string
  title: string
  body?: string
  /** Rama `aria/*` existente. Si se omite, se crea una rama nueva y un PR. */
  branch?: string
  patches: GithubPatchOp[]
}

/** Número de líneas de un fragmento ('' = 0). */
function countLines(value: string): number {
  return value === '' ? 0 : value.split('\n').length
}

/**
 * Aplica una lista de {search, replace} sobre el TEXTO de un archivo.
 *
 * Reglas de seguridad (fallan con mensaje claro, sin tocar nada):
 * - `search` no puede ser vacío.
 * - `search` debe aparecer EXACTAMENTE una vez (0 = no está; >1 = ambiguo).
 * - El bloque `search` no puede superar `patchSearchChars`.
 * - No puede eliminarse más de `patchMaxRemovedLines` líneas netas.
 * - No puede dejar el archivo vacío si antes tenía contenido.
 *
 * Tolerancia a saltos de línea: compara sobre texto normalizado a `\n` y, al
 * terminar, restaura los `\r\n` originales del archivo. Así el modelo puede
 * copiar el bloque con `\n` aunque el archivo use CRLF, sin corromperlo.
 */
export function applyTextPatches(
  text: string,
  ops: { search: string; replace: string }[],
): { ok: true; content: string } | { ok: false; error: string } {
  const usesCrlf = text.includes('\r\n')
  let work = text.replace(/\r\n/g, '\n')
  let removed = 0
  let added = 0

  for (const op of ops) {
    if (!op.search) {
      return { ok: false, error: 'Cada parche necesita un bloque "search" no vacío.' }
    }
    const search = op.search.replace(/\r\n/g, '\n')
    const replace = op.replace.replace(/\r\n/g, '\n')

    if (search.length > GITHUB_LIMITS.patchSearchChars) {
      return {
        ok: false,
        error: `El bloque "search" es demasiado grande (máximo ${GITHUB_LIMITS.patchSearchChars} caracteres).`,
      }
    }

    const first = work.indexOf(search)
    if (first === -1) {
      return {
        ok: false,
        error:
          'El bloque "search" no aparece en el archivo. Copialo exactamente como lo ' +
          'devolvió github_read_file (con su indentación) o volvé a leerlo: pudo cambiar.',
      }
    }
    if (work.indexOf(search, first + 1) !== -1) {
      return {
        ok: false,
        error:
          'El bloque "search" aparece más de una vez. Incluí más contexto ' +
          '(líneas vecinas) para que sea único.',
      }
    }

    const before = countLines(search)
    const after = countLines(replace)
    removed += Math.max(0, before - after)
    added += Math.max(0, after - before)

    work = work.slice(0, first) + replace + work.slice(first + search.length)
  }

  const net = removed - added
  if (net > GITHUB_LIMITS.patchMaxRemovedLines) {
    return {
      ok: false,
      error:
        `El parche elimina demasiadas líneas (${net} netas, máximo ` +
        `${GITHUB_LIMITS.patchMaxRemovedLines}). Si es intencional, reescribí el archivo ` +
        'completo con github_create_pull_request.',
    }
  }
  if (work.length === 0 && text.length > 0) {
    return { ok: false, error: 'El parche dejaría el archivo vacío. Rechazado por seguridad.' }
  }

  return { ok: true, content: usesCrlf ? work.replace(/\n/g, '\r\n') : work }
}

/**
 * Aplica parches {path, search, replace} y los commitea. Reutiliza TODAS las
 * protecciones de `createPullRequest`: requiere token y `GITHUB_WRITE_ENABLED`,
 * valida rutas (bloquea `.github/workflows/` y `..`), nunca toca la rama por
 * defecto, nunca fusiona y nunca borra archivos.
 *
 * - Sin `branch`: crea una rama `aria/*` nueva desde la rama por defecto y abre
 *   un PR (igual que createPullRequest, pero editando, no reescribiendo).
 * - Con `branch` (debe empezar por `aria/`): commitea ahí, pensado para
 *   corregir un PR ya abierto en la misma rama.
 */
export async function applyPatch(input: GithubApplyPatchInput): Promise<string> {
  const parsed = repoFrom(input.repo)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  if (!hasGithubToken()) return JSON.stringify({ error: 'Falta GITHUB_TOKEN para aplicar el parche.' })
  if (!githubWriteEnabled()) {
    return JSON.stringify({
      error:
        'La escritura segura está desactivada. Define GITHUB_WRITE_ENABLED=true y usa un token ' +
        'fine-grained con Contents: write y Pull requests: write.',
    })
  }

  const title = input.title?.trim().slice(0, 200)
  if (!title) return JSON.stringify({ error: 'Falta el título del pull request.' })
  if (!Array.isArray(input.patches) || input.patches.length === 0) {
    return JSON.stringify({ error: 'El parche necesita al menos una operación {path, search, replace}.' })
  }
  if (input.patches.length > GITHUB_LIMITS.patchOps) {
    return JSON.stringify({ error: `Máximo ${GITHUB_LIMITS.patchOps} operaciones por llamada.` })
  }

  // Validación y agrupación por archivo, respetando el orden de llegada.
  const files = new Map<string, { path: string; ops: GithubPatchOp[] }>()
  for (const op of input.patches) {
    if (
      !op ||
      typeof op.path !== 'string' ||
      typeof op.search !== 'string' ||
      typeof op.replace !== 'string'
    ) {
      return JSON.stringify({ error: 'Cada parche necesita path, search y replace de texto.' })
    }
    if (!op.search) {
      return JSON.stringify({ error: 'Cada parche necesita un bloque "search" no vacío.' })
    }
    if (op.baseSha !== undefined && typeof op.baseSha !== 'string') {
      return JSON.stringify({ error: 'baseSha debe ser texto.' })
    }
    if (op.search.length > GITHUB_LIMITS.patchSearchChars) {
      return JSON.stringify({
        error: `El bloque "search" de "${op.path}" es demasiado grande (máximo ${GITHUB_LIMITS.patchSearchChars} caracteres).`,
      })
    }
    const path = cleanRepoPath(op.path)
    if (!path) {
      return JSON.stringify({
        error: `Ruta no permitida: "${op.path}". No se aceptan rutas relativas ni workflows.`,
      })
    }
    const key = path.toLowerCase()
    const entry = files.get(key)
    if (entry) entry.ops.push({ ...op, path })
    else files.set(key, { path, ops: [{ ...op, path }] })
  }
  if (files.size > GITHUB_LIMITS.writeFiles) {
    return JSON.stringify({ error: `Máximo ${GITHUB_LIMITS.writeFiles} archivos por parche.` })
  }

  const { owner, repo } = parsed
  const repoInfo = await ghFetch(`/repos/${owner}/${repo}`)
  if (!repoInfo.ok) return JSON.stringify({ error: describeError(repoInfo.status, repoInfo.data) })
  const base = (repoInfo.data as { default_branch?: string }).default_branch || 'main'

  // Rama objetivo: una nueva `aria/*` (y PR) o una existente para corregir.
  let branch: string
  let createdBranch = false
  const requestedBranch = input.branch?.trim()
  if (requestedBranch) {
    const valid = /^aria\/[A-Za-z0-9._/-]+$/.test(requestedBranch) && !requestedBranch.includes('..')
    if (!valid) {
      return JSON.stringify({ error: 'Solo puedo aplicar parches sobre una rama "aria/*".' })
    }
    const refRes = await ghFetch(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(requestedBranch)}`,
    )
    if (!refRes.ok) {
      return JSON.stringify({
        error: `No encontré la rama "${requestedBranch}": ${describeError(refRes.status, refRes.data)}`,
      })
    }
    branch = requestedBranch
    // Tope de correcciones por PR: evita el bucle "CI falla → parcheo → CI
    // falla" cuando la causa se le escapa al modelo. Al superarlo se para y se
    // pide revisión humana.
    const attempts = await getFixAttempts(`${owner}/${repo}`, branch)
    if (attempts >= MAX_FIX_ATTEMPTS) {
      return JSON.stringify({
        error:
          `La rama "${branch}" ya recibió ${attempts} correcciones automáticas ` +
          `(máximo ${MAX_FIX_ATTEMPTS}). No aplico más parches automáticos: revisá ` +
          'el pull request a mano.',
        branch,
        fix_attempts: attempts,
        fix_attempts_max: MAX_FIX_ATTEMPTS,
      })
    }
  } else {
    const baseRef = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`)
    if (!baseRef.ok) return JSON.stringify({ error: describeError(baseRef.status, baseRef.data) })
    const baseSha = (baseRef.data as { object?: { sha?: string } }).object?.sha
    if (!baseSha) return JSON.stringify({ error: 'GitHub no devolvió el SHA de la rama principal.' })
    const requested = branchSlug(title) || 'parche'
    branch = `aria/${requested}-${Date.now().toString(36)}`
    const createRef = await ghFetch(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    })
    if (!createRef.ok) return JSON.stringify({ error: describeError(createRef.status, createRef.data) })
    createdBranch = true
  }

  const partialNote = createdBranch
    ? { note: 'La rama quedó creada para poder revisar o recuperar el trabajo parcial.' }
    : { note: 'La rama existente conserva los commits ya aplicados.' }

  const written: string[] = []
  for (const { path, ops } of files.values()) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const current = await ghFetch(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    )
    if (current.status === 404) {
      return JSON.stringify({
        error: `El archivo "${path}" no existe en la rama. Para crearlo usá github_create_pull_request.`,
        branch,
        written,
        ...partialNote,
      })
    }
    if (!current.ok) {
      return JSON.stringify({ error: describeError(current.status, current.data), branch, written, ...partialNote })
    }

    const d = current.data as { content?: string; encoding?: string; size?: number; sha?: string; type?: string }
    if (d.type === 'dir') {
      return JSON.stringify({ error: `"${path}" es un directorio.`, branch, written, ...partialNote })
    }
    if (!d.content || d.encoding !== 'base64') {
      return JSON.stringify({
        error: `No pude leer "${path}" para parchearlo (archivo demasiado grande o binario).`,
        size: d.size ?? null,
        branch,
        written,
        ...partialNote,
      })
    }
    if ((d.size ?? 0) > GITHUB_LIMITS.patchFileBytes) {
      return JSON.stringify({
        error: `"${path}" supera el límite de ${GITHUB_LIMITS.patchFileBytes} bytes para parchear. Usá github_create_pull_request o editalo por partes.`,
        size: d.size ?? null,
        branch,
        written,
        ...partialNote,
      })
    }

    // Concurrencia: el modelo puede reenviar el sha que leyó. Si cambió, se aborta
    // ANTES de escribir (además, el PUT con `sha` caducado lo rechaza GitHub).
    const knownSha = ops.find((o) => o.baseSha)?.baseSha
    if (knownSha && d.sha && knownSha !== d.sha) {
      return JSON.stringify({
        error: `El archivo "${path}" cambió desde que lo leíste (SHA distinto). Volvé a leerlo con github_read_file y regenerá el parche.`,
        branch,
        written,
        ...partialNote,
      })
    }

    const text = decodeBase64(d.content)
    const applied = applyTextPatches(text, ops)
    if (!applied.ok) {
      return JSON.stringify({
        error: `No pude aplicar el parche en "${path}": ${applied.error}`,
        branch,
        written,
        ...partialNote,
      })
    }
    if (applied.content === text) {
      return JSON.stringify({
        error: `El parche en "${path}" no cambia nada (search y replace son iguales).`,
        branch,
        written,
        ...partialNote,
      })
    }

    const update = await ghFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body: {
        message: `${title}: ${path}`.slice(0, 250),
        content: encodeBase64(applied.content),
        branch,
        ...(d.sha ? { sha: d.sha } : {}),
      },
    })
    if (!update.ok) {
      return JSON.stringify({
        error: describeError(update.status, update.data),
        branch,
        written,
        ...partialNote,
      })
    }
    written.push(path)
  }

  let pullNumber: number | null = null
  let pullUrl: string | null = null
  if (createdBranch) {
    const pull = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: {
        title,
        head: branch,
        base,
        body:
          input.body?.trim().slice(0, 20_000) ||
          'Cambios precisos preparados por ARIA en una rama aislada. Revisa el diff antes de fusionar.',
      },
    })
    if (!pull.ok) {
      return JSON.stringify({
        error: describeError(pull.status, pull.data),
        branch,
        written,
        note: 'Los commits están en la rama; solo falló la creación del pull request.',
      })
    }
    const data = pull.data as { number?: number; html_url?: string }
    pullNumber = data.number ?? null
    pullUrl = data.html_url ?? null
  }

  // Corrección sobre un PR abierto: se cuenta para el tope de arriba. El
  // parche inicial (rama nueva) no cuenta, es la primera propuesta.
  const fixAttempts = createdBranch ? 0 : await recordFixAttempt(`${owner}/${repo}`, branch)

  return JSON.stringify({
    success: true,
    repo: `${owner}/${repo}`,
    base,
    branch,
    files: written,
    pull_request: pullNumber,
    url: pullUrl,
    merged: false,
    fix_attempts: fixAttempts,
    fix_attempts_max: MAX_FIX_ATTEMPTS,
    note: createdBranch
      ? 'No se modificó la rama principal. El cambio requiere revisión y merge manual.'
      : `Parche agregado a la rama existente (corrección ${fixAttempts} de ${MAX_FIX_ATTEMPTS}). ` +
        'Consultá los checks con github_get_check_runs antes de darlo por bueno.',
  })
}

/* ---------------------- verificación del CI (solo lectura) --------------- */

export interface GithubCheckRunsInput {
  repo: string
  /** Número de pull request (preferido). */
  pr?: unknown
  /** Rama (por ejemplo la `aria/*`) si no se tiene el número del PR. */
  branch?: unknown
}

interface GhCheckRun {
  id?: number
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  details_url?: string
  output?: { title?: string; summary?: string; annotations_count?: number }
}

interface GhStatusItem {
  state?: string
  context?: string
  description?: string
  target_url?: string
}

interface GhAnnotation {
  path?: string
  start_line?: number
  annotation_level?: string
  message?: string
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

/** Colapsa espacios y recorta un texto para que no infle el contexto. */
function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * Estado del CI de un commit (solo lectura).
 *
 * Reúne las DOS fuentes de GitHub, porque los CI modernos y los antiguos usan
 * APIs distintas:
 * - Checks API (`/commits/{sha}/check-runs`): lo que generan GitHub Actions y
 *   la mayoría de CI modernos, un *check run* por job.
 * - Status API (`/commits/{sha}/status`): CI antiguos que publican un estado.
 *
 * Para el detalle del fallo se leen las **anotaciones** del check (archivo,
 * línea, mensaje) y su `output`. LÍMITE HONESTO: el log completo de Actions no
 * se puede leer de forma práctica desde la API (devuelve un ZIP y exige
 * `actions: read`), así que cuando no hay anotaciones se dice y se apunta al
 * check en GitHub en vez de inventar la causa.
 *
 * Detecta cambios concurrentes devolviendo el SHA del commit consultado: tras
 * un parche de corrección, los checks que importan son los del commit NUEVO.
 */
export async function getCheckRuns(input: GithubCheckRunsInput): Promise<string> {
  const parsed = repoFrom(input.repo)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  const { owner, repo } = parsed
  const fullRepo = `${owner}/${repo}`

  const prNumber = asPositiveInt(input.pr)
  const requestedBranch = typeof input.branch === 'string' ? input.branch.trim() : ''
  if (!prNumber && !requestedBranch) {
    return JSON.stringify({
      error: 'Indicá "pr" (número de pull request) o "branch" para saber qué commit revisar.',
    })
  }

  // 1) Resolver el commit a consultar y los metadatos del PR.
  let sha = ''
  let branch: string | null = requestedBranch || null
  let base: string | null = null
  const prMeta: Record<string, unknown> = {}
  const warnings: string[] = []

  if (prNumber) {
    const prRes = await ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`)
    if (!prRes.ok) return JSON.stringify({ error: describeError(prRes.status, prRes.data) })
    const p = prRes.data as {
      title?: string
      state?: string
      merged?: boolean
      draft?: boolean
      html_url?: string
      head?: { sha?: string; ref?: string }
      base?: { ref?: string }
    }
    sha = p.head?.sha ?? ''
    if (!sha) return JSON.stringify({ error: 'GitHub no devolvió el commit del pull request.' })
    branch = p.head?.ref ?? branch
    base = p.base?.ref ?? null
    prMeta.pr = prNumber
    prMeta.pr_title = p.title ?? null
    prMeta.pr_state = p.state ?? null
    prMeta.pr_merged = p.merged === true
    prMeta.pr_draft = p.draft === true
    prMeta.pr_url = p.html_url ?? null
    if (p.merged === true) {
      warnings.push('El pull request ya fue fusionado; estos checks son del último commit de su rama.')
    }
  } else {
    const brRes = await ghFetch(`/repos/${owner}/${repo}/branches/${encodeURIComponent(requestedBranch)}`)
    if (!brRes.ok) {
      return JSON.stringify({
        error: `No encontré la rama "${requestedBranch}": ${describeError(brRes.status, brRes.data)}`,
      })
    }
    const b = brRes.data as { commit?: { sha?: string }; name?: string }
    sha = b.commit?.sha ?? ''
    if (!sha) return JSON.stringify({ error: 'GitHub no devolvió el commit de la rama.' })
    branch = b.name ?? requestedBranch
  }

  // 2) Leer checks y estados del commit (en paralelo).
  const [runsRes, statusRes] = await Promise.all([
    ghFetch(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/check-runs` +
        `?per_page=${GITHUB_LIMITS.checkRuns}&filter=latest`,
    ),
    ghFetch(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/status`),
  ])
  if (!runsRes.ok && !statusRes.ok) {
    return JSON.stringify({ error: describeError(runsRes.status, runsRes.data) })
  }

  let runs: GhCheckRun[] = []
  if (runsRes.ok) {
    runs = ((runsRes.data as { check_runs?: GhCheckRun[] }).check_runs ?? []).slice(
      0,
      GITHUB_LIMITS.checkRuns,
    )
  } else if (runsRes.status === 403) {
    warnings.push(
      'No pude leer los check runs (¿falta el permiso "Checks: read" en el token, o saltó el rate limit?): ' +
        describeError(runsRes.status, runsRes.data),
    )
  } else {
    warnings.push(`No pude leer los check runs: ${describeError(runsRes.status, runsRes.data)}`)
  }

  let statusItems: GhStatusItem[] = []
  if (statusRes.ok) {
    const s = statusRes.data as { statuses?: GhStatusItem[] }
    statusItems = Array.isArray(s.statuses) ? s.statuses : []
  } else {
    warnings.push(`No pude leer los estados del commit: ${describeError(statusRes.status, statusRes.data)}`)
  }

  // 3) Agregar el resultado.
  let passed = 0
  let failed = 0
  let pending = 0
  let neutral = 0
  const failures: GhCheckRun[] = []
  for (const run of runs) {
    if (run.status !== 'completed') {
      pending++
      continue
    }
    const conclusion = run.conclusion ?? ''
    if (conclusion === 'success') passed++
    else if (conclusion === 'skipped' || conclusion === 'neutral') neutral++
    else {
      failed++
      failures.push(run)
    }
  }

  let statusFailure = 0
  let statusPending = 0
  for (const item of statusItems) {
    if (item.state === 'failure' || item.state === 'error') statusFailure++
    else if (item.state === 'pending') statusPending++
  }

  const total = runs.length + statusItems.length
  let state: 'success' | 'failure' | 'pending' | 'none'
  if (failed > 0 || statusFailure > 0) state = 'failure'
  else if (pending > 0 || statusPending > 0) state = 'pending'
  else if (total === 0) state = 'none'
  else state = 'success'

  // 4) Detalle de los fallos: salida del check + anotaciones (máx. 5 checks).
  const MAX_DETAIL_RUNS = 5
  const failedChecks: Record<string, unknown>[] = []
  for (const run of failures.slice(0, MAX_DETAIL_RUNS)) {
    const entry: Record<string, unknown> = {
      name: run.name ?? '(sin nombre)',
      conclusion: run.conclusion ?? null,
      url: run.html_url ?? run.details_url ?? null,
    }
    const title = clip(run.output?.title, GITHUB_LIMITS.checkTextChars)
    const summary = clip(run.output?.summary, GITHUB_LIMITS.checkTextChars)
    if (title || summary) entry.detail = [title, summary].filter(Boolean).join(' — ')

    if (typeof run.id === 'number') {
      const annRes = await ghFetch(`/repos/${owner}/${repo}/check-runs/${run.id}/annotations`)
      if (annRes.ok && Array.isArray(annRes.data)) {
        const annotations = (annRes.data as GhAnnotation[])
          .slice(0, GITHUB_LIMITS.checkAnnotations)
          .map((a) => {
            const where = a.path ? `${a.path}${a.start_line ? `:${a.start_line}` : ''}` : ''
            const message = clip(a.message, GITHUB_LIMITS.checkTextChars)
            return `${where ? `${where} ` : ''}${message}`.trim()
          })
          .filter(Boolean)
        if (annotations.length > 0) entry.annotations = annotations
      }
    }
    failedChecks.push(entry)
  }
  if (failures.length > MAX_DETAIL_RUNS) {
    warnings.push(`Hay ${failures.length} checks fallidos; muestro el detalle de ${MAX_DETAIL_RUNS}.`)
  }

  if (failed > 0 || statusFailure > 0) {
    const hasDetail = failedChecks.some((c) => c.detail || c.annotations)
    warnings.push(
      hasDetail
        ? 'El detalle sale de la salida y las anotaciones del check; el log completo de Actions no es legible vía API (amplíalo en GitHub si hace falta).'
        : 'No pude leer el detalle del fallo (sin anotaciones ni salida). Abrí el check en GitHub: el log completo no es legible vía API.',
    )
  }

  // 5) Cuántas correcciones automáticas lleva la rama (para no pasar del tope).
  const fixAttempts = branch ? await getFixAttempts(fullRepo, branch) : null

  return JSON.stringify({
    repo: fullRepo,
    ...prMeta,
    branch,
    base,
    sha,
    auth: hasGithubToken() ? 'token' : 'anónimo (60 req/hora)',
    state,
    counts: { check_runs: runs.length, statuses: statusItems.length },
    passed,
    failed,
    pending,
    neutral,
    failed_checks: failedChecks,
    fix_attempts: fixAttempts,
    fix_attempts_max: branch ? MAX_FIX_ATTEMPTS : null,
    warnings: warnings.length > 0 ? warnings : undefined,
    note:
      state === 'success'
        ? 'Todos los checks pasaron; recién ahora el cambio puede darse por listo.'
        : state === 'pending'
          ? 'Hay checks en cola o en curso: esperá y volvé a consultar; no lo des por bueno todavía.'
          : state === 'failure'
            ? 'Hay checks fallidos: leé el detalle y corregí en la misma rama, luego volvé a consultar.'
            : 'Este commit no tiene checks ni estados configurados.',
  })
}

/* --------------------------- operaciones de lectura ---------------------- */

export async function repoOverview(input: string): Promise<string> {
  const parsed = repoFrom(input)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  const { owner, repo } = parsed

  const info = await ghFetch(`/repos/${owner}/${repo}`)
  if (!info.ok) return JSON.stringify({ error: describeError(info.status, info.data) })
  const d = info.data as Record<string, unknown>

  // README (best-effort).
  let readme = ''
  const readmeRes = await ghFetch(`/repos/${owner}/${repo}/readme`)
  if (readmeRes.ok) {
    const r = readmeRes.data as { content?: string; encoding?: string }
    if (r.content && r.encoding === 'base64') {
      readme = decodeBase64(r.content).slice(0, GITHUB_LIMITS.readme)
    }
  }

  // Árbol de primer nivel (best-effort).
  let topLevel: string[] = []
  const branch = typeof d.default_branch === 'string' ? d.default_branch : 'main'
  const tree = await ghFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}`)
  if (tree.ok) {
    const t = tree.data as { tree?: { path?: string; type?: string }[] }
    topLevel = (t.tree ?? [])
      .map((e) => `${e.path}${e.type === 'tree' ? '/' : ''}`)
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 100)
  }

  return JSON.stringify({
    repo: `${owner}/${repo}`,
    description: d.description ?? null,
    language: d.language ?? null,
    stars: d.stargazers_count ?? 0,
    forks: d.forks_count ?? 0,
    open_issues: d.open_issues_count ?? 0,
    default_branch: branch,
    private: d.private === true,
    pushed_at: d.pushed_at ?? null,
    topics: d.topics ?? [],
    top_level: topLevel,
    readme_excerpt: readme || '(sin README)',
    auth: hasGithubToken() ? 'token' : 'anónimo (60 req/hora)',
    note:
      'Usa github_list_files para explorar directorios y github_read_file para leer ' +
      'el contenido de los archivos que quieras analizar.',
  })
}

export async function listFiles(input: string, pathPrefix = '', ref?: string): Promise<string> {
  const parsed = repoFrom(input)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  const { owner, repo } = parsed

  let branch = ref
  if (!branch) {
    const info = await ghFetch(`/repos/${owner}/${repo}`)
    if (!info.ok) return JSON.stringify({ error: describeError(info.status, info.data) })
    branch = (info.data as { default_branch?: string }).default_branch || 'main'
  }

  const res = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })

  const data = res.data as { tree?: { path?: string; type?: string; size?: number }[]; truncated?: boolean }
  const prefix = pathPrefix.trim().replace(/^\/+|\/+$/g, '')
  const entries = (data.tree ?? [])
    .filter((e) => typeof e.path === 'string')
    .filter((e) => (prefix ? e.path === prefix || e.path!.startsWith(`${prefix}/`) : true))
    .map((e) => `${e.path}${e.type === 'tree' ? '/' : ''}`)
    .slice(0, GITHUB_LIMITS.listFiles)

  return JSON.stringify({
    repo: `${owner}/${repo}`,
    ref: branch,
    prefix: prefix || '(raíz)',
    total_in_repo: data.tree?.length ?? 0,
    truncated: data.truncated === true,
    files: entries,
    note:
      entries.length === GITHUB_LIMITS.listFiles
        ? `Listado recortado a ${GITHUB_LIMITS.listFiles} entradas; usa un prefijo más específico.`
        : undefined,
  })
}

/**
 * Lee un archivo. Dos modos de paginación:
 *
 * - Por caracteres (por defecto, compatible con lo anterior): `offset` +
 *   `GITHUB_LIMITS.readFile`, con `next_offset` para continuar.
 * - Por líneas: `start_line`/`end_line` (1-based, inclusivos). El contenido se
 *   devuelve CON números de línea, que ayudan al modelo a ubicar el bloque a
 *   parchear. Si falta `end_line`, se toma una ventana de `readFileLines`.
 *
 * Se devuelve el `sha` del blob: quien vaya a parchear el archivo puede
 * reenviarlo como `baseSha` para detectar cambios concurrentes.
 */
export async function readFile(
  input: string,
  filePath: string,
  ref?: string,
  offset?: unknown,
  startLine?: unknown,
  endLine?: unknown,
): Promise<string> {
  const parsed = repoFrom(input)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  if (!filePath?.trim()) return JSON.stringify({ error: 'Falta la ruta del archivo.' })
  const { owner, repo } = parsed
  const clean = filePath.trim().replace(/^\/+/, '')
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''

  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${clean.split('/').map(encodeURIComponent).join('/')}${query}`)
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })

  const d = res.data as { content?: string; encoding?: string; size?: number; type?: string; sha?: string; download_url?: string }
  if (d.type === 'dir') {
    return JSON.stringify({ error: `"${clean}" es un directorio; usa github_list_files.` })
  }
  if (!d.content || d.encoding !== 'base64') {
    return JSON.stringify({
      error: `No pude leer "${clean}" (archivo demasiado grande o binario).`,
      size: d.size ?? null,
    })
  }

  const text = decodeBase64(d.content)
  const sha = d.sha ?? null

  // Modo por líneas: se pide explícitamente con start_line.
  if (startLine !== undefined && startLine !== null && startLine !== '') {
    return readFileByLines({ owner, repo, clean, text, sha, size: d.size, startLine, endLine })
  }

  const window = sliceWindow(text, offset, GITHUB_LIMITS.readFile)
  const before = text.slice(0, window.offset)
  const windowStartLine = (before.match(/\n/g)?.length ?? 0) + 1
  return JSON.stringify({
    repo: `${owner}/${repo}`,
    path: clean,
    size: d.size ?? text.length,
    sha,
    mode: 'chars',
    offset: window.offset,
    truncated: window.truncated,
    next_offset: window.nextOffset,
    start_line: window.content.length === 0 ? null : windowStartLine,
    total_lines: text.length === 0 ? 0 : text.split('\n').length,
    content: window.content,
    note:
      'Para parchear, copiá el bloque exacto a cambiar y pasá además "baseSha" con el sha ' +
      'de este archivo. Para leer por líneas usá start_line/end_line.',
  })
}

/**
 * Ventana por rango de líneas (1-based, inclusivo) con el contenido numerado.
 * `end_line` ausente = `start_line + readFileLines - 1`, recortado al final.
 */
function readFileByLines(args: {
  owner: string
  repo: string
  clean: string
  text: string
  sha: string | null
  size?: number
  startLine: unknown
  endLine: unknown
}): string {
  const { owner, repo, clean, text, sha, size, startLine, endLine } = args
  const lines = text.split('\n')
  const total = lines.length

  const first = Math.max(1, Math.floor(Number(startLine)) || 1)
  const requestedEnd =
    endLine === undefined || endLine === null || endLine === ''
      ? first + GITHUB_LIMITS.readFileLines - 1
      : Math.floor(Number(endLine)) || first
  const last = Math.min(total, Math.max(first, requestedEnd))

  const slice = lines.slice(first - 1, last)
  const width = String(last).length
  const content = slice
    .map((line, i) => `${String(first + i).padStart(width, ' ')}| ${line}`)
    .join('\n')

  const truncated = last < total
  return JSON.stringify({
    repo: `${owner}/${repo}`,
    path: clean,
    size: size ?? text.length,
    sha,
    mode: 'lines',
    start_line: first,
    end_line: last,
    total_lines: total,
    truncated,
    next_offset: truncated ? last + 1 : null,
    content,
    note: truncated
      ? `Quedan líneas hasta ${total}; continuá con start_line=${last + 1}.`
      : undefined,
  })
}

export async function listIssues(input: string, state = 'open'): Promise<string> {
  const parsed = repoFrom(input)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  const { owner, repo } = parsed
  const safeState = ['open', 'closed', 'all'].includes(state) ? state : 'open'

  const res = await ghFetch(
    `/repos/${owner}/${repo}/issues?state=${safeState}&per_page=${GITHUB_LIMITS.issues}&sort=updated&direction=desc`,
  )
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })

  const items = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[]
  const issues = items
    // La API mezcla pull requests en /issues: se filtran.
    .filter((i) => !i.pull_request)
    .slice(0, GITHUB_LIMITS.issues)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: Array.isArray(i.labels)
        ? (i.labels as { name?: string }[]).map((l) => l.name).filter(Boolean)
        : [],
      comments: i.comments,
      updated_at: i.updated_at,
      body: typeof i.body === 'string' ? i.body.slice(0, GITHUB_LIMITS.issueBody) : '',
      url: i.html_url,
    }))

  return JSON.stringify({
    repo: `${owner}/${repo}`,
    state: safeState,
    count: issues.length,
    issues,
    note:
      'Para proponer arreglos, combina estas issues con github_read_file de los ' +
      'archivos relacionados.',
  })
}

/* --------------------------- selector de repos --------------------------- */

export interface GithubRepoSummary {
  repo: string
  description: string | null
  private: boolean
  language: string | null
  defaultBranch: string
  pushedAt: string | null
}

export interface BrowseReposResult {
  ok: boolean
  tokenConfigured: boolean
  repos: GithubRepoSummary[]
  error?: string
  truncated?: boolean
}

/**
 * Normaliza y valida un nombre de usuario/u organización de GitHub.
 * Devuelve `null` si no es válido (evita inyectar rutas raras en la API).
 */
export function normalizeGithubUser(input: string): string | null {
  const user = input.trim().replace(/^@/, '')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) return null
  return user
}

/** Mapea y filtra los items crudos de la API a `GithubRepoSummary`. */
function mapRepoSummaries(
  items: Record<string, unknown>[],
  query: string,
  limit: number,
): GithubRepoSummary[] {
  const q = query.trim().toLowerCase()
  return items
    .map((r) => ({
      repo: typeof r.full_name === 'string' ? r.full_name : '',
      description: typeof r.description === 'string' ? r.description : null,
      private: r.private === true,
      language: typeof r.language === 'string' ? r.language : null,
      defaultBranch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
      pushedAt: typeof r.pushed_at === 'string' ? r.pushed_at : null,
    }))
    .filter((r) => r.repo)
    .filter((r) =>
      q
        ? r.repo.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
        : true,
    )
    .slice(0, limit)
}

const REPOS_PER_PAGE = 100

/**
 * Lista repositorios para el selector del panel.
 *
 * - Con `GITHUB_TOKEN`: usa `/user/repos`, así que aparecen los públicos Y los
 *   privados a los que el token tenga acceso (sin necesidad de usuario).
 * - Sin token pero con `username`: lista los repos PÚBLICOS de ese usuario
 *   (`/users/{username}/repos`). Es el "fallback sin token" para verse a uno
 *   mismo sin configurar nada (límite anónimo de 60 req/hora).
 * - Sin token y sin usuario: devuelve un error que pide el nombre de usuario.
 */
export async function listMyRepos(
  query = '',
  limit = 100,
  username?: string,
): Promise<BrowseReposResult> {
  // 1) Con token: todos los repos a los que el token tiene acceso.
  if (hasGithubToken()) {
    const res = await ghFetch(
      `/user/repos?per_page=${REPOS_PER_PAGE}&sort=pushed&direction=desc&affiliation=owner%2Ccollaborator%2Corganization_member`,
    )
    if (!res.ok) {
      return { ok: false, tokenConfigured: true, repos: [], error: describeError(res.status, res.data) }
    }
    const items = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[]
    return {
      ok: true,
      tokenConfigured: true,
      repos: mapRepoSummaries(items, query, limit),
      truncated: items.length >= REPOS_PER_PAGE,
    }
  }

  // 2) Sin token, pero con usuario: repos públicos de ese usuario.
  const user = username ? normalizeGithubUser(username) : null
  if (username && !user) {
    return {
      ok: false,
      tokenConfigured: false,
      repos: [],
      error: 'Nombre de usuario de GitHub inválido.',
    }
  }
  if (user) {
    const res = await ghFetch(
      `/users/${encodeURIComponent(user)}/repos?per_page=${REPOS_PER_PAGE}&sort=pushed&direction=desc&type=owner`,
    )
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          tokenConfigured: false,
          repos: [],
          error: `No encontré el usuario "${user}" en GitHub.`,
        }
      }
      return { ok: false, tokenConfigured: false, repos: [], error: describeError(res.status, res.data) }
    }
    const items = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[]
    return {
      ok: true,
      tokenConfigured: false,
      repos: mapRepoSummaries(items, query, limit),
      truncated: items.length >= REPOS_PER_PAGE,
    }
  }

  // 3) Sin token y sin usuario: pedimos el nombre de usuario.
  return {
    ok: false,
    tokenConfigured: false,
    repos: [],
    error:
      'Sin GITHUB_TOKEN solo puedo listar repos PÚBLICOS: escribí tu usuario de GitHub. ' +
      'Con un token fine-grained de solo lectura ves también los privados (Contents/Issues/Metadata: Read).',
  }
}
