/**
 * Capa de plataformas de código (FASE 7 — Parte B).
 *
 * Hasta ahora todo estaba soldado a GitHub (`app/lib/github.ts` llamaba directo
 * a `api.github.com`). Este módulo es la pieza común que NO sabe hablar con
 * ninguna API: solo reconoce la plataforma de un repositorio, guarda qué
 * credencial usa cada una y normaliza las referencias.
 *
 * Idea central: una referencia de repositorio puede llevar la plataforma
 * delante. `owner/repo` (sin prefijo) es GitHub, para no romper nada de lo ya
 * guardado; `gitlab:grupo/proyecto` y `bitbucket:espacio/repo` apuntan a las
 * otras. También se aceptan sus URLs y remotos SSH.
 *
 * Credenciales: una por plataforma, SIEMPRE por variable de entorno
 * (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`). No se guardan tokens en
 * la base de datos a propósito: un secreto que puede leer cualquiera con acceso
 * a la base es peor que uno que vive en los secretos del Worker / `.dev.vars`.
 */

export type GitPlatform = 'github' | 'gitlab' | 'bitbucket'

export interface GitHost {
  id: GitPlatform
  label: string
  /** Base de la web (para mostrar enlaces). */
  webBase: string
  /** Base de la API REST. */
  apiBase: string
  /** Variable de entorno con el token de la plataforma. */
  tokenEnv: string
  /** Pista de qué permisos necesita el token para escribir. */
  tokenHint: string
  /** False = reconocida pero todavía sin implementar (se avisa con claridad). */
  implemented: boolean
  /** Forma de un repositorio canónico para mostrarlo al usuario. */
  slugExample: string
}

export const GIT_HOSTS: Record<GitPlatform, GitHost> = {
  github: {
    id: 'github',
    label: 'GitHub',
    webBase: 'https://github.com',
    apiBase: 'https://api.github.com',
    tokenEnv: 'GITHUB_TOKEN',
    tokenHint: 'token fine-grained con Contents: write y Pull requests: write',
    implemented: true,
    slugExample: 'owner/repo',
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    webBase: 'https://gitlab.com',
    apiBase: 'https://gitlab.com/api/v4',
    tokenEnv: 'GITLAB_TOKEN',
    tokenHint: 'token con scope api (o read_api para solo lectura)',
    implemented: true,
    slugExample: 'gitlab:grupo/proyecto',
  },
  bitbucket: {
    id: 'bitbucket',
    label: 'Bitbucket',
    webBase: 'https://bitbucket.org',
    apiBase: 'https://api.bitbucket.org/2.0',
    tokenEnv: 'BITBUCKET_TOKEN',
    tokenHint: 'todavía sin implementar',
    implemented: false,
    slugExample: 'bitbucket:espacio/repo',
  },
}

export const GIT_PLATFORMS: GitPlatform[] = ['github', 'gitlab', 'bitbucket']

/** Referencia normalizada de un repositorio. */
export interface RepoRef {
  platform: GitPlatform
  /** Espacio de nombres: usuario en GitHub, grupo (o grupo/subgrupo) en GitLab. */
  namespace: string
  /** Nombre del repositorio/proyecto (último segmento). */
  name: string
  /** `namespace/name` completo (en GitLab puede incluir subgrupos). */
  full: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/

function validSegments(parts: string[]): boolean {
  return parts.length >= 2 && parts.every((p) => p.length > 0 && SEGMENT.test(p))
}

/**
 * Detecta la plataforma por el host de una URL o de un remoto SSH.
 * Devuelve null si el host no es una de las plataformas soportadas.
 */
function platformFromHost(host: string): GitPlatform | null {
  const h = host.toLowerCase()
  if (h.endsWith('github.com')) return 'github'
  if (h.endsWith('gitlab.com')) return 'gitlab'
  if (h.endsWith('bitbucket.org')) return 'bitbucket'
  return null
}

/**
 * Interpreta una referencia de repositorio. Acepta:
 *  - `owner/repo` (sin prefijo → `fallback`, por defecto GitHub)
 *  - `github:owner/repo`, `gitlab:grupo/proyecto`, `bitbucket:espacio/repo`
 *  - URLs: `https://github.com/owner/repo`, `https://gitlab.com/grupo/proy`
 *  - remotos SSH: `git@github.com:owner/repo.git`
 *
 * Devuelve null si no es válida (evita inyectar rutas raras en una API).
 */
export function parseRepoRef(input: string, fallback: GitPlatform = 'github'): RepoRef | null {
  let raw = input.trim()
  if (!raw) return null

  let platform: GitPlatform | null = null

  // 1) URL con host conocido.
  const url = raw.match(/^https?:\/\/([^/]+)\/(.+)$/i)
  if (url) {
    const fromHost = platformFromHost(url[1])
    if (!fromHost) return null
    platform = fromHost
    raw = url[2]
  } else {
    // 2) Remoto SSH: git@github.com:owner/repo.git  (gitlab.com también).
    const ssh = raw.match(/^git@([^:]+):(.+)$/i)
    if (ssh) {
      const fromHost = platformFromHost(ssh[1])
      if (!fromHost) return null
      platform = fromHost
      raw = ssh[2]
    } else {
      // 3) Prefijo explícito `plataforma:...`.
      const prefixed = raw.match(/^(github|gitlab|bitbucket)\s*:\s*(.+)$/i)
      if (prefixed) {
        platform = prefixed[1].toLowerCase() as GitPlatform
        raw = prefixed[2]
      }
    }
  }

  // Limpieza: sin query/fragmento, sin `.git` y sin barras sobrantes.
  raw = raw.replace(/[?#].*$/, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  const parts = raw.split('/').filter((p) => p.length > 0)
  if (!validSegments(parts)) return null

  const resolvedPlatform = platform ?? fallback
  const name = parts[parts.length - 1]
  const namespace = parts.slice(0, -1).join('/')
  return { platform: resolvedPlatform, namespace, name, full: `${namespace}/${name}` }
}

/** Nombre canónico guardable: `owner/repo` en GitHub, `gitlab:...` en el resto. */
export function repoKey(ref: RepoRef): string {
  return ref.platform === 'github' ? ref.full : `${ref.platform}:${ref.full}`
}

/** Inversa de `repoKey`: interpreta lo que quedó guardado. */
export function parseRepoKey(key: string): RepoRef | null {
  return parseRepoRef(key)
}

/** Token configurado por entorno para una plataforma (o null). */
export function platformToken(platform: GitPlatform): string | null {
  const value = process.env[GIT_HOSTS[platform].tokenEnv]?.trim()
  return value ? value : null
}

/** True si hay credencial para esa plataforma. */
export function platformTokenConfigured(platform: GitPlatform): boolean {
  return platformToken(platform) !== null
}

export interface PlatformStatus {
  id: GitPlatform
  label: string
  /** Reconocida y con código listo para usarla. */
  implemented: boolean
  /** Tiene token configurado. */
  configured: boolean
  /** Nombre de la variable de entorno que espera. */
  tokenEnv: string
  tokenHint: string
  slugExample: string
}

/** Estado de cada plataforma para el panel de conexiones. */
export function platformStatuses(): PlatformStatus[] {
  return GIT_PLATFORMS.map((id) => {
    const host = GIT_HOSTS[id]
    return {
      id,
      label: host.label,
      implemented: host.implemented,
      configured: platformTokenConfigured(id),
      tokenEnv: host.tokenEnv,
      tokenHint: host.tokenHint,
      slugExample: host.slugExample,
    }
  })
}
