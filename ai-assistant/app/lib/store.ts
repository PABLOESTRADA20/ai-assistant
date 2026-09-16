import { Conversation, Message } from '@/app/types'

export async function getConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations')
  if (!res.ok) return []
  const data = await res.json()
  return data.map((c: Conversation) => ({
    ...c,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
    messages: c.messages.map((m: Message) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    })),
  }))
}

export async function saveConversations(_conversations: Conversation[]) {
  // Not needed — API handles persistence
}

export async function createConversation(model: string): Promise<Conversation> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
  if (!res.ok) throw new Error('Error al crear conversación')
  const data = await res.json()
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
    messages: (data.messages || []).map((m: Message) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    })),
  }
}

export async function updateConversation(id: string, data: Partial<{ title: string; messages: Message[] }>): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Error al actualizar conversación')
  const updated = await res.json()
  return {
    ...updated,
    createdAt: new Date(updated.createdAt),
    updatedAt: new Date(updated.updatedAt),
    messages: (updated.messages || []).map((m: Message) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    })),
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Error al eliminar conversación')
}

export function generateTitle(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= 50) return trimmed
  return trimmed.slice(0, 47) + '...'
}
