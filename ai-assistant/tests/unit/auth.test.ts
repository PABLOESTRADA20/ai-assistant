import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, isAuthRequired, isAuthorized, requireAuth } from '@/app/lib/auth'

const saved = process.env.ARIA_ACCESS_TOKEN

afterEach(() => {
  if (saved === undefined) delete process.env.ARIA_ACCESS_TOKEN
  else process.env.ARIA_ACCESS_TOKEN = saved
  vi.unstubAllEnvs()
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://aria.test/api/chat', { headers })
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

  it('acepta la cookie aria_token de respaldo', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(isAuthorized(req({ cookie: 'aria_token=super-secreta' }))).toBe(true)
    expect(isAuthorized(req({ cookie: 'aria_token=mala' }))).toBe(false)
  })
})

describe('requireAuth', () => {
  it('devuelve null cuando la petición está autorizada', () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    expect(requireAuth(req({ authorization: 'Bearer super-secreta' }))).toBeNull()
  })

  it('devuelve 401 con WWW-Authenticate cuando no lo está', async () => {
    process.env.ARIA_ACCESS_TOKEN = 'super-secreta'
    const denied = requireAuth(req())
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(401)
    expect(denied!.headers.get('WWW-Authenticate')).toBe('Bearer')
    const body = (await denied!.json()) as { code: string }
    expect(body.code).toBe('unauthorized')
  })
})

// La app debe fallar CERRADA en producción si falta el secret: un deploy sin
// ARIA_ACCESS_TOKEN no puede quedar abierto. En dev/tests sigue abierta.
describe('fail-closed en producción', () => {
  it('sin secret: exige autenticación y deniega todo', () => {
    delete process.env.ARIA_ACCESS_TOKEN
    vi.stubEnv('NODE_ENV', 'production')
    expect(isAuthRequired()).toBe(true)
    expect(isAuthorized(req())).toBe(false)
    const denied = requireAuth(req())
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
