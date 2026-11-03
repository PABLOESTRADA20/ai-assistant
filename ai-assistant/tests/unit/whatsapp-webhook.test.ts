import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sessionContext: { create: vi.fn() },
  message: { create: vi.fn(), findMany: vi.fn() },
  conversation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}))

const memoryMock = vi.hoisted(() => ({
  getContext: vi.fn(),
  setContext: vi.fn(),
}))

const replyMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/app/lib/memory', () => memoryMock)
vi.mock('@/app/lib/background', () => ({
  registerBackground: (promise: Promise<unknown>) => promise,
}))
vi.mock('@/app/lib/aria-core', () => ({ DEFAULT_MODEL: 'test-model' }))
vi.mock('@/app/lib/aria-reply', () => ({ generateTextReply: replyMock }))

import { GET, POST } from '@/app/api/whatsapp/webhook/route'

const SECRET = 'app-secret-de-prueba'

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

function payload(options: { id?: string; from?: string; text?: string; name?: string } = {}) {
  const { id = 'wamid.1', from = '51999000111', text = 'Hola ARIA', name = 'Ana' } = options
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name } }],
              messages: [{ from, id, timestamp: '1700000000', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  }
}

function postRequest(body: string, signature?: string): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (signature) headers.set('x-hub-signature-256', signature)
  return new NextRequest('https://aria.test/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body,
  })
}

function getRequest(params: Record<string, string>): NextRequest {
  const url = new URL('https://aria.test/api/whatsapp/webhook')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

async function validPost(input: Parameters<typeof payload>[0] = {}): Promise<Response> {
  const body = JSON.stringify(payload(input))
  return POST(postRequest(body, await sign(SECRET, body)))
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.stubEnv('WHATSAPP_TOKEN', 'EAAB-token')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '12345')
  vi.stubEnv('WHATSAPP_APP_SECRET', SECRET)
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'verify-123')
  vi.stubEnv('WHATSAPP_ALLOWED_NUMBERS', '')
  vi.stubEnv('GROQ_API_KEY', 'groq-test')

  prismaMock.sessionContext.create.mockResolvedValue({})
  prismaMock.message.create.mockResolvedValue({})
  prismaMock.message.findMany.mockResolvedValue([])
  prismaMock.conversation.create.mockResolvedValue({ id: 'conv-1', title: 'WhatsApp Ana' })
  prismaMock.conversation.findUnique.mockResolvedValue(null)
  prismaMock.conversation.update.mockResolvedValue({})
  memoryMock.getContext.mockResolvedValue(null)
  memoryMock.setContext.mockResolvedValue(undefined)
  replyMock.mockResolvedValue({ text: 'Hola desde ARIA' })

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET de verificación', () => {
  it('devuelve el challenge con el verify token correcto', async () => {
    const res = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-123', 'hub.challenge': 'abc' }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc')
  })

  it('rechaza token incorrecto o ausente', async () => {
    const wrong = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': 'abc' }),
    )
    expect(wrong.status).toBe(403)

    const missing = await GET(
      getRequest({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc' }),
    )
    expect(missing.status).toBe(403)
  })
})

describe('POST del webhook', () => {
  it('sin app secret responde 200 sin procesar, aunque haya lista blanca', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    vi.stubEnv('WHATSAPP_ALLOWED_NUMBERS', '51999000111')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(JSON.stringify(payload()), 'sha256=lo-que-sea'))

    expect(res.status).toBe(200)
    expect(prismaMock.sessionContext.create).not.toHaveBeenCalled()
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    expect(replyMock).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('WHATSAPP_APP_SECRET'))
  })

  it('con firma inválida responde 401 y no toca la base', async () => {
    const res = await POST(postRequest(JSON.stringify(payload()), 'sha256=deadbeef'))
    expect(res.status).toBe(401)
    expect(prismaMock.sessionContext.create).not.toHaveBeenCalled()
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('con firma válida procesa el mensaje y responde', async () => {
    const res = await validPost()

    expect(res.status).toBe(200)
    expect(prismaMock.sessionContext.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.sessionContext.create.mock.calls[0][0].data.key).toBe('whatsapp:msg:wamid.1')
    expect(prismaMock.message.create).toHaveBeenCalledTimes(2)
    expect(replyMock).toHaveBeenCalledTimes(1)
  })

  it('un reintento del mismo messageId no se procesa dos veces', async () => {
    prismaMock.sessionContext.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicado'), { code: 'P2002' }),
    )

    const res = await validPost()

    expect(res.status).toBe(200)
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    expect(replyMock).not.toHaveBeenCalled()
  })

  it('dos messageId distintos se procesan los dos', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Ana' } }],
                messages: [
                  { from: '51999000111', id: 'wamid.1', type: 'text', text: { body: 'Uno' } },
                  { from: '51999000111', id: 'wamid.2', type: 'text', text: { body: 'Dos' } },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await POST(postRequest(body, await sign(SECRET, body)))

    expect(res.status).toBe(200)
    expect(prismaMock.sessionContext.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.sessionContext.create.mock.calls.map((c) => c[0].data.key)).toEqual([
      'whatsapp:msg:wamid.1',
      'whatsapp:msg:wamid.2',
    ])
    expect(replyMock).toHaveBeenCalledTimes(2)
  })

  it('la lista blanca descarta números no autorizados', async () => {
    vi.stubEnv('WHATSAPP_ALLOWED_NUMBERS', '51999000111')

    const res = await validPost({ from: '51999000222' })

    expect(res.status).toBe(200)
    expect(prismaMock.sessionContext.create).not.toHaveBeenCalled()
    expect(prismaMock.message.create).not.toHaveBeenCalled()
    expect(replyMock).not.toHaveBeenCalled()
  })
})
