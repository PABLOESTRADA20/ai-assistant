/**
 * Integración con WhatsApp Cloud API (Meta) — API oficial y gratuita.
 *
 * Por qué la API oficial y no una librería no oficial (Baileys, whatsapp-web.js):
 * esas librerías necesitan un proceso Node 24/7 con una sesión de navegador y
 * violan los términos de WhatsApp (te pueden banear el número). Un Worker de
 * Cloudflare es efímero y no puede mantener esa sesión. La Cloud API, en cambio,
 * es un webhook: Meta nos envía el mensaje, ARIA responde por Graph API.
 *
 * Secrets necesarios (definidos en Cloudflare, ver README):
 *   WHATSAPP_TOKEN            token permanente de la app de Meta
 *   WHATSAPP_PHONE_NUMBER_ID  id del número de WhatsApp Business
 *   WHATSAPP_VERIFY_TOKEN     cadena inventada por ti para verificar el webhook
 *   WHATSAPP_APP_SECRET       app secret, para validar la firma X-Hub-Signature-256
 *   WHATSAPP_ALLOWED_NUMBERS  (opcional) lista blanca de números separada por comas
 *
 * Sin los tres primeros, `isWhatsAppConfigured()` devuelve false y el webhook
 * responde 200 sin hacer nada (para que Meta no reintente en bucle).
 */

const GRAPH_VERSION = 'v21.0'

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

export function allowedNumbers(): string[] | null {
  const raw = process.env.WHATSAPP_ALLOWED_NUMBERS?.trim()
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.replace(/[^\d]/g, ''))
    .filter(Boolean)
}

export interface IncomingWhatsAppMessage {
  from: string
  name?: string
  text: string
  messageId: string
  timestamp?: string
}

/** Extrae los mensajes de texto del payload de webhook de Meta. */
export function parseIncoming(payload: unknown): IncomingWhatsAppMessage[] {
  const out: IncomingWhatsAppMessage[] = []
  const root = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ profile?: { name?: string } }>
          messages?: Array<{
            from?: string
            id?: string
            timestamp?: string
            type?: string
            text?: { body?: string }
            button?: { text?: string }
            interactive?: {
              button_reply?: { title?: string }
              list_reply?: { title?: string }
            }
          }>
        }
      }>
    }>
  }

  for (const entry of root?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value
      const name = value?.contacts?.[0]?.profile?.name
      for (const msg of value?.messages ?? []) {
        let text = ''
        if (msg.type === 'text') text = msg.text?.body ?? ''
        else if (msg.type === 'button') text = msg.button?.text ?? ''
        else if (msg.type === 'interactive') {
          text = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? ''
        }
        if (!text.trim() || !msg.from || !msg.id) continue
        out.push({ from: msg.from, name, text, messageId: msg.id, timestamp: msg.timestamp })
      }
    }
  }

  return out
}

/* ------------------------------ verificación ----------------------------- */

/** Comparación en tiempo constante (evita filtrar la firma byte a byte). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Valida `X-Hub-Signature-256` con el app secret de Meta. Sin esto, cualquiera
 * que conozca la URL del webhook podría inyectar mensajes falsos.
 */
export async function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = signatureHeader.slice('sha256='.length).toLowerCase()

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return safeEqualHex(hex, expected)
}

/* --------------------------------- envío --------------------------------- */

function chunkText(text: string, size = 4000): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > size) {
    // Corta en un salto de línea cercano para no partir palabras a la mitad.
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size)
    if (cut < size * 0.5) cut = size
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}

interface GraphResult {
  ok: boolean
  error?: string
}

export async function sendWhatsAppText(to: string, text: string): Promise<GraphResult> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return { ok: false, error: 'WhatsApp no configurado' }

  for (const chunk of chunkText(text)) {
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: chunk, preview_url: false },
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        return { ok: false, error: `Graph ${res.status}: ${detail.slice(0, 300)}` }
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
  return { ok: true }
}

export async function markWhatsAppRead(messageId: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return
  await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {})
}

/**
 * WhatsApp no entiende Markdown. Traduce lo esencial para que no se vean los
 * asteriscos dobles: `**negrita**` -> `*negrita*`, encabezados `#` -> negrita,
 * y deja el resto (listas, código) tal cual.
 */
export function markdownToWhatsApp(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')
    .replace(/^---+$/gm, '────────')
}
