import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizeUrl,
  clearStateCookie,
  configuredOAuthProviders,
  createSessionToken,
  exchangeCode,
  fetchIdentity,
  getOAuthConfig,
  isAllowedIdentity,
  OAUTH_STATE_COOKIE,
  parseProvider,
  providerFromState,
  readStateCookie,
  redirectUriFor,
  safeEqual,
  serializeStateCookie,
  verifySessionToken,
  type FetchLike,
  type OAuthConfig,
  type OAuthIdentity,
} from '@/app/lib/oauth'

afterEach(() => {
  vi.unstubAllEnvs()
})

function stubGithub(): OAuthConfig {
  return {
    clientId: 'gh-id',
    clientSecret: 'gh-secret',
    allowed: 'pablo',
  }
}

function stubGoogle(): OAuthConfig {
  return {
    clientId: 'go-id',
    clientSecret: 'go-secret',
    allowed: 'PABLO@EXAMPLE.TEST',
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('configuración y proveedores', () => {
  it('parsea solo github y google', () => {
    expect(parseProvider('github')).toBe('github')
    expect(parseProvider('google')).toBe('google')
    expect(parseProvider('GitLab')).toBeNull()
    expect(parseProvider(undefined)).toBeNull()
  })

  it('un proveedor solo se ofrece si están cliente, secreto y usuario permitido', () => {
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'gh-id')
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'gh-secret')
    expect(configuredOAuthProviders()).toEqual([])

    vi.stubEnv('GITHUB_OAUTH_ALLOWED_LOGIN', 'pablo')
    expect(configuredOAuthProviders()).toEqual(['github'])

    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'go-id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'go-secret')
    vi.stubEnv('GOOGLE_OAUTH_ALLOWED_EMAIL', 'pablo@example.test')
    expect(configuredOAuthProviders()).toEqual(['github', 'google'])
  })

  it('getOAuthConfig recorta espacios y devuelve null si falta algo', () => {
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', '  gh-id  ')
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', ' gh-secret ')
    vi.stubEnv('GITHUB_OAUTH_ALLOWED_LOGIN', ' pablo ')
    expect(getOAuthConfig('github')).toEqual({
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
      allowed: 'pablo',
    })

    vi.stubEnv('GITHUB_OAUTH_ALLOWED_LOGIN', '   ')
    expect(getOAuthConfig('github')).toBeNull()
  })
})

