import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, isAuthRequired, isAuthorized, requireAuth } from '@/app/lib/auth'
import { createSessionToken } from '@/app/lib/oauth'

const saved = process.env.ARIA_ACCESS_TOKEN

afterEach(() => {
  if (saved === undefined) delete process.env.ARIA_ACCESS_TOKEN
  else process.env.ARIA_ACCESS_TOKEN = saved
  vi.unstubAllEnvs()
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://aria.test/api/chat', { headers })
}

const identity = {
  provider: 'github' as const,
  id: '42',
  name: 'pablo',
  email: 'pablo@example.test',
}

describe('getAccessToken / isAuthRequired', () => {
  it('sin secret la app queda abierta', () => {
    delete process.env.ARIA_ACCESS_TOKEN
    expect(getAccessToken()).toBeNull()
    expect(isAuthRequired()).toBe(false)
  })

  it('con secret exige autenticación', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(getAccessToken()).toBe('super-secreta')
    expect(isAuthRequired()).toBe(true)
  })

  it('un valor en blanco cuenta como no configurado', () => {
    process.env.ARIA_ACCESS_TOKEN = '   '
    expect(getAccessToken()).toBeNull()
    expect(isAuthRequired()).toBe(false)
  })
})

describe('isAuthorized', () => {
  it('sin token configurado todo pasa', () => {
    delete process.env.ARIA_ACCESS_TOKEN
    expect(isAuthorized(req())).toBe(true)
  })

  it('con token: el Bearer correcto pasa y el incorrecto no', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(isAuthorized(req({ authorization: 'Bearer super-secreta' }))).toBe(true)
    expect(isAuthorized(req({ authorization: 'Bearer otra-clave' }))).toBe(false)
    expect(isAuthorized(req())).toBe(false)
  })

  it('la cookie aria_token ya no autoriza', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(isAuthorized(req({ cookie: 'aria_token=super-secreta' }))).toBe(false)
  })

  it('una cookie mal formada devuelve 401 sin lanzar excepción', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    const malformed = req({ cookie: 'aria_token=%E0%A4%A' })

    expect(() => isAuthorized(malformed)).not.toThrow()
    expect(isAuthorized(malformed)).toBe(false)
    expect((await requireAuth(malformed))!.status).toBe(401)
  })

  it('el Bearer funciona aunque haya una cookie basura', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(
      isAuthorized(
        req({
          authorization: 'Bearer super-secreta',
          cookie: 'basura=1; aria_token=%E0%A4%A',
        }),
      ),
    ).toBe(true)
  })

  it('rechaza Bearer vacío y esquemas distintos de Bearer', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(isAuthorized(req({ authorization: 'Bearer ' }))).toBe(false)
    expect(isAuthorized(req({ authorization: 'Bearer' }))).toBe(false)
    expect(isAuthorized(req({ authorization: 'Basic super-secreta' }))).toBe(false)
  })
})

describe('requireAuth', () => {
  it('devuelve null cuando la petición está autorizada', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(await requireAuth(req({ authorization: 'Bearer super-secreta' }))).toBeNull()
  })

  it('devuelve 401 con WWW-Authenticate cuando no lo está', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    const denied = await requireAuth(req())
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(401)
    expect(denied!.headers.get('WWW-Authenticate')).toBe('Bearer')
    const body = (await denied!.json()) as { code: string }
    expect(body.code).toBe('unauthorized')
  })
})

// FASE 7: la sesión OAuth viaja en la misma cabecera que la clave compartida.
// `isAuthorized` sigue siendo síncrono (solo compara la clave); `requireAuth`
// es quien verifica la firma con Web Crypto.
describe('sesión OAuth firmada', () => {
  it('acepta un token de sesión aunque la clave compartida sea distinta', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'clave-compartida'
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    const session = await createSessionToken(identity, process.env, Date.now())

    expect(isAuthorized(req({ authorization: `Bearer ${session}` }))).toBe(false)
    expect(await requireAuth(req({ authorization: `Bearer ${session}` }))).toBeNull()
  })

  it('acepta la sesión en producción sin ARIA_ACCESS_TOKEN', async () => {
    delete process.env.ARIA_ACCESS_TOKEN
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    const session = await createSessionToken(identity, process.env, Date.now())

    expect(isAuthRequired()).toBe(true)
    expect(await requireAuth(req({ authorization: `Bearer ${session}` }))).toBeNull()
    expect(await requireAuth(req())).not.toBeNull()
  })

  it('usa ARIA_ACCESS_TOKEN como secreto de sesión si no hay otro', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'clave-compartida'
    const session = await createSessionToken(identity, process.env, Date.now())
    expect(await requireAuth(req({ authorization: `Bearer ${session}` }))).toBeNull()
  })

  it('rechaza una sesión manipulada o caducada', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'clave-compartida'
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    vi.stubEnv('ARIA_SESSION_TTL_SECONDS', '60')
    const now = Date.now()
    const session = await createSessionToken(identity, process.env, now)
    const expired = await createSessionToken(identity, process.env, now - 120_000)
    const [body, signature] = session!.split('.')
    const flip = (value: string) => (value[0] === 'a' ? `b${value.slice(1)}` : `a${value.slice(1)}`)

    expect(
      await requireAuth(req({ authorization: `Bearer ${flip(body)}.${signature}` })),
    ).not.toBeNull()
    expect(
      await requireAuth(req({ authorization: `Bearer ${body}.${flip(signature)}` })),
    ).not.toBeNull()
    expect(
      await requireAuth(req({ authorization: `Bearer ${expired}` })),
    ).not.toBeNull()
  })

  it('la cookie de estado OAuth nunca autoriza', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'clave-compartida'
    vi.stubEnv('ARIA_SESSION_SECRET', 'secreto-de-sesion')
    const session = await createSessionToken(identity, process.env, Date.now())

    expect(
      await requireAuth(req({ cookie: `aria_oauth_state=github.abc; aria_token=${session!}` })),
    ).not.toBeNull()
  })
})

// La app debe fallar CERRADA en producción si falta el secret: un deploy sin
// ARIA_ACCESS_TOKEN no puede quedar abierto. En dev/tests sigue abierta.
describe('fail-closed en producción', () => {
  it('sin secret: exige autenticación y deniega todo', async () => {
    delete process.env.ARIA_ACCESS_TOKEN
    vi.stubEnv('NODE_ENV', 'production')
    expect(isAuthRequired()).toBe(true)
    expect(isAuthorized(req())).toBe(false)
    const denied = await requireAuth(req())
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(401)
  })

  it('con secret: sigue exigiendo el Bearer correcto', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    vi.stubEnv('NODE_ENV', 'production')
    expect(isAuthRequired()).toBe(true)
    expect(isAuthorized(req({ authorization: 'Bearer super-secreta' }))).toBe(true)
    expect(isAuthorized(req())).toBe(false)
  })
})
