import {
  GIT_HOSTS,
  parseRepoRef,
  type GitPlatform,
  type RepoRef,
} from '@/app/lib/git-hosts'

/**
 * Distribuidor de operaciones entre plataformas (FASE 7 — Parte B).
 *
 * Las herramientas del modelo siguen llamándose `github_*` (renombrarlas
 * costaría tokens del prompt y rompería tests), pero dejan de estar soldadas a
 * GitHub: miran el repositorio y eligen el proveedor. `owner/repo` (sin
 * prefijo) es GitHub; `gitlab:grupo/proyecto` (o una URL de GitLab) va a GitLab.
 *
 * Cada proveedor vive en su módulo (`github.ts`, `gitlab.ts`) y comparte las
 * MISMAS protecciones (`git-common`): nunca se escribe en la rama por defecto,
 * se validan rutas y ramas, y todo pasa por un PR/MR.
 */

export interface GitChange {
  path: string
  content: string
}

export interface GitPatchOp {
  path: string
  search: string
  replace: string
  baseSha?: string
}

function invalid(repo: string): string {
  return JSON.stringify({
    error:
      `Repositorio inválido: "${repo}". Usá "owner/repo" (GitHub), ` +
      '"gitlab:grupo/proyecto" o la URL del repositorio.',
  })
}

function notImplemented(platform: GitPlatform): string {
  return JSON.stringify({
    error:
      `${GIT_HOSTS[platform].label} está reconocida pero todavía no implementada. ` +
      'Por ahora ARIA opera sobre GitHub y GitLab.',
  })
}

/** Resuelve la referencia o lanza un resultado de error ya listo. */
function resolve(repo: string): { ok: true; ref: RepoRef } | { ok: false; out: string } {
  const ref = parseRepoRef(repo)
  if (!ref) return { ok: false, out: invalid(repo) }
  return { ok: true, ref }
}

/** Plataforma detectada de un repositorio (o null si es inválido). */
export function gitPlatformOf(repo: string): GitPlatform | null {
  return parseRepoRef(repo)?.platform ?? null
}

/** Verificación ligera de que el repositorio existe y es accesible. */
export async function gitVerifyRepo(repo: string): Promise<{ ok: boolean; error?: string }> {
  const r = resolve(repo)
  if (!r.ok) return { ok: false, error: r.out }
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.verifyRepo(r.ref.full)
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.verifyRepo(r.ref)
  }
  return { ok: false, error: `${GIT_HOSTS[r.ref.platform].label} todavía no está implementada.` }
}

export async function gitRepoOverview(repo: string): Promise<string> {
  const r = resolve(repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.repoOverview(r.ref.full)
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.repoOverview(r.ref)
  }
  return notImplemented(r.ref.platform)
}

export async function gitListFiles(repo: string, prefix?: string, ref?: string): Promise<string> {
  const r = resolve(repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.listFiles(r.ref.full, prefix ?? '', ref)
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.listFiles(r.ref, prefix ?? '', ref)
  }
  return notImplemented(r.ref.platform)
}

export async function gitReadFile(
  repo: string,
  filePath: string,
  ref?: string,
  offset?: unknown,
  startLine?: unknown,
  endLine?: unknown,
): Promise<string> {
  const r = resolve(repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.readFile(r.ref.full, filePath, ref, offset, startLine, endLine)
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.readFile(r.ref, filePath, ref, offset, startLine, endLine)
  }
  return notImplemented(r.ref.platform)
}

export async function gitListIssues(repo: string, state?: string): Promise<string> {
  const r = resolve(repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.listIssues(r.ref.full, state ?? 'open')
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.listIssues(r.ref, state ?? 'open')
  }
  return notImplemented(r.ref.platform)
}

export interface GitCreateInput {
  repo: string
  title: string
  body?: string
  branch?: string
  changes: GitChange[]
}

export async function gitCreatePullRequest(input: GitCreateInput): Promise<string> {
  const r = resolve(input.repo)
  if (!r.ok) return r.out
  const common = {
    title: input.title,
    body: input.body,
    branch: input.branch,
    changes: input.changes,
  }
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.createPullRequest({ repo: r.ref.full, ...common })
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.createPullRequest({ repo: r.ref, ...common })
  }
  return notImplemented(r.ref.platform)
}

export interface GitPatchInput {
  repo: string
  title: string
  body?: string
  branch?: string
  patches: GitPatchOp[]
}

export async function gitApplyPatch(input: GitPatchInput): Promise<string> {
  const r = resolve(input.repo)
  if (!r.ok) return r.out
  const common = {
    title: input.title,
    body: input.body,
    branch: input.branch,
    patches: input.patches,
  }
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.applyPatch({ repo: r.ref.full, ...common })
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.applyPatch({ repo: r.ref, ...common })
  }
  return notImplemented(r.ref.platform)
}

export interface GitDeleteInput {
  repo: string
  title: string
  body?: string
  branch?: string
  paths: string[]
}

export async function gitDeleteFiles(input: GitDeleteInput): Promise<string> {
  const r = resolve(input.repo)
  if (!r.ok) return r.out
  const common = { title: input.title, body: input.body, branch: input.branch, paths: input.paths }
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.deleteFiles({ repo: r.ref.full, ...common })
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.deleteFiles({ repo: r.ref, ...common })
  }
  return notImplemented(r.ref.platform)
}

export interface GitCheckInput {
  repo: string
  pr?: unknown
  branch?: unknown
}

export async function gitGetCheckRuns(input: GitCheckInput): Promise<string> {
  const r = resolve(input.repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.getCheckRuns({ repo: r.ref.full, pr: input.pr, branch: input.branch })
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.getCheckRuns({ repo: r.ref, pr: input.pr, branch: input.branch })
  }
  return notImplemented(r.ref.platform)
}

export interface GitMergeInput {
  repo: string
  pr?: unknown
  branch?: unknown
  method?: unknown
}

export async function gitMergePullRequest(input: GitMergeInput): Promise<string> {
  const r = resolve(input.repo)
  if (!r.ok) return r.out
  if (r.ref.platform === 'github') {
    const gh = await import('@/app/lib/github')
    return gh.mergePullRequest({
      repo: r.ref.full,
      pr: input.pr,
      branch: input.branch,
      method: input.method,
    })
  }
  if (r.ref.platform === 'gitlab') {
    const gl = await import('@/app/lib/gitlab')
    return gl.mergePullRequest({
      repo: r.ref,
      pr: input.pr,
      branch: input.branch,
      method: input.method,
    })
  }
  return notImplemented(r.ref.platform)
}
