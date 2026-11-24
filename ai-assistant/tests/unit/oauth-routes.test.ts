import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as authGet } from '@/app/api/auth/route'
import { GET as startGet } from '@/app/api/auth/oauth/start/route'
import { GET as callbackGet } from '@/app/api/auth/oauth/callback/route'
import { OAUTH_STATE_COOKIE, providerFromState, verifySessionToken } from '@/app/lib/oauth'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function stubGithub(): void {
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'gh-id')
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'gh-secret')
  vi.stubEnv('GITHUB_OAUTH_ALLOWED_LOGIN', 'pablo')
}

function stubGoogle(): void {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'go-id')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'go-secret')
  vi.stubEnv('GOOGLE_OAUTH_ALLOWED_EMAIL', 'pablo@example.test')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakeFetch(routes: { token?: Response; profile?: Response; emails?: Response }) {
  const calls: string[] = []
  const fetchFn = async (url: string | URL | Request) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/login/oauth/access_token') || target.includes('/oauth2.googleapis.com/token')) {
      return routes.token ?? json({ access_token: 'provider-token' })
    }
    if (target.includes('/api.github.com/user/emails')) {
      return routes.emails ?? json([])
    }
    if (target.includes('/api.github.com/user') || target.includes('/userinfo')) {
      return routes.profile ?? json({ id: 42, login: 'pablo', email: null })
    }
    return json({ error: 'ruta no prevista' }, 404)
  }
  vi.stubGlobal('fetch', fetchFn)
  return { calls, fetchFn }
}

function callbackRequest(state: string, code = 'code-123', cookie = state): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/auth/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { headers: { cookie: `${OAUTH_STATE_COOKIE}=${encodeURIComponent(cookie)}` } },
  )
}

function sessionFrom(html: string): string {
  const match = html.match(/localStorage\.setItem\("aria_access_token",\s*"([^"]+)"\)/)
  if (!match) throw new Error(`No se encontró la sesión en: ${html.slice(0, 400)}`)
  return match[1]
}

describe('/api/auth', () => {
  it('informa si hace falta clave y qué proveedores están configurados', async () => {
    vi.stubEnv('ARIA_ACCESS_TOKEN', 'clave-compartida')
    stubGithub()
    stubGoogle()

    const res = await authGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ required: true, providers: ['github', 'google'] })
  })

  it('sin secret ni proveedores devuelve required=false y lista vacía', async () => {
    vi.stubEnv('ARIA_ACCESS_TOKEN', '')
    const body = (await (await authGet()).json()) as { required: boolean; providers: string[] }
    expect(body.required).toBe(false)
    expect(body.providers).toEqual([])
  })
})

describe('/api/auth/oauth/start', () => {
  it('redirige a GitHub con state y cookie anti-CSRF', async () => {
    stubGithub()
    vi.stubEnv('ARIA_OAUTH_REDIRECT_BASE', 'https://aria.example.test')

    const res = await startGet(new NextRequest('http://localhost:3000/api/auth/oauth/start?provider=github'))
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    const state = location.searchParams.get('state')!
    expect(providerFromState(state)).toBe('github')
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://aria.example.test/api/auth/oauth/callback?provider=github',
    )

    const cookie = res.headers.get('Set-Cookie')!
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('marca la cookie como Secure en producción', async () => {
    stubGithub()
    vi.stubEnv('NODE_ENV', 'production')
    const res = await startGet(new NextRequest('http://localhost:3000/api/auth/oauth/start?provider=github'))
    expect(res.headers.get('Set-Cookie')).toContain('Secure')
  })

  it('rechaza proveedores inválidos y no configurados', async () => {
    const bad = await startGet(new NextRequest('http://localhost:3000/api/auth/oauth/start?provider=gitlab'))
    expect(bad.status).toBe(400)

    const missing = await startGet(new NextRequest('http://localhost:3000/api/auth/oauth/start?provider=google'))
    expect(missing.status).toBe(503)
  })
})

describe('/api/auth/oauth/callback', () => {
  const state = `github.${'a'.repeat(32)}`

  it('rechaza un state que no coincide con la cookie y no llama a la red', async () => {
    const { calls } = fakeFetch({})
    const res = await callbackGet(callbackRequest(state, 'code-123', `github.${'b'.repeat(32)}`))
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('El estado de acceso no coincide')
    expect(calls).toEqual([])
  })

  it('rechaza una petición sin código', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/auth/oauth/callback?state=${encodeURIComponent(state)}`,
      { headers: { cookie: `${OAUTH_STATE_COOKIE}=${state}` } },
    )
    const res = await callbackGet(req)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Falta el código')
  })

  it('entrega una sesión firmada tras validar GitHub', async () => {
    stubGithub()
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    const { calls } = fakeFetch({
      token: json({ access_token: 'gh-token' }),
      profile: json({ id: 42, login: 'pablo', email: null }),
      emails: json([{ email: 'pablo@example.test', primary: true, verified: true }]),
    })

    const res = await callbackGet(callbackRequest(state))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Entrando en ARIA')
    expect(html).not.toContain('code-123')
    expect(html).not.toContain('gh-token')
    expect(await verifySessionToken(sessionFrom(html), process.env)).toBe(true)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(calls.some((url) => url.includes('/login/oauth/access_token'))).toBe(true)
    expect(calls.some((url) => url.includes('/api.github.com/user/emails'))).toBe(true)
  })

  it('entrega una sesión firmada tras validar Google', async () => {
    stubGoogle()
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    fakeFetch({
      token: json({ access_token: 'go-token' }),
      profile: json({ sub: '12345', email: 'pablo@example.test' }),
    })
    const googleState = `google.${'a'.repeat(32)}`

    const res = await callbackGet(callbackRequest(googleState))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(await verifySessionToken(sessionFrom(html), process.env)).toBe(true)
  })

  it('deniega a una identidad que no está en la lista blanca', async () => {
    stubGithub()
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    fakeFetch({
      profile: json({ id: 42, login: 'otra-persona', email: 'otra@example.test' }),
    })

    const res = await callbackGet(callbackRequest(state))
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Esta identidad no tiene acceso')
  })

  it('informa del error del proveedor sin filtrar secretos', async () => {
    stubGithub()
    fakeFetch({ token: json({ error: 'bad_verification_code' }, 400) })

    const res = await callbackGet(callbackRequest(state))
    expect(res.status).toBe(502)
    const html = await res.text()
    expect(html).toContain('No pude completar el acceso')
    expect(html).not.toContain('gh-secret')
  })

  it('falla si no hay secreto con el que firmar la sesión', async () => {
    stubGithub()
    vi.stubEnv('ARIA_ACCESS_TOKEN', '')
    vi.stubEnv('ARIA_SESSION_SECRET', '')
    fakeFetch({})

    const res = await callbackGet(callbackRequest(state))
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('ARIA_SESSION_SECRET')
  })
})
