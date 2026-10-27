import { sliceWindow } from '@/app/lib/truncate'
import { decodeBase64 } from '@/app/lib/base64'
import {
  applyTextPatches,
  branchSlug,
  cleanRepoPath,
  validateBranch,
} from '@/app/lib/git-common'
import { GIT_HOSTS, type RepoRef, platformToken } from '@/app/lib/git-hosts'

/**
 * Proveedor de GitLab (API REST v4) — FASE 7, Parte B.
 *
 * Reproduce la misma forma de trabajar que `github.ts` (leer repos/archivos/
 * issues; escribir SIEMPRE por una rama y un Merge Request, nunca en la rama por
 * defecto), pero contra `https://gitlab.com/api/v4`. La validación de ramas,
 * rutas y parches es la MISMA (`git-common`), así que no hay dos juegos de
 * reglas que se puedan separar.
 *
 * Diferencias reales frente a GitHub (no son un olvido):
 * - Las propuestas se llaman **Merge Request** (MR) y se identifican por `iid`.
 * - El CI son **pipelines**, no "check runs"; se traduce su estado al mismo
 *   vocabulario (success/failure/pending/none).
 * - Varios archivos van en UN solo commit (`PUT commits` con `actions`), así que
 *   no hace falta un commit por archivo.
 * - El identificador de proyecto es la ruta completa URL-encoded
 *   (`grupo%2Fsubgrupo%2Fproyecto`).
 *
 * LÍMITE HONESTO: todavía NO se probó contra un GitLab real (falta un token);
 * está cubierto por tests con la API simulada, como la Parte A de la Fase 7.
 */

const LIMITS = {
  readme: 1500,
  listFiles: 150,
  readFile: 8000,
  readFileLines: 400,
  issues: 10,
  issueBody: 200,
  writeFiles: 10,
  writeChars: 200_000,
  patchOps: 20,
} as const

/** ¿Se puede escribir contra GitLab? Igual que GitHub: interruptor explícito. */
export function gitlabWriteEnabled(): boolean {
  return process.env.GITLAB_WRITE_ENABLED?.trim().toLowerCase() === 'true'
}

/** ¿Se permite que GitLab auto-fusione el MR si el pipeline pasó? */
export function gitlabAutoMergeEnabled(): boolean {
  return process.env.GITLAB_AUTO_MERGE?.trim().toLowerCase() === 'true'
}

interface GlResult {
  ok: boolean
  status: number
  data: unknown
}

/** Proyecto GitLab como identificador de API: ruta completa URL-encoded. */
function projectId(repo: RepoRef): string {
  return encodeURIComponent(repo.full)
}

async function glFetch(
  repo: RepoRef,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<GlResult> {
  const token = platformToken('gitlab')
  const url = `${GIT_HOSTS.gitlab.apiBase}/projects/${projectId(repo)}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'ARIA-Assistant',
        ...(token ? { 'PRIVATE-TOKEN': token } : {}),
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

/** Saca un texto de error legible de un cuerpo de GitLab (a veces anidado). */
function glMessage(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const d = data as { message?: unknown; error?: unknown }
    const m = d.message ?? d.error
    if (typeof m === 'string') return m
    if (typeof m === 'object' && m !== null) {
      const parts = Object.entries(m as Record<string, unknown>).map(([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`,
      )
      if (parts.length > 0) return parts.join('; ')
    }
  }
  return ''
}

function describeError(status: number, data: unknown): string {
  const message = glMessage(data)
  if (status === 401) return 'GITLAB_TOKEN inválido o caducado.'
  if (status === 403) return `GitLab denegó el permiso (¿scope del token?): ${message || 'forbidden'}`
  if (status === 404) {
    return 'No encontré el proyecto o el archivo (¿es privado y falta GITLAB_TOKEN?).'
  }
  if (status === 429) return 'GitLab limitó las peticiones (rate limit). Esperá un momento.'
  if (status === 409) return `GitLab rechazó el cambio por un conflicto: ${message || 'conflicto'}`
  if (status === 400 || status === 422) {
    return `GitLab rechazó los datos: ${message || 'validación fallida'}`
  }
  if (status === 405) return `GitLab no permitió la operación: ${message || 'method not allowed'}`
  if (status === 0) return `No pude contactar con GitLab: ${message}`
  return `GitLab respondió ${status}${message ? `: ${message}` : ''}`
}

async function defaultBranch(repo: RepoRef): Promise<{ ok: true; branch: string } | { ok: false; error: string }> {
  const info = await glFetch(repo, '')
  if (!info.ok) return { ok: false, error: describeError(info.status, info.data) }
  const d = info.data as { default_branch?: string }
  return { ok: true, branch: d.default_branch || 'main' }
}