describe('URL de autorización y estado anti-CSRF', () => {
  it('usa la base pública configurada y quita barras finales', () => {
    vi.stubEnv('ARIA_OAUTH_REDIRECT_BASE', 'https://aria.example.test/')
    expect(redirectUriFor('github', process.env)).toBe(
      'https://aria.example.test/api/auth/oauth/callback?provider=github',
    )
  })

  it('sin base pública usa el origen de la petición', () => {
    expect(redirectUriFor('google', { NODE_ENV: 'test' }, 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/auth/oauth/callback?provider=google',
    )
  })

  it('construye la URL de GitHub con scope, state y redirect_uri', () => {
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'gh-id')
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'gh-secret')
    vi.stubEnv('GITHUB_OAUTH_ALLOWED_LOGIN', 'pablo')
    vi.stubEnv('ARIA_OAUTH_REDIRECT_BASE', 'https://aria.example.test')

    const url = new URL(
      buildAuthorizeUrl('github', 'github.abc123', process.env, 'http://localhost:3000'),
    )
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('gh-id')
    expect(url.searchParams.get('scope')).toBe('read:user user:email')
    expect(url.searchParams.get('state')).toBe('github.abc123')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://aria.example.test/api/auth/oauth/callback?provider=github',
    )
  })

  it('construye la URL de Google con su scope', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'go-id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'go-secret')
    vi.stubEnv('GOOGLE_OAUTH_ALLOWED_EMAIL', 'pablo@example.test')

    const url = new URL(
      buildAuthorizeUrl('google', 'google.abc123', process.env, 'http://localhost:3000'),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/oauth/callback?provider=google',
    )
  })

  it('falla si el proveedor no está configurado', () => {
    expect(() => buildAuthorizeUrl('github', 'github.abc123', { NODE_ENV: 'test' }, 'http://localhost:3000')).toThrow(
      /OAuth no configurado/,
    )
  })

  it('extrae el proveedor del estado solo si tiene forma válida', () => {
    expect(providerFromState('github.12345678901234567890')).toBe('github')
    expect(providerFromState('google.12345678901234567890')).toBe('google')
    expect(providerFromState('gitlab.12345678901234567890')).toBeNull()
    expect(providerFromState('github.short')).toBeNull()
    expect(providerFromState('sin-punto')).toBeNull()
  })

  it('compara el estado en tiempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })

  it('la cookie de estado es HttpOnly y solo Secure cuando se pide', () => {
    const insecure = serializeStateCookie('github.abc', false)
    expect(insecure).toContain(`${OAUTH_STATE_COOKIE}=github.abc`)
    expect(insecure).toContain('HttpOnly')
    expect(insecure).toContain('SameSite=Lax')
    expect(insecure).toContain('Path=/api/auth/oauth')
    expect(insecure).not.toContain('Secure')

    expect(serializeStateCookie('github.abc', true)).toContain('Secure')
    expect(clearStateCookie(true)).toContain('Max-Age=0')
  })

  it('lee la cookie de estado y tolera valores mal codificados', () => {
    const req = new Request('https://aria.test/api/auth/oauth/callback', {
      headers: { cookie: `otra=1; ${OAUTH_STATE_COOKIE}=github.abc123; mas=2` },
    })
    expect(readStateCookie(req)).toBe('github.abc123')

    const bad = new Request('https://aria.test/', {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=%E0%A4%A` },
    })
    expect(readStateCookie(bad)).toBeNull()
    expect(readStateCookie(new Request('https://aria.test/'))).toBeNull()
  })
})

describe('canje de código y perfil', () => {
  it('GitHub canjea con JSON y devuelve el access_token', async () => {
    let seen: RequestInit | undefined
    const fetchFn: FetchLike = async (_url, init) => {
      seen = init
      return jsonResponse({ access_token: 'gh-token' })
    }

    await expect(
      exchangeCode(
        'github',
        'code-123',
        stubGithub(),
        'https://aria.test/api/auth/oauth/callback?provider=github',
        fetchFn,
      ),
    ).resolves.toBe('gh-token')
    expect(seen?.method).toBe('POST')
    expect(JSON.parse(String(seen?.body))).toMatchObject({
      client_id: 'gh-id',
      client_secret: 'gh-secret',
      code: 'code-123',
    })
  })

  it('Google canjea con form-urlencoded y grant_type', async () => {
    let seen: RequestInit | undefined
    const fetchFn: FetchLike = async (_url, init) => {
      seen = init
      return jsonResponse({ access_token: 'go-token' })
    }

    await expect(
      exchangeCode(
        'google',
        'code-456',
        stubGoogle(),
        'https://aria.test/api/auth/oauth/callback?provider=google',
        fetchFn,
      ),
    ).resolves.toBe('go-token')
    const body = new URLSearchParams(String(seen?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_secret')).toBe('go-secret')
    expect(body.get('redirect_uri')).toBe(
      'https://aria.test/api/auth/oauth/callback?provider=google',
    )
  })

  it('rechaza respuestas de error sin filtrar secretos', async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ error: 'bad_verification_code' }, 400)
    await expect(
      exchangeCode('github', 'malo', stubGithub(), 'https://aria.test/cb', fetchFn),
    ).rejects.toThrow(/rechazó el código \(400\)/)

    const noToken: FetchLike = async () => jsonResponse({})
    await expect(
      exchangeCode('google', 'malo', stubGoogle(), 'https://aria.test/cb', noToken),
    ).rejects.toThrow(/access_token/)
  })

  it('GitHub completa el email con el principal verificado', async () => {
    const calls: string[] = []
    const fetchFn: FetchLike = async (url) => {
      calls.push(url)
      if (url.endsWith('/user')) {
        return jsonResponse({ id: 42, login: 'pablo', email: null })
      }
      return jsonResponse([
        { email: 'otro@example.test', primary: false, verified: true },
        { email: 'pablo@example.test', primary: true, verified: true },
      ])
    }

    const identity = await fetchIdentity('github', 'gh-token', fetchFn)
    expect(identity).toEqual({
      provider: 'github',
      id: '42',
      name: 'pablo',
      email: 'pablo@example.test',
    })
    expect(calls[1]).toBe('https://api.github.com/user/emails')
  })

  it('Google lee sub y email del userinfo', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ sub: '12345', email: 'pablo@example.test', name: 'Pablo' })

    await expect(fetchIdentity('google', 'go-token', fetchFn)).resolves.toEqual({
      provider: 'google',
      id: '12345',
      name: 'pablo@example.test',
      email: 'pablo@example.test',
    })
  })

  it('falla si el perfil no trae lo necesario o responde error', async () => {
    const bad: FetchLike = async () => jsonResponse({ id: 42 }, 500)
    await expect(fetchIdentity('github', 'x', bad)).rejects.toThrow(/perfil \(500\)/)

    const empty: FetchLike = async () => jsonResponse({ sub: '12345' })
    await expect(fetchIdentity('google', 'x', empty)).rejects.toThrow(/sub y email/)
  })
})

describe('lista blanca de un solo usuario', () => {
  const github: OAuthIdentity = { provider: 'github', id: '42', name: 'Pablo', email: null }
  const google: OAuthIdentity = {
    provider: 'google',
    id: '1',
    name: 'pablo@example.test',
    email: 'pablo@example.test',
  }

  it('acepta solo la identidad configurada, sin distinguir mayúsculas', () => {
    expect(isAllowedIdentity(github, stubGithub())).toBe(true)
    expect(isAllowedIdentity(google, stubGoogle())).toBe(true)
  })

  it('rechaza a cualquier otra persona', () => {
    expect(isAllowedIdentity({ ...github, name: 'otra' }, stubGithub())).toBe(false)
    expect(
      isAllowedIdentity({ ...google, email: 'otra@example.test' }, stubGoogle()),
    ).toBe(false)
  })
})

describe('token de sesión firmado', () => {
  const identities: OAuthIdentity[] = [
    { provider: 'github', id: '42', name: 'pablo', email: null },
    { provider: 'google', id: '1', name: 'pablo@example.test', email: 'pablo@example.test' },
  ]

  it('acepta ambos proveedores y conserva la identidad', async () => {
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    for (const identity of identities) {
      const token = await createSessionToken(identity, process.env, 1_000_000)
      expect(token).toBeTruthy()
      // Verificamos con el mismo instante para no depender del reloj del test.
      await expect(verifySessionToken(token!, process.env, 1_000_001)).resolves.toBe(true)
    }
  })

  it('rechaza otro secreto, firma manipulada y caducidad', async () => {
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    vi.stubEnv('ARIA_SESSION_TTL_SECONDS', '60')
    const token = await createSessionToken(identities[0], process.env, 1_000_000)
    const [body, signature] = token!.split('.')
    const flip = (value: string) => (value[0] === 'a' ? `b${value.slice(1)}` : `a${value.slice(1)}`)

    const otro = { ...process.env, ARIA_SESSION_SECRET: 'otro-secreto' }
    expect(await verifySessionToken(token!, otro, 1_000_001)).toBe(false)
    expect(await verifySessionToken(`${flip(body)}.${signature}`, process.env, 1_000_001)).toBe(false)
    expect(await verifySessionToken(`${body}.${flip(signature)}`, process.env, 1_000_001)).toBe(false)
    expect(await verifySessionToken('basura', process.env, 1_000_001)).toBe(false)
    expect(await verifySessionToken(token!, process.env, 2_000_000)).toBe(false)
  })

  it('sin secreto no crea ni verifica sesiones', async () => {
    expect(await createSessionToken(identities[0], { NODE_ENV: 'test' })).toBeNull()
    expect(await verifySessionToken('abc.def', { NODE_ENV: 'test' })).toBe(false)
  })
})
