// app/lib/persist-messages.ts
import { prisma } from '@/app/lib/prisma'
import { Prisma } from '../generated/prisma/wasm.js'

/**
 * Un mensaje tal como llega por el PUT de conversaciones. `sources` y
 * `context` son opcionales: los mensajes sin extras no generan escrituras.
 */
export interface MessageInput {
  id: string
  role: string
  content: string
  model?: string | null
  createdAt?: string | Date
  tools?: unknown
  sources?: unknown
  context?: unknown
}

/**
 * Reemplaza los mensajes de una conversación (borra y recrea), igual que hacía
 * el PUT, pero persistiendo también `tools` (columna conocida por el cliente
 * Prisma) y `sources`/`context` (columnas que el cliente WASM commiteado NO
 * conoce: se escriben por SQL crudo, mismo patrón que `summarizedCount`).
 */
export async function persistMessages(conversationId: string, messages: MessageInput[]): Promise<void> {
  await prisma.message.deleteMany({ where: { conversationId } })
  for (const msg of messages) {
    await prisma.message.create({
      data: {
        id: msg.id,
        conversationId,
        role: msg.role,
        content: msg.content,
        model: msg.model || null,
        ...(msg.tools !== undefined ? { tools: msg.tools as Prisma.InputJsonValue } : {}),
        createdAt: new Date(msg.createdAt ?? Date.now()),
      },
    })
    if (msg.sources !== undefined || msg.context !== undefined) {
      await prisma.$executeRaw`
        UPDATE "Message" SET
          "sources" = ${msg.sources !== undefined ? JSON.stringify(msg.sources) : null}::jsonb,
          "context" = ${msg.context !== undefined ? JSON.stringify(msg.context) : null}::jsonb
        WHERE "id" = ${msg.id}`
    }
  }
}

/**
 * Devuelve los mensajes con `sources`/`context` hidratados desde la BD.
 *
 * `prisma.conversation.findMany/findUnique` no selecciona esas columnas porque
 * el cliente WASM commiteado no las conoce; por eso se buscan por SQL crudo y
 * se mergean. Los mensajes sin extras se devuelven tal cual.
 */
export async function hydrateMessages<T extends { id: string }>(messages: T[]): Promise<T[]> {
  if (messages.length === 0) return messages
  const rows = await prisma.$queryRaw<{ id: string; sources: unknown; context: unknown }[]>`
    SELECT "id", "sources", "context"
    FROM "Message"
    WHERE "id" IN (${Prisma.join(messages.map((m) => m.id))})`
  const extras = new Map(rows.map((r) => [r.id, r]))
  return messages.map((m) => {
    const e = extras.get(m.id)
    if (!e) return m
    const patch: Record<string, unknown> = {}
    if (e.sources != null) patch.sources = e.sources
    if (e.context != null) patch.context = e.context
    return Object.keys(patch).length > 0 ? { ...m, ...patch } : m
  })
}