/** Ratón de verificación ligera para agregar un repo a la lista. */
export async function verifyRepo(repo: RepoRef): Promise<{ ok: boolean; error?: string }> {
  const info = await glFetch(repo, '')
  if (!info.ok) return { ok: false, error: describeError(info.status, info.data) }
  return { ok: true }
}

/* ------------------------------- lectura -------------------------------- */

export async function repoOverview(repo: RepoRef): Promise<string> {
  const info = await glFetch(repo, '')
  if (!info.ok) return JSON.stringify({ error: describeError(info.status, info.data) })
  const d = info.data as {
    name?: string
    description?: string | null
    default_branch?: string
    star_count?: number
    forks_count?: number
    open_issues_count?: number
    visibility?: string
    web_url?: string
    last_activity_at?: string
    topics?: string[]
  }
  const branch = d.default_branch || 'main'

  let readme = ''
  for (const name of ['README.md', 'readme.md', 'README']) {
    const res = await fetch(
      `${GIT_HOSTS.gitlab.apiBase}/projects/${projectId(repo)}/repository/files/` +
        `${encodeURIComponent(name)}/raw?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'ARIA-Assistant',
          ...(platformToken('gitlab') ? { 'PRIVATE-TOKEN': platformToken('gitlab')! } : {}),
        },
      },
    ).catch(() => null)
    if (res && res.ok) {
      const text = await res.text().catch(() => '')
      if (text) {
        readme = text.slice(0, LIMITS.readme)
        break
      }
    }
  }

  let topLevel: string[] = []
  const tree = await glFetch(repo, `/repository/tree?per_page=100&ref=${encodeURIComponent(branch)}`)
  if (tree.ok && Array.isArray(tree.data)) {
    topLevel = (tree.data as { path?: string; type?: string }[])
      .filter((e) => typeof e.path === 'string')
      .map((e) => `${e.path}${e.type === 'tree' ? '/' : ''}`)
      .slice(0, 100)
  }

  return JSON.stringify({
    repo: repo.full,
    platform: 'gitlab',
    description: d.description ?? null,
    language: null,
    stars: d.star_count ?? 0,
    forks: d.forks_count ?? 0,
    open_issues: d.open_issues_count ?? 0,
    default_branch: branch,
    private: d.visibility === 'private',
    pushed_at: d.last_activity_at ?? null,
    topics: Array.isArray(d.topics) ? d.topics : [],
    top_level: topLevel,
    readme_excerpt: readme || '(sin README)',
    url: d.web_url ?? null,
    auth: platformToken('gitlab') ? 'token' : 'anónimo',
    note:
      'Usa github_list_files para explorar directorios y github_read_file para leer ' +
      'el contenido de los archivos que quieras analizar.',
  })
}

export async function listFiles(repo: RepoRef, pathPrefix = '', ref?: string): Promise<string> {
  let branch = ref
  if (!branch) {
    const base = await defaultBranch(repo)
    if (!base.ok) return JSON.stringify({ error: base.error })
    branch = base.branch
  }

  const prefix = pathPrefix.trim().replace(/^\/+|\/+$/g, '')
  const query =
    `/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(branch)}` +
    (prefix ? `&path=${encodeURIComponent(prefix)}` : '')
  const res = await glFetch(repo, query)
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })
  const items = Array.isArray(res.data) ? (res.data as { path?: string; type?: string }[]) : []
  const entries = items
    .filter((e) => typeof e.path === 'string')
    .map((e) => `${e.path}${e.type === 'tree' ? '/' : ''}`)
    .slice(0, LIMITS.listFiles)

  return JSON.stringify({
    repo: repo.full,
    platform: 'gitlab',
    ref: branch,
    prefix: prefix || '(raíz)',
    total_in_repo: items.length,
    truncated: items.length >= 100,
    files: entries,
    note:
      entries.length === LIMITS.listFiles
        ? `Listado recortado a ${LIMITS.listFiles} entradas; usa un prefijo más específico.`
        : undefined,
  })
}

export async function readFile(
  repo: RepoRef,
  filePath: string,
  ref?: string,
  offset?: unknown,
  startLine?: unknown,
  endLine?: unknown,
): Promise<string> {
  if (!filePath?.trim()) return JSON.stringify({ error: 'Falta la ruta del archivo.' })
  const clean = filePath.trim().replace(/^\/+/, '')
  let refValue = ref?.trim() ?? ''
  if (!refValue) {
    const base = await defaultBranch(repo)
    if (!base.ok) return JSON.stringify({ error: base.error })
    refValue = base.branch
  }

  const res = await glFetch(
    repo,
    `/repository/files/${encodeURIComponent(clean)}?ref=${encodeURIComponent(refValue)}`,
  )
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })
  const d = res.data as { content?: string; encoding?: string; size?: number; blob_id?: string }
  if (!d.content || d.encoding !== 'base64') {
    return JSON.stringify({
      error: `No pude leer "${clean}" (archivo demasiado grande o binario).`,
      size: d.size ?? null,
    })
  }
  const text = decodeBase64(d.content)
  const sha = d.blob_id ?? null

  if (startLine !== undefined && startLine !== null && startLine !== '') {
    return readByLines(repo, clean, text, sha, d.size, startLine, endLine)
  }

  const window = sliceWindow(text, offset, LIMITS.readFile)
  const before = text.slice(0, window.offset)
  const windowStartLine = (before.match(/\n/g)?.length ?? 0) + 1
  return JSON.stringify({
    repo: repo.full,
    platform: 'gitlab',
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

function readByLines(
  repo: RepoRef,
  clean: string,
  text: string,
  sha: string | null,
  size: number | undefined,
  startLine: unknown,
  endLine: unknown,
): string {
  const lines = text.split('\n')
  const total = lines.length
  const first = Math.max(1, Math.floor(Number(startLine)) || 1)
  const requestedEnd =
    endLine === undefined || endLine === null || endLine === ''
      ? first + LIMITS.readFileLines - 1
      : Math.floor(Number(endLine)) || first
  const last = Math.min(total, Math.max(first, requestedEnd))
  const slice = lines.slice(first - 1, last)
  const width = String(last).length
  const content = slice
    .map((line, i) => `${String(first + i).padStart(width, ' ')}| ${line}`)
    .join('\n')
  const truncated = last < total
  return JSON.stringify({
    repo: repo.full,
    platform: 'gitlab',
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
    note: truncated ? `Quedan líneas hasta ${total}; continuá con start_line=${last + 1}.` : undefined,
  })
}

export async function listIssues(repo: RepoRef, state = 'open'): Promise<string> {
  const glState = state === 'closed' ? 'closed' : state === 'all' ? 'all' : 'opened'
  const res = await glFetch(
    repo,
    `/issues?state=${glState}&per_page=${LIMITS.issues}&order_by=updated_at&sort=desc`,
  )
  if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data) })
  const items = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []
  const issues = items.slice(0, LIMITS.issues).map((i) => ({
    number: i.iid,
    title: i.title,
    state: i.state,
    labels: Array.isArray(i.labels) ? i.labels : [],
    comments: i.user_notes_count,
    updated_at: i.updated_at,
    body: typeof i.description === 'string' ? i.description.slice(0, LIMITS.issueBody) : '',
    url: i.web_url,
  }))
  return JSON.stringify({
    repo: repo.full,
    platform: 'gitlab',
    state: state === 'open' ? 'open' : state,
    count: issues.length,
    issues,
    note:
      'Para proponer arreglos, combina estas issues con github_read_file de los ' +
      'archivos relacionados.',
  })
}

/* ------------------------------- escritura ------------------------------ */

interface CommitAction {
  action: 'create' | 'update' | 'delete'
  file_path: string
  content?: string
}

/** ¿Existe el archivo en la rama? Devuelve el sha (blob_id) o null si no está. */
async function fileBlobId(repo: RepoRef, path: string, branch: string): Promise<string | null | undefined> {
  const res = await glFetch(repo, `/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`)
  if (res.status === 404) return null
  if (!res.ok) return undefined
  return (res.data as { blob_id?: string }).blob_id ?? null
}

/** Resuelve el nombre de rama objetivo y si hay que crearla. */
async function resolveTargetBranch(
  repo: RepoRef,
  base: string,
  requested: string | undefined,
  fallbackSlug: string,
): Promise<
  | { ok: true; branch: string; created: boolean }
  | { ok: false; error: string; branch?: string }
> {
  if (requested && requested.includes('/')) {
    const valid = validateBranch(requested, base)
    if (!valid.ok) return { ok: false, error: valid.error }
    return { ok: true, branch: valid.branch, created: false }
  }

  const slug = branchSlug(requested ?? fallbackSlug) || 'cambio'
  const branch = `aria/${slug}-${Date.now().toString(36)}`
  const create = await glFetch(repo, '/repository/branches', {
    method: 'POST',
    body: { branch, ref: base },
  })
  if (!create.ok && create.status !== 400) {
    // 400 suele ser "Branch already exists"; en ese caso se reutiliza.
    return { ok: false, error: describeError(create.status, create.data) }
  }
  return { ok: true, branch, created: true }
}

/** Crea un commit con varias acciones en una rama. */
async function commit(repo: RepoRef, branch: string, message: string, actions: CommitAction[]): Promise<GlResult> {
  return glFetch(repo, '/repository/commits', {
    method: 'POST',
    body: {
      branch,
      commit_message: message.slice(0, 250),
      actions: actions.map((a) =>
        a.action === 'delete' ? { action: 'delete', file_path: a.file_path } : { ...a },
      ),
    },
  })
}

export interface GlCreateInput {
  repo: RepoRef
  title: string
  body?: string
  branch?: string
  changes: { path: string; content: string }[]
}

export async function createPullRequest(input: GlCreateInput): Promise<string> {
  if (!platformToken('gitlab')) {
    return JSON.stringify({ error: 'Falta GITLAB_TOKEN para crear el merge request.' })
  }
  if (!gitlabWriteEnabled()) {
    return JSON.stringify({
      error:
        'La escritura en GitLab está desactivada. Definí GITLAB_WRITE_ENABLED=true y usá un ' +
        'token con scope api.',
    })
  }
  const title = input.title?.trim().slice(0, 200)
  if (!title) return JSON.stringify({ error: 'Falta el título del merge request.' })
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    return JSON.stringify({ error: 'El merge request necesita al menos un archivo.' })
  }
  if (input.changes.length > LIMITS.writeFiles) {
    return JSON.stringify({ error: `Máximo ${LIMITS.writeFiles} archivos por merge request.` })
  }

  const changes: { path: string; content: string }[] = []
  const seen = new Set<string>()
  let totalChars = 0
  for (const change of input.changes) {
    if (!change || typeof change.path !== 'string' || typeof change.content !== 'string') {
      return JSON.stringify({ error: 'Cada cambio necesita path y content de texto.' })
    }
    const path = cleanRepoPath(change.path)
    if (!path) {
      return JSON.stringify({
        error: `Ruta no permitida: "${change.path}". No se aceptan rutas relativas.`,
      })
    }
    const key = path.toLowerCase()
    if (seen.has(key)) return JSON.stringify({ error: `Archivo repetido en el cambio: "${path}".` })
    seen.add(key)
    totalChars += change.content.length
    changes.push({ path, content: change.content })
  }
  if (totalChars > LIMITS.writeChars) {
    return JSON.stringify({ error: `Contenido total demasiado grande (máximo ${LIMITS.writeChars} caracteres).` })
  }

  const base = await defaultBranch(input.repo)
  if (!base.ok) return JSON.stringify({ error: base.error })
  const target = await resolveTargetBranch(input.repo, base.branch, input.branch?.trim(), title)
  if (!target.ok) return JSON.stringify({ error: target.error })

  const actions: CommitAction[] = []
  const written: string[] = []
  for (const change of changes) {
    const blob = await fileBlobId(input.repo, change.path, target.branch)
    if (blob === undefined) {
      return JSON.stringify({
        error: `No pude leer "${change.path}" en la rama.`,
        branch: target.branch,
        written,
      })
    }
    actions.push({ action: blob === null ? 'create' : 'update', file_path: change.path, content: change.content })
    written.push(change.path)
  }

  const committed = await commit(input.repo, target.branch, title, actions)
  if (!committed.ok) {
    return JSON.stringify({ error: describeError(committed.status, committed.data), branch: target.branch, written })
  }

  const mr = await glFetch(input.repo, '/merge_requests', {
    method: 'POST',
    body: {
      source_branch: target.branch,
      target_branch: base.branch,
      title,
      description:
        input.body?.trim().slice(0, 20_000) ||
        'Cambios preparados por ARIA en una rama aislada. Revisa el pipeline y el diff antes de fusionar.',
    },
  })
  if (!mr.ok) {
    return JSON.stringify({
      error: describeError(mr.status, mr.data),
      branch: target.branch,
      written,
      note: 'Los commits están en la rama; solo falló la creación del merge request.',
    })
  }
  const data = mr.data as { iid?: number; web_url?: string }
  return JSON.stringify({
    success: true,
    platform: 'gitlab',
    repo: input.repo.full,
    base: base.branch,
    branch: target.branch,
    files: written,
    pull_request: data.iid ?? null,
    url: data.web_url ?? null,
    merged: false,
    note: 'No se modificó la rama principal. El cambio requiere revisión y merge.',
  })
}

export interface GlPatchInput {
  repo: RepoRef
  title: string
  body?: string
  branch?: string
  patches: { path: string; search: string; replace: string; baseSha?: string }[]
}

export async function applyPatch(input: GlPatchInput): Promise<string> {
  if (!platformToken('gitlab')) {
    return JSON.stringify({ error: 'Falta GITLAB_TOKEN para aplicar el parche.' })
  }
  if (!gitlabWriteEnabled()) {
    return JSON.stringify({
      error:
        'La escritura en GitLab está desactivada. Definí GITLAB_WRITE_ENABLED=true y usá un ' +
        'token con scope api.',
    })
  }
  const title = input.title?.trim().slice(0, 200)
  if (!title) return JSON.stringify({ error: 'Falta el título del merge request.' })
  if (!Array.isArray(input.patches) || input.patches.length === 0) {
    return JSON.stringify({ error: 'El parche necesita al menos una operación {path, search, replace}.' })
  }
  if (input.patches.length > LIMITS.patchOps) {
    return JSON.stringify({ error: `Máximo ${LIMITS.patchOps} operaciones por llamada.` })
  }

  const files = new Map<string, { path: string; ops: GlPatchInput['patches'] }>()
  for (const op of input.patches) {
    if (!op || typeof op.path !== 'string' || typeof op.search !== 'string' || typeof op.replace !== 'string') {
      return JSON.stringify({ error: 'Cada parche necesita path, search y replace de texto.' })
    }
    if (!op.search) return JSON.stringify({ error: 'Cada parche necesita un bloque "search" no vacío.' })
    const path = cleanRepoPath(op.path)
    if (!path) {
      return JSON.stringify({ error: `Ruta no permitida: "${op.path}".` })
    }
    const key = path.toLowerCase()
    const entry = files.get(key)
    if (entry) entry.ops.push({ ...op, path })
    else files.set(key, { path, ops: [{ ...op, path }] })
  }
  if (files.size > LIMITS.writeFiles) {
    return JSON.stringify({ error: `Máximo ${LIMITS.writeFiles} archivos por parche.` })
  }

  const base = await defaultBranch(input.repo)
  if (!base.ok) return JSON.stringify({ error: base.error })

  const requestedBranch = input.branch?.trim()
  let branch: string
  let createdBranch = false
  if (requestedBranch) {
    const valid = validateBranch(requestedBranch, base.branch)
    if (!valid.ok) return JSON.stringify({ error: valid.error })
    const refRes = await glFetch(
      input.repo,
      `/repository/branches/${encodeURIComponent(valid.branch)}`,
    )
    if (!refRes.ok) {
      return JSON.stringify({
        error: `No encontré la rama "${valid.branch}": ${describeError(refRes.status, refRes.data)}`,
      })
    }
    branch = valid.branch
  } else {
    const target = await resolveTargetBranch(input.repo, base.branch, undefined, title)
    if (!target.ok) return JSON.stringify({ error: target.error })
    branch = target.branch
    createdBranch = target.created
  }

  const actions: CommitAction[] = []
  const written: string[] = []
  for (const { path, ops } of files.values()) {
    const res = await glFetch(
      input.repo,
      `/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    )
    if (res.status === 404) {
      return JSON.stringify({
        error: `El archivo "${path}" no existe en la rama. Para crearlo usá github_create_pull_request.`,
        branch,
        written,
      })
    }
    if (!res.ok) return JSON.stringify({ error: describeError(res.status, res.data), branch, written })
    const d = res.data as { content?: string; encoding?: string; blob_id?: string }
    if (!d.content || d.encoding !== 'base64') {
      return JSON.stringify({
        error: `No pude leer "${path}" para parchearlo (archivo demasiado grande o binario).`,
        branch,
        written,
      })
    }
    const knownSha = ops.find((o) => o.baseSha)?.baseSha
    if (knownSha && d.blob_id && knownSha !== d.blob_id) {
      return JSON.stringify({
        error: `El archivo "${path}" cambió desde que lo leíste. Volvé a leerlo y regenerá el parche.`,
        branch,
        written,
      })
    }
    const text = decodeBase64(d.content)
    const applied = applyTextPatches(text, ops)
    if (!applied.ok) {
      return JSON.stringify({ error: `No pude aplicar el parche en "${path}": ${applied.error}`, branch, written })
    }
    if (applied.content === text) {
      return JSON.stringify({
        error: `El parche en "${path}" no cambia nada (search y replace son iguales).`,
        branch,
        written,
      })
    }
    actions.push({ action: 'update', file_path: path, content: applied.content })
    written.push(path)
  }

  const committed = await commit(input.repo, branch, title, actions)
  if (!committed.ok) {
    return JSON.stringify({ error: describeError(committed.status, committed.data), branch, written })
  }

  let pullNumber: number | null = null
  let pullUrl: string | null = null
  if (createdBranch) {
    const mr = await glFetch(input.repo, '/merge_requests', {
      method: 'POST',
      body: {
        source_branch: branch,
        target_branch: base.branch,
        title,
        description:
          input.body?.trim().slice(0, 20_000) ||
          'Cambios precisos preparados por ARIA en una rama aislada. Revisa el diff antes de fusionar.',
      },
    })
    if (!mr.ok) {
      return JSON.stringify({
        error: describeError(mr.status, mr.data),
        branch,
        written,
        note: 'Los commits están en la rama; solo falló la creación del merge request.',
      })
    }
    const data = mr.data as { iid?: number; web_url?: string }
    pullNumber = data.iid ?? null
    pullUrl = data.web_url ?? null
  }

  return JSON.stringify({
    success: true,
    platform: 'gitlab',
    repo: input.repo.full,
    base: base.branch,
    branch,
    files: written,
    pull_request: pullNumber,
    url: pullUrl,
    merged: false,
    note: createdBranch
      ? 'No se modificó la rama principal. El cambio requiere revisión y merge manual.'
      : 'Parche agregado a la rama existente. Consultá el pipeline antes de darlo por bueno.',
  })
}

