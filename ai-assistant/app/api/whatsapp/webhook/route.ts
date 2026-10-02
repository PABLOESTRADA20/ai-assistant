import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { registerBackground } from '@/app/lib/background'
import { DEFAULT_MODEL } from '@/app/lib/aria-core'
import { generateTextReply } from '@/app/lib/aria-reply'
import {
  allowedNumbers,
  isWhatsAppConfigured,
  markdownToWhatsApp,
  markWhatsAppRead,
  parseIncoming,
  sendWhatsAppText,
  verifyMetaSignature,
  type IncomingWhatsAppMessage,
} from '@/app/lib/whatsapp'

/**
 * Webhook de WhatsApp Cloud API.
 *
 * Meta hace dos cosas contra esta URL:
 *   1. Un GET de verificación cuando configuras el webhook (devuelve el
 *      `hub.challenge` si el `hub.verify_token` coincide).
 *   2. POST con los mensajes entrantes. Aquí se responde 200 de inmediato (Meta
 *      reintenta con fuerza si tardas) y el trabajo real se hace en segundo plano
 *      con `ctx.waitUntil()`.
 *
 * IMPORTANTE: esta ruta NO exige `ARIA_ACCESS_TOKEN` — Meta no puede mandarlo.
 * La autenticidad se garantiza con la firma `X-Hub-Signature-256` (app secret).
 */

export const dynamic = 'force-dynamic'

/** Herramientas disponibles en WhatsApp: sin `open_app` (no hay agente local). */
const WHATSAPP_TOOLS = [
  'web_search',
  'calculate',
  'get_time',
  'get_weather',
  'recall_memory',
  'send_email',
]

const HISTORY_LIMIT = 20

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.WHATSAPP_VERIFY_TOKEN

  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge ?? 'OK', { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  // Valida la firma si hay app secret configurado.
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (appSecret) {
    const valid = await verifyMetaSignature(appSecret, raw, req.headers.get('x-hub-signature-256'))
    if (!valid) {
      console.warn('WhatsApp: firma inválida, petición descartada')
      return new Response('Invalid signature', { status: 401 })
    }
  } else if (isWhatsAppConfigured() && !allowedNumbers()) {
    // Sin app secret Y sin lista blanca, cualquiera podría enviar mensajes
    // falsos al webhook y gastar la cuota de Groq. Se rechaza el procesamiento.
    console.error(
      'WhatsApp: falta WHATSAPP_APP_SECRET y no hay WHATSAPP_ALLOWED_NUMBERS. ' +
        'Define el app secret (recomendado) o una lista blanca para aceptar mensajes.',
    )
    return new Response('OK', { status: 200 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const messages = parseIncoming(payload)
  if (messages.length > 0) {
    await registerBackground(handleMessages(messages))
  }

  // Meta exige un 200 rápido; el procesamiento va en background.
  return new Response('OK', { status: 200 })
}

async function handleMessages(messages: IncomingWhatsAppMessage[]): Promise<void> {
  if (!isWhatsAppConfigured()) {
    console.warn('WhatsApp: mensaje recibido pero la integración no está configurada')
    return
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.error('WhatsApp: falta GROQ_API_KEY')
    return
  }

  const allowlist = allowedNumbers()

  for (const msg of messages) {
    try {
      const digits = msg.from.replace(/[^\d]/g, '')
      if (allowlist && !allowlist.includes(digits)) {
        console.warn(`WhatsApp: número no autorizado ${digits}`)
        continue
      }

      await markWhatsAppRead(msg.messageId)

      const conv = await getOrCreateWhatsAppConversation(digits, msg.name)

      // Persiste el mensaje entrante para que aparezca en la app y dé contexto.
      await prisma.message.create({
        data: { conversationId: conv.id, role: 'user', content: msg.text },
      })

      // Historial reciente (incluye el mensaje recién guardado).
      const rows = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: 'asc' },
        take: HISTORY_LIMIT,
      })
      const history = rows.map((r) => ({ role: r.role, content: r.content }))

      const reply = await generateTextReply({
        apiKey,
        messages: history,
        model: DEFAULT_MODEL,
        conversationId: conv.id,
        allowedTools: WHATSAPP_TOOLS,
        forceSearch: wantsToSearch(msg.text),
      })

      const text = reply.text || 'No pude generar una respuesta. Inténtalo de nuevo.'
      if (reply.error && !reply.text) {
        console.error('WhatsApp: error generando respuesta:', reply.error)
      }

      await prisma.message.create({
        data: { conversationId: conv.id, role: 'assistant', content: text, model: DEFAULT_MODEL },
      })
      // Toca la conversación para que suba en la lista lateral.
      await prisma.conversation
        .update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
        .catch(() => {})

      const sent = await sendWhatsAppText(msg.from, markdownToWhatsApp(text))
      if (!sent.ok) console.error('WhatsApp: fallo al enviar:', sent.error)
    } catch (err) {
      console.error(`WhatsApp: error procesando mensaje de ${msg.from}:`, err)
    }
  }
}

const SEARCH_INTENT =
  /\b(busca|buscar|buscame|investiga|googlea|search|look ?up|noticias|news|actualidad|ultima version|última versión)\b/i

function wantsToSearch(text: string): boolean {
  return SEARCH_INTENT.test(text)
}

/**
 * Cada número tiene su propia conversación en la app. El mapeo se guarda en
 * `SessionContext` (mismo almacén que la memoria de trabajo) con TTL largo para
 * que sobreviva a reinicios y no se cree una conversación nueva por mensaje.
 */
async function getOrCreateWhatsAppConversation(phone: string, name?: string) {
  const { getContext, setContext } = await import('@/app/lib/memory')
  const key = `whatsapp:conv:${phone}`

  const existing = await getContext<{ conversationId?: string }>(key).catch(() => null)
  if (existing?.conversationId) {
    const conv = await prisma.conversation
      .findUnique({ where: { id: existing.conversationId } })
      .catch(() => null)
    if (conv) return conv
  }

  const title = name ? `WhatsApp ${name}` : `WhatsApp +${phone}`
  const conv = await prisma.conversation.create({
    data: { title, model: DEFAULT_MODEL },
  })

  // ~10 años de TTL: es un mapeo permanente, no memoria de trabajo.
  await setContext(key, { conversationId: conv.id }, 60 * 24 * 365 * 10).catch(() => {})
  return conv
}
