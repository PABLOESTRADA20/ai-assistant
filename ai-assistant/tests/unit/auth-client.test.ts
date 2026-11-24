import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAuthInfo,
  fetchAuthRequired,
  oauthStartHref,
  TOKEN_KEY,
} from '@/app/lib/auth-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('oauthStartHref', () => {
  it('apunta al endpoint de inicio con el proveedor codificado', () => {
    expect(TOKEN_KEY).toBe('aria_access_token')
    expect(oauthStartHref('github')).toBe('/api/auth/oauth/start?provider=github')
    expect(oauthStartHref('google')).toBe('/api/auth/oauth/start?provider=google')
  })
})

describe('fetchAuthInfo', () => {
  it('lee required y filtra proveedores desconocidos', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      calls.push(String(input))
      return jsonResponse({ required: true, providers: ['github', 'gitlab', 'google'] })
    })

    await expect(fetchAuthInfo()).resolves.toEqual({
      required: true,
      providers: ['github', 'google'],
    })
    expect(calls).toEqual(['/api/auth'])
    await expect(fetchAuthRequired()).resolves.toBe(true)
  })

  it('devuelve el estado vacío si el servidor responde mal', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ required: true }, 500))
    await expect(fetchAuthInfo()).resolves.toEqual({ required: false, providers: [] })
  })

  it('devuelve el estado vacío si no hay red', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('sin red')
    })
    await expect(fetchAuthInfo()).resolves.toEqual({ required: false, providers: [] })
    await expect(fetchAuthRequired()).resolves.toBe(false)
  })

  it('tolera respuestas sin los campos esperados', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ required: 'si', providers: 'github' }))
    await expect(fetchAuthInfo()).resolves.toEqual({ required: false, providers: [] })
  })
})
