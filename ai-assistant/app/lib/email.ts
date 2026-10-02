/**
 * Envío de correo de ARIA vía Resend (free tier: 3.000 correos/mes, 100/día).
 *
 * Por qué Resend y no Cloudflare Email Routing: el enrutado de Cloudflare solo
 * RECIBE correo entrante en un dominio propio; para ENVIAR desde el Worker
 * Cloudflare Email Service exige un dominio verificado y una cuenta de pago en
 * algunos casos. Resend tiene free tier real y su remitente de pruebas
 * (`onboarding@resend.dev`) permite mandar al correo del dueño de la cuenta sin
 * configurar DNS, que es justo lo que hace falta mientras no haya dominio.
 *
 * Configuración (secrets, todas opcionales para no romper el despliegue):
 *   - RESEND_API_KEY   clave de https://resend.com/api-keys
 *   - EMAIL_FROM       remitente. Por defecto `ARIA <onboarding@resend.dev>`.
 *                      Con dominio verificado: `ARIA <aria@tudominio.com>`.
 *   - EMAIL_ALLOWED_TO lista separada por comas de destinatarios permitidos.
 *                      Si está definida, ARIA solo puede escribir a esos correos
 *                      (barrera contra spam si la clave de acceso se filtra).
 *
 * Sin RESEND_API_KEY la herramienta devuelve un error claro en vez de fallar en
 * silencio, para que el modelo se lo diga al usuario.
 */

const RESEND_API = 'https://api.resend.com/emails'

export interface SendEmailInput {
  to: string
  subject: string
  text: string
}

export interface SendEmailResult {
  ok: boolean
  message: string
  id?: string
}

function normalizeRecipients(to: string): string[] {
  return to
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export function emailAllowedRecipients(): string[] | null {
  const raw = process.env.EMAIL_ALLOWED_TO?.trim()
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      message:
        'El correo no está configurado: falta RESEND_API_KEY. Añádela como secret en Cloudflare para que ARIA pueda enviar.',
    }
  }

  const recipients = normalizeRecipients(to)
  if (recipients.length === 0) {
    return { ok: false, message: 'Falta el destinatario.' }
  }

  const allowlist = emailAllowedRecipients()
  if (allowlist) {
    const forbidden = recipients.filter((r) => !allowlist.includes(r.toLowerCase()))
    if (forbidden.length > 0) {
      return {
        ok: false,
        message: `Destinatario no permitido: ${forbidden.join(', ')}. La lista blanca (EMAIL_ALLOWED_TO) solo autoriza: ${allowlist.join(', ')}.`,
      }
    }
  }

  const from = process.env.EMAIL_FROM?.trim() || 'ARIA <onboarding@resend.dev>'

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: subject || '(sin asunto)',
        text,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data?.message || data?.error || `HTTP ${res.status}`
      return { ok: false, message: `Resend rechazó el envío: ${detail}` }
    }

    return { ok: true, message: `Correo enviado a ${recipients.join(', ')}.`, id: data?.id }
  } catch (err) {
    return { ok: false, message: `Error de red al enviar el correo: ${String(err)}` }
  }
}
