import { afterEach, describe, expect, it } from 'vitest'
import {
  allowedNumbers,
  isWhatsAppConfigured,
  markdownToWhatsApp,
  parseIncoming,
  verifyMetaSignature,
} from '@/app/lib/whatsapp'

/** HMAC-SHA256 en hex con el mismo formato que espera Meta (`sha256=...`). */
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

describe('parseIncoming', () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: 'Ana' } }],
              messages: [
                { from: '51999000111', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'Hola ARIA' } },
                { from: '51999000222', id: 'wamid.2', type: 'button', button: { text: 'Modo oscuro' } },
                {
                  from: '51999000333',
                  id: 'wamid.3',
                  type: 'interactive',
                  interactive: { button_reply: { title: 'Sí, seguir' } },
                },
                { from: '51999000444', id: 'wamid.4', type: 'text', text: { body: '   ' } },
                { from: '51999000555', type: 'text', text: { body: 'sin id se ignora' } },
              ],
            },
          },
        ],
      },
    ],
  }

  it('extrae text, button e interactive y descarta los incompletos', () => {
    const out = parseIncoming(payload)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({
      from: '51999000111',
      name: 'Ana',
      text: 'Hola ARIA',
      messageId: 'wamid.1',
      timestamp: '1700000000',
    })
    expect(out[1].text).toBe('Modo oscuro')
    expect(out[2].text).toBe('Sí, seguir')
  })

  it('propaga el nombre del contacto a todos los mensajes', () => {
    const out = parseIncoming(payload)
    expect(out.every((m) => m.name === 'Ana')).toBe(true)
  })

  it('devuelve [] con payloads vacíos o malformados', () => {
    expect(parseIncoming(undefined)).toEqual([])
    expect(parseIncoming(null)).toEqual([])
    expect(parseIncoming({})).toEqual([])
    expect(parseIncoming({ entry: [] })).toEqual([])
    expect(parseIncoming({ entry: [{ changes: [{ value: {} }] }] })).toEqual([])
  })
})

describe('markdownToWhatsApp', () => {
  it('convierte negritas a *asteriscos* de WhatsApp', () => {
    expect(markdownToWhatsApp('esto es **importante**')).toBe('esto es *importante*')
  })

  it('convierte encabezados en texto destacado', () => {
    expect(markdownToWhatsApp('# Título')).toBe('*Título*')
    expect(markdownToWhatsApp('## Subtítulo')).toBe('*Subtítulo*')
  })

  it('convierte separadores en línea sólida', () => {
    expect(markdownToWhatsApp('---')).toBe('────────')
  })

  it('deja el texto plano intacto', () => {
    expect(markdownToWhatsApp('texto normal sin formato')).toBe('texto normal sin formato')
  })

  it('procesa varias líneas a la vez', () => {
    expect(markdownToWhatsApp('# Intro\nTexto **fuerte**\n---')).toBe(
      '*Intro*\nTexto *fuerte*\n────────',
    )
  })
})

describe('verifyMetaSignature', () => {
  it('acepta la firma correcta del body', async () => {
    const body = '{"object":"page","entry":[]}'
    const sig = await sign('app-secret', body)
    expect(await verifyMetaSignature('app-secret', body, sig)).toBe(true)
  })

  it('rechaza body alterado o secreto distinto', async () => {
    const sig = await sign('app-secret', '{"hola":1}')
    expect(await verifyMetaSignature('app-secret', '{"hola":2}', sig)).toBe(false)
    expect(await verifyMetaSignature('otro-secreto', '{"hola":1}', sig)).toBe(false)
  })

  it('rechaza cabeceras inválidas', async () => {
    const body = '{"hola":1}'
    expect(await verifyMetaSignature('app-secret', body, null)).toBe(false)
    expect(await verifyMetaSignature('app-secret', body, 'sha1=abcdef')).toBe(false)
    expect(await verifyMetaSignature('app-secret', body, 'sha256=zzzz')).toBe(false)
  })
})

describe('configuración de WhatsApp', () => {
  const saved = {
    token: process.env.WHATSAPP_TOKEN,
    phone: process.env.WHATSAPP_PHONE_NUMBER_ID,
    allowed: process.env.WHATSAPP_ALLOWED_NUMBERS,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries({
      WHATSAPP_TOKEN: saved.token,
      WHATSAPP_PHONE_NUMBER_ID: saved.phone,
      WHATSAPP_ALLOWED_NUMBERS: saved.allowed,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('isWhatsAppConfigured exige token y phone number id', () => {
    delete process.env.WHATSAPP_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    expect(isWhatsAppConfigured()).toBe(false)

    process.env.WHATSAPP_TOKEN = 'EAAB...'
    expect(isWhatsAppConfigured()).toBe(false)

    process.env.WHATSAPP_PHONE_NUMBER_ID = '12345'
    expect(isWhatsAppConfigured()).toBe(true)
  })

  it('allowedNumbers limpia y normaliza la lista', () => {
    process.env.WHATSAPP_ALLOWED_NUMBERS = ' 51 999 888 777 , +51999000111 '
    expect(allowedNumbers()).toEqual(['51999888777', '51999000111'])

    process.env.WHATSAPP_ALLOWED_NUMBERS = ''
    expect(allowedNumbers()).toBeNull()

    delete process.env.WHATSAPP_ALLOWED_NUMBERS
    expect(allowedNumbers()).toBeNull()
  })
})
