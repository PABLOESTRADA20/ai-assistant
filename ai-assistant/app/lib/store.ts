// app/lib/store.ts
import { Conversation, Message } from '@/app/types'
import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = 'aria-conversations'

export function getConversations(): Conversation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return parsed.map((c: Conversation) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: c.messages.map((m: Message) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      })),
    }))
  } catch {
    return []
  }
}

export function saveConversations(conversations: Conversation[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
}

export function createConversation(model: string): Conversation {
  return {
    id: uuidv4(),
    title: 'Nueva conversación',
    messages: [],
    model,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function generateTitle(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= 50) return trimmed
  return trimmed.slice(0, 47) + '...'
}
