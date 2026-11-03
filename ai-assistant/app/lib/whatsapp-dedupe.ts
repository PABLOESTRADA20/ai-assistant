import { prisma } from '@/app/lib/prisma'

/** Los IDs de mensaje de Meta se reintentan; se recuerdan durante 7 días. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Reclama un mensaje de WhatsApp de forma atómica.
 *
 * Meta puede reintentar el mismo `messageId` si el webhook tarda o falla. Se
 * inserta una fila con clave única en `SessionContext`: el primer intento gana
 * y los siguientes chocan con la restricción única. Si el choque es por clave
 * duplicada, devuelve false. Cualquier otro error devuelve true: es mejor
 * arriesgar un duplicado que perder un mensaje real.
 */
export async function claimWhatsAppMessage(messageId: string): Promise<boolean> {
  if (!messageId) return true

  try {
    await prisma.sessionContext.create({
      data: {
        key: `whatsapp:msg:${messageId}`,
        value: { messageId, claimedAt: new Date().toISOString() },
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    })
    return true
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
    const message = err instanceof Error ? err.message : String(err)
    if (code === 'P2002' || message.toLowerCase().includes('unique constraint')) return false
    return true
  }
}
