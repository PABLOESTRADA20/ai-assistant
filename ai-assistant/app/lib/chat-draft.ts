// app/lib/chat-draft.ts
// Borrador del input por conversación, guardado en localStorage del navegador:
// recargar o cambiar de conversación no se lleva lo que estabas escribiendo.

export const DRAFT_PREFIX = 'aria_draft:'

/** Clave de localStorage para el borrador de una conversación (sin id = "welcome"). */
export function draftKey(conversationId: string | null): string {
  return `${DRAFT_PREFIX}${conversationId ?? 'welcome'}`
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // Almacenamiento bloqueado (modo privado estrecho): el borrador es solo sesión.
    return null
  }
}

/** Lee el borrador guardado para la conversación ('' si no hay; `storage` inyectable para tests). */
export function loadDraft(conversationId: string | null, storage: StorageLike | null = defaultStorage()): string {
  if (!storage) return ''
  try {
    return storage.getItem(draftKey(conversationId)) ?? ''
  } catch {
    return ''
  }
}

/** Guarda (o borra, con '') el borrador de la conversación. */
export function saveDraft(
  conversationId: string | null,
  value: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    const key = draftKey(conversationId)
    if (value) storage.setItem(key, value)
    else storage.removeItem(key)
  } catch {
    // Mejor callar: la persistencia es un bonus, nunca debe romper el chat.
  }
}