export interface GlDeleteInput {
  repo: RepoRef
  title: string
  body?: string
  branch?: string
  paths: string[]
}

export async function deleteFiles(input: GlDeleteInput): Promise<string> {
  if (!platformToken('gitlab')) return JSON.stringify({ error: 'Falta GITLAB_TOKEN para borrar archivos.' })
  if (!gitlabWriteEnabled()) {
    return JSON.stringify({
      error:
        'La escritura en GitLab está desactivada. Definí GITLAB_WRITE_ENABLED=true y usá un ' +
        'token con scope api.',
    })
  }
  const title = input.title?.trim().slice(0, 200)
  if (!title) return JSON.stringify({ error: 'Falta el título del merge request.' })
  if (!Array.isArray(input.paths) || input.paths.length === 0) {
    return JSON.stringify({ error: 'Indicá al menos un archivo para borrar.' })
  }
  if (input.paths.length > LIMITS.writeFiles) {
    return JSON.stringify({ error: `Máximo ${LIMITS.writeFiles} archivos por vez.` })
  }

  const paths: string[] = []
  const seen = new Set<string>()
  for (const raw of input.paths) {
    if (typeof raw !== 'string') return JSON.stringify({ error: 'Cada ruta debe ser texto.' })
    const path = cleanRepoPath(raw)
    if (!path) return JSON.stringify({ error: `Ruta no permitida: "${raw}".` })
    const key = path.toLowerCase()
    if (seen.has(key)) return JSON.stringify({ error: `Archivo repetido: "${path}".` })
    seen.add(key)
    paths.push(path)
  }

  const base = await defaultBranch(input.repo)
  if (!base.ok) return JSON.stringify({ error: base.error })
  const requestedBranch = input.branch?.trim()
  let branch: string
  let createdBranch = false
  if (requestedBranch) {
    const valid = validateBranch(requestedBranch, base.branch)
    if (!valid.ok) return JSON.stringify({ error: valid.error })
    branch = valid.branch
  } else {
    const target = await resolveTargetBranch(input.repo, base.branch, undefined, title)
    if (!target.ok) return JSON.stringify({ error: target.error })
    branch = target.branch
    createdBranch = target.created
  }

  const actions: CommitAction[] = []
  const deleted: string[] = []
  for (const path of paths) {
    const blob = await fileBlobId(input.repo, path, branch)
    if (blob === null) {
      return JSON.stringify({ error: `El archivo "${path}" no existe en la rama.`, branch, deleted })
    }
    if (blob === undefined) {
      return JSON.stringify({ error: `No pude leer "${path}".`, branch, deleted })
    }
    actions.push({ action: 'delete', file_path: path })
    deleted.push(path)
  }

  const committed = await commit(input.repo, branch, title, actions)
  if (!committed.ok) {
    return JSON.stringify({ error: describeError(committed.status, committed.data), branch, deleted })
  }

  let pullNumber: number | null = null
  let pullUrl: string | null = null
  if (createdBranch) {
    const mr = await glFetch(input.repo, '/merge_requests', {
      method: 'POST',
      body: {
        source_branch: branch,
        target_branch: base.branch,
        title,
        description:
          input.body?.trim().slice(0, 20_000) ||
          'Archivos eliminados por ARIA en una rama aislada. Revisa el diff antes de fusionar.',
      },
    })
    if (!mr.ok) {
      return JSON.stringify({
        error: describeError(mr.status, mr.data),
        branch,
        deleted,
        note: 'Los commits están en la rama; solo falló la creación del merge request.',
      })
    }
    const data = mr.data as { iid?: number; web_url?: string }
    pullNumber = data.iid ?? null
    pullUrl = data.web_url ?? null
  }

  return JSON.stringify({
    success: true,
    platform: 'gitlab',
    repo: input.repo.full,
    base: base.branch,
    branch,
    files_deleted: deleted,
    pull_request: pullNumber,
    url: pullUrl,
    merged: false,
    note: 'No se modificó la rama principal. El cambio requiere revisión y merge.',
  })
}

