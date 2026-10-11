import { prisma } from '@/app/lib/prisma'
import type { Prisma } from '../generated/prisma/wasm.js'
import { sliceWindow } from '@/app/lib/truncate'

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
  readFile: 6000,
  issues: 10,
  issueBody: 200,
  writeFiles: 5,
  writeChars: 200_000,
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

export async function readFile(
  input: string,
  filePath: string,
  ref?: string,
  offset?: unknown,
): Promise<string> {
  const parsed = repoFrom(input)
  if (!parsed) return JSON.stringify({ error: 'Repositorio inválido. Usa "owner/repo".' })
  if (!filePath?.trim()) return JSON.stringify({ error: 'Falta la ruta del archivo.' })
  const { owner, repo } = parsed
  const clean = filePath.trim().replace(/^\/+/, '')
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''

  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${clean.split('/').map(encodeURIComponent).join('/')}${query}`)
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })

  const d = res.data as { content?: string; encoding?: string; size?: number; type?: string; download_url?: string }
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
  const window = sliceWindow(text, offset, GITHUB_LIMITS.readFile)
  return JSON.stringify({
    repo: `${owner}/${repo}`,
    path: clean,
    size: d.size ?? text.length,
    offset: window.offset,
    truncated: window.truncated,
    next_offset: window.nextOffset,
    content: window.content,
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

function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
