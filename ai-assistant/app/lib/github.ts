import { prisma } from '@/app/lib/prisma'
import type { Prisma } from '../generated/prisma/wasm.js'
import { sliceWindow } from '@/app/lib/truncate'

/**
 * Integración de SOLO LECTURA con GitHub.
 *
 * Por qué existe
 * --------------
 * El usuario quiere poder "agregar repositorios" y que ARIA los lea para
 * proponer ideas de arreglo (bugs, issues, deuda técnica). Escribir en GitHub
 * (crear issues/PRs) queda fuera de alcance a propósito: la app es de un solo
 * usuario y un token con permisos de escritura es mucho más peligroso. Aquí todo
 * es `GET`.
 *
 * Token
 * -----
 * `GITHUB_TOKEN` es OPCIONAL. Los repos públicos se pueden leer sin token, pero
 * el límite sin autenticar es de 60 peticiones/hora por IP; con un token
 * (fine-grained, solo `Contents: read` y `Issues: read` de los repos que te
 * interesen) sube a 5.000/hora. Si no hay token, se avisa en el resultado.
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

async function ghFetch(path: string): Promise<GhResult> {
  const token = process.env.GITHUB_TOKEN?.trim()
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ARIA-Assistant',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
  if (status === 0) return `No pude contactar con GitHub: ${message}`
  return `GitHub respondió ${status}${message ? `: ${message}` : ''}`
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
 * Lista los repositorios del usuario autenticado.
 *
 * La API anónima de GitHub no sabe "cuáles son tus repos", así que esto exige
 * `GITHUB_TOKEN`. Con un token fine-grained de solo lectura aparecen tanto los
 * públicos como los privados a los que el token tenga acceso, y el usuario
 * puede elegir de una lista en vez de escribir `owner/repo` a mano.
 */
export async function listMyRepos(query = '', limit = 100): Promise<BrowseReposResult> {
  if (!hasGithubToken()) {
    return {
      ok: false,
      tokenConfigured: false,
      repos: [],
      error:
        'Para listar tus repositorios hace falta GITHUB_TOKEN. ' +
        'Configura un token fine-grained de solo lectura (Contents: Read, Issues: Read, Metadata: Read).',
    }
  }

  const perPage = 100
  const res = await ghFetch(
    `/user/repos?per_page=${perPage}&sort=pushed&direction=desc&affiliation=owner%2Ccollaborator%2Corganization_member`,
  )
  if (!res.ok) {
    return { ok: false, tokenConfigured: true, repos: [], error: describeError(res.status, res.data) }
  }

  const items = (Array.isArray(res.data) ? res.data : []) as Record<string, unknown>[]
  const q = query.trim().toLowerCase()
  const repos = items
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

  return {
    ok: true,
    tokenConfigured: true,
    repos,
    truncated: items.length >= perPage,
  }
}

function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