/* ------------------------- CI (pipelines de GitLab) --------------------- */

interface GlPipeline {
  id?: number
  status?: string
  sha?: string
  web_url?: string
  ref?: string
}

/** Traduce el estado de un pipeline de GitLab al vocabulario común. */
export function pipelineState(status: string | undefined): 'success' | 'failure' | 'pending' | 'none' {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
    case 'canceled':
      return 'failure'
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'running':
    case 'scheduled':
    case 'manual':
      return 'pending'
    default:
      return 'none'
  }
}

export interface GlCheckInput {
  repo: RepoRef
  pr?: unknown
  branch?: unknown
}

export async function getCheckRuns(input: GlCheckInput): Promise<string> {
  const prIid = asPositiveInt(input.pr)
  const requestedBranch = typeof input.branch === 'string' ? input.branch.trim() : ''
  if (!prIid && !requestedBranch) {
    return JSON.stringify({
      error: 'Indicá "pr" (número de merge request) o "branch" para saber qué commit revisar.',
    })
  }

  let branch: string | null = requestedBranch || null
  let base: string | null = null
  let sha = ''
  let pipeline: GlPipeline | null = null
  const mrMeta: Record<string, unknown> = {}

  if (prIid) {
    const mrRes = await glFetch(input.repo, `/merge_requests/${prIid}`)
    if (!mrRes.ok) return JSON.stringify({ error: describeError(mrRes.status, mrRes.data) })
    const mr = mrRes.data as {
      iid?: number
      title?: string
      state?: string
      web_url?: string
      source_branch?: string
      target_branch?: string
      sha?: string
      head_pipeline?: GlPipeline | null
    }
    branch = mr.source_branch ?? branch
    base = mr.target_branch ?? null
    sha = mr.sha ?? ''
    pipeline = mr.head_pipeline ?? null
    mrMeta.pr = mr.iid ?? prIid
    mrMeta.pr_title = mr.title ?? null
    mrMeta.pr_state = mr.state ?? null
    mrMeta.pr_url = mr.web_url ?? null
    if (!pipeline) {
      const list = await glFetch(
        input.repo,
        `/pipelines?ref=${encodeURIComponent(branch ?? '')}&per_page=1`,
      )
      if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
        pipeline = (list.data as GlPipeline[])[0]
      }
    }
  } else {
    const list = await glFetch(
      input.repo,
      `/pipelines?ref=${encodeURIComponent(requestedBranch)}&per_page=1`,
    )
    if (!list.ok) return JSON.stringify({ error: describeError(list.status, list.data) })
    if (!Array.isArray(list.data) || list.data.length === 0) {
      pipeline = null
    } else {
      pipeline = (list.data as GlPipeline[])[0]
    }
    sha = pipeline?.sha ?? ''
  }

  const state = pipeline ? pipelineState(pipeline.status) : 'none'
  return JSON.stringify({
    repo: input.repo.full,
    platform: 'gitlab',
    ...mrMeta,
    branch,
    base,
    sha,
    auth: platformToken('gitlab') ? 'token' : 'anónimo',
    state,
    counts: { pipelines: pipeline ? 1 : 0 },
    passed: state === 'success' ? 1 : 0,
    failed: state === 'failure' ? 1 : 0,
    pending: state === 'pending' ? 1 : 0,
    neutral: state === 'none' ? 1 : 0,
    pipeline: pipeline ? { id: pipeline.id ?? null, status: pipeline.status ?? null, url: pipeline.web_url ?? null } : null,
    note:
      state === 'success'
        ? 'El pipeline pasó; recién ahora el cambio puede darse por listo.'
        : state === 'pending'
          ? 'El pipeline está en cola o en curso: esperá y volvé a consultar.'
          : state === 'failure'
            ? 'El pipeline falló: leé el detalle y corregí en la misma rama.'
            : 'Esta rama no tiene pipeline configurado.',
  })
}

