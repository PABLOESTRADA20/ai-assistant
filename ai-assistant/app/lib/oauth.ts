/**
 * OAuth de un solo usuario (FASE 7).
 *
 * GitHub/Google solo sirven para *identificar* al dueño de ARIA: el resultado
 * es un token de sesión firmado que viaja igual que la clave compartida, en
 * `Authorization: Bearer`. La cookie `aria_oauth_state` es solo anti-CSRF y
 * nunca autoriza nada. Ningún secreto de OAuth se guarda en la BD.
 *
 * Todo lo de aquí es independiente de Next y de la red: los `fetch` se
 * inyectan para poder probar el flujo sin salir a internet.
 */

export type OAuthProvider = 'github' | 'google'
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  /** Login de GitHub o email de Google permitido (una sola persona). */
  allowed: string
}

export interface OAuthIdentity {
  provider: OAuthProvider
  /** Identificador estable del proveedor. */
  id: string
  /** Login de GitHub o email de Google (para mostrar y para la auditoría). */
  name: string
  email?: string | null
}

interface ProviderSpec {
  clientIdEnv: string
  clientSecretEnv: string
  allowedEnv: string
  authorizeUrl: string
  tokenUrl: string
  profileUrl: string
  scope: string
}

const PROVIDERS: Record<OAuthProvider, ProviderSpec> = {
  github: {
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    allowedEnv: 'GITHUB_OAUTH_ALLOWED_LOGIN',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
  google: {
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    allowedEnv: 'GOOGLE_OAUTH_ALLOWED_EMAIL',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
}

export const OAUTH_STATE_COOKIE = 'aria_oauth_state'
export const OAUTH_STATE_MAX_AGE = 600
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

function clean(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function parseProvider(value: unknown): OAuthProvider | null {
  return value === 'github' || value === 'google' ? value : null
}

/** Config completa (incluido el usuario permitido), o null si falta algo. */
export function getOAuthConfig(
  provider: OAuthProvider,
  env: NodeJS.ProcessEnv = process.env,
): OAuthConfig | null {
  const spec = PROVIDERS[provider]
  const clientId = clean(env[spec.clientIdEnv])
  const clientSecret = clean(env[spec.clientSecretEnv])
  const allowed = clean(env[spec.allowedEnv])
  if (!clientId || !clientSecret || !allowed) return null
  return { clientId, clientSecret, allowed }
}

/** Proveedores que el cliente debe ofrecer en la pantalla de acceso. */
export function configuredOAuthProviders(env: NodeJS.ProcessEnv = process.env): OAuthProvider[] {
  return (['github', 'google'] as OAuthProvider[]).filter((p) => getOAuthConfig(p, env) !== null)
}

export function redirectUriFor(
  provider: OAuthProvider,
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin = '',
): string {
  const configured = clean(env.ARIA_OAUTH_REDIRECT_BASE)
  const origin = (configured || requestOrigin).replace(/\/+$/, '')
  return `${origin}/api/auth/oauth/callback?provider=${provider}`
}

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin = '',
): string {
  const config = getOAuthConfig(provider, env)
  if (!config) throw new Error(`OAuth no configurado para ${provider}.`)
  const url = new URL(PROVIDERS[provider].authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUriFor(provider, env, requestOrigin))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', PROVIDERS[provider].scope)
  url.searchParams.set('state', state)
  return url.toString()
}

/** Comparación en tiempo constante (estado anti-CSRF). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function newOAuthState(provider: OAuthProvider): string {
  return `${provider}.${crypto.randomUUID()}`
}

/** Devuelve el proveedor codificado en el estado, o null si está mal formado. */
export function providerFromState(state: string): OAuthProvider | null {
  const dot = state.indexOf('.')
  if (dot < 1 || state.length - dot < 20) return null
  return parseProvider(state.slice(0, dot))
}

export function serializeStateCookie(state: string, secure: boolean): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Path=/api/auth/oauth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${OAUTH_STATE_MAX_AGE}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearStateCookie(secure: boolean): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=`,
    'Path=/api/auth/oauth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function readStateCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName !== OAUTH_STATE_COOKIE) continue
    try {
      return decodeURIComponent(rest.join('='))
    } catch {
      return null
    }
  }
  return null
}

/** Canjea el code por un access_token del proveedor. Nunca guarda ese token. */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  config: OAuthConfig,
  redirectUri: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const spec = PROVIDERS[provider]
  const isGithub = provider === 'github'
  const init: RequestInit = isGithub
    ? {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      }
    : {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      }

  const res = await fetchFn(spec.tokenUrl, init)
  if (!res.ok) throw new Error(`El proveedor rechazó el código (${res.status}).`)
  const data = (await res.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'El proveedor no devolvió access_token.')
  }
  return data.access_token
}

/** Lee la identidad del usuario y, en GitHub, su email principal verificado. */
export async function fetchIdentity(
  provider: OAuthProvider,
  accessToken: string,
  fetchFn: FetchLike = fetch,
): Promise<OAuthIdentity> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'ARIA-Assistant',
  }
  const res = await fetchFn(PROVIDERS[provider].profileUrl, { headers })
  if (!res.ok) throw new Error(`No pude leer el perfil (${res.status}).`)
  const profile = (await res.json()) as {
    id?: number | string
    sub?: string
    login?: string
    email?: string | null
  }

  if (provider === 'google') {
    const id = clean(profile.sub)
    const email = clean(profile.email)
    if (!id || !email) throw new Error('Google no devolvió sub y email.')
    return { provider, id, name: email, email }
  }

  const id = profile.id === undefined ? '' : String(profile.id)
  const login = clean(profile.login)
  if (!id || !login) throw new Error('GitHub no devolvió id y login.')
  let email = clean(profile.email)
  if (!email) {
    const emailsRes = await fetchFn('https://api.github.com/user/emails', { headers })
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as {
        email?: string
        primary?: boolean
        verified?: boolean
      }[]
      email = clean(emails.find((e) => e.primary && e.verified)?.email)
    }
  }
  return { provider, id, name: login, email: email || null }
}

/** Lista blanca de una sola persona. Sin config, nadie entra. */
export function isAllowedIdentity(identity: OAuthIdentity, config: OAuthConfig): boolean {
  const allowed = config.allowed.toLowerCase()
  return identity.provider === 'google'
    ? (identity.email ?? '').toLowerCase() === allowed
    : identity.name.toLowerCase() === allowed
}

/* ----------------------- token de sesión firmado (HMAC) ------------------ */

interface SessionPayload {
  v: 1
  sub: string
  provider: OAuthProvider
  name: string
  iat: number
  exp: number
}

function sessionSecret(env: NodeJS.ProcessEnv): string {
  return clean(env.ARIA_SESSION_SECRET) || clean(env.ARIA_ACCESS_TOKEN)
}

function sessionTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.ARIA_SESSION_TTL_SECONDS)
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_TTL_SECONDS
  return Math.min(Math.max(seconds, 60), 30 * 24 * 60 * 60) * 1000
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(env: NodeJS.ProcessEnv): Promise<CryptoKey | null> {
  const secret = sessionSecret(env)
  if (!secret) return null
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Token opaco para el cliente; null si no hay secreto con qué firmarlo. */
export async function createSessionToken(
  identity: OAuthIdentity,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<string | null> {
  const key = await hmacKey(env)
  if (!key) return null
  const payload: SessionPayload = {
    v: 1,
    sub: `${identity.provider}:${identity.id}`,
    provider: identity.provider,
    name: identity.name,
    iat: now,
    exp: now + sessionTtlMs(env),
  }
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  )
  return `${body}.${toBase64Url(signature)}`
}

/** Verifica firma, versión y caducidad. Nunca lanza: devuelve false. */
export async function verifySessionToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<boolean> {
  const key = await hmacKey(env)
  if (!key) return false
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  try {
    const signatureBytes = fromBase64Url(parts[1])
    if (signatureBytes.length !== 32) return false
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(parts[0]),
    )
    if (!valid) return false
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]))) as SessionPayload
    return (
      payload.v === 1 &&
      typeof payload.sub === 'string' &&
      typeof payload.name === 'string' &&
      (payload.provider === 'github' || payload.provider === 'google') &&
      typeof payload.exp === 'number' &&
      payload.iat <= now + 60_000 &&
      now < payload.exp
    )
  } catch {
    return false
  }
}