/* ---------------------------- fusión del MR ----------------------------- */

export interface GlMergeInput {
  repo: RepoRef
  pr?: unknown
  branch?: unknown
  method?: unknown
}

export async function mergePullRequest(input: GlMergeInput): Promise<string> {
  if (!platformToken('gitlab')) return JSON.stringify({ error: 'Falta GITLAB_TOKEN para fusionar.' })
  if (!gitlabWriteEnabled()) {
    return JSON.stringify({
      error: 'La escritura en GitLab está desactivada. Definí GITLAB_WRITE_ENABLED=true.',
    })
  }
  if (!gitlabAutoMergeEnabled()) {
    return JSON.stringify({
      error:
        'La auto-fusión en GitLab está desactivada. Definí GITLAB_AUTO_MERGE=true para que ARIA ' +
        'pueda fusionar un merge request cuando el pipeline pasa.',
      hint: 'Sin ese interruptor el merge request queda abierto para que lo fusiones vos.',
    })
  }

  const prIid = asPositiveInt(input.pr)
  const requestedBranch = typeof input.branch === 'string' ? input.branch.trim() : ''
  if (!prIid && !requestedBranch) {
    return JSON.stringify({ error: 'Indicá "pr" (número de merge request) o "branch".' })
  }

  let iid = prIid
  if (!iid) {
    const list = await glFetch(
      input.repo,
      `/merge_requests?state=opened&source_branch=${encodeURIComponent(requestedBranch)}`,
    )
    if (!list.ok) return JSON.stringify({ error: describeError(list.status, list.data) })
    const found = Array.isArray(list.data) ? (list.data as { iid?: number }[])[0] : undefined
    if (!found?.iid) {
      return JSON.stringify({ error: `No hay un merge request abierto para la rama "${requestedBranch}".` })
    }
    iid = found.iid
  }

  const mrRes = await glFetch(input.repo, `/merge_requests/${iid}`)
  if (!mrRes.ok) return JSON.stringify({ error: describeError(mrRes.status, mrRes.data) })
  const mr = mrRes.data as {
    iid?: number
    state?: string
    web_url?: string
    has_conflicts?: boolean
    merge_status?: string
    detailed_merge_status?: string
    source_branch?: string
    target_branch?: string
    head_pipeline?: GlPipeline | null
  }
  const branch = mr.source_branch ?? requestedBranch ?? null

  if (mr.state === 'merged') {
    return JSON.stringify({
      success: true,
      merged: true,
      already_merged: true,
      platform: 'gitlab',
      repo: input.repo.full,
      pr: iid,
      branch,
      url: mr.web_url ?? null,
      note: 'El merge request ya estaba fusionado.',
    })
  }
  if (mr.state !== 'opened') {
    return JSON.stringify({
      error: `El merge request #${iid} no está abierto (estado: ${mr.state ?? 'desconocido'}).`,
    })
  }

  const state = pipelineState(mr.head_pipeline?.status)
  if (state !== 'success' && state !== 'none') {
    return JSON.stringify({
      error: 'No fusiono: el pipeline no pasó todavía.',
      state,
      pr: iid,
      branch,
      note:
        state === 'pending'
          ? 'Hay un pipeline en cola: esperá y volvé a intentar.'
          : 'Corregí el pipeline fallido en la misma rama y volvé a intentar.',
    })
  }

  if (mr.has_conflicts === true || mr.merge_status === 'cannot_be_merged') {
    return JSON.stringify({
      error: 'El merge request tiene conflictos y no se puede fusionar automáticamente.',
      pr: iid,
      branch,
    })
  }
  if (mr.merge_status === 'checking' || mr.detailed_merge_status === 'checking') {
    return JSON.stringify({
      error: 'GitLab todavía está calculando si el merge request se puede fusionar. Volvé a intentar en unos segundos.',
      pr: iid,
      branch,
    })
  }

  const requestedMethod = typeof input.method === 'string' ? input.method.trim().toLowerCase() : ''
  const merge = await glFetch(input.repo, `/merge_requests/${iid}/merge`, {
    method: 'PUT',
    body: { squash: requestedMethod === 'squash' },
  })
  if (!merge.ok) {
    return JSON.stringify({ error: describeError(merge.status, merge.data), pr: iid, branch })
  }
  const data = merge.data as { merge_commit_sha?: string; state?: string }
  return JSON.stringify({
    success: true,
    merged: true,
    platform: 'gitlab',
    repo: input.repo.full,
    pr: iid,
    branch,
    base: mr.target_branch ?? null,
    method: requestedMethod === 'squash' ? 'squash' : 'merge',
    merge_sha: data.merge_commit_sha ?? null,
    checks: state,
    url: mr.web_url ?? null,
    note: 'Merge request fusionado en su rama base.',
  })
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}
