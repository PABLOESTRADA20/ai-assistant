import { describe, expect, it } from 'vitest'
import { DRAFT_PREFIX, draftKey, loadDraft, saveDraft, StorageLike } from '@/app/lib/chat-draft'

function fakeStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
    removeItem: (key) => {
      delete data[key]
    },
  }
}

describe('draftKey', () => {
  it('usa la clave por conversación', () => {
    expect(draftKey('abc-123')).toBe(`${DRAFT_PREFIX}abc-123`)
  })

  it('sin conversación activa usa la clave "welcome"', () => {
    expect(draftKey(null)).toBe(`${DRAFT_PREFIX}welcome`)
  })

  it('nunca colisiona entre conversaciones ni con el caso "sin id"', () => {
    expect(draftKey('a')).not.toBe(draftKey('b'))
    // El separador ':' y la palabra reservada no existen en los UUID, que solo
    // usan hex y guiones: ningún id real puede tocar la clave del inicio.
    expect(draftKey('new')).not.toBe(draftKey(null))
  })
})

describe('loadDraft / saveDraft', () => {
  it('guarda y recupera el borrador de una conversación', () => {
    const storage = fakeStorage()
    saveDraft('conv-1', 'hola ARIA', storage)
    expect(loadDraft('conv-1', storage)).toBe('hola ARIA')
  })

  it('no contamina otras conversaciones', () => {
    const storage = fakeStorage()
    saveDraft('conv-1', 'borrador A', storage)
    expect(loadDraft('conv-2', storage)).toBe('')
    expect(storage.data).not.toHaveProperty(draftKey('conv-2'))
  })

  it('un valor vacío borra la entrada en vez de guardarla', () => {
    const storage = fakeStorage()
    saveDraft('conv-1', 'temporal', storage)
    saveDraft('conv-1', '', storage)
    expect(loadDraft('conv-1', storage)).toBe('')
    expect(storage.data).not.toHaveProperty(draftKey('conv-1'))
  })

  it('sin almacenamiento (SSR/privado bloqueado) no rompe y devuelve vacío', () => {
    expect(loadDraft('conv-1', null)).toBe('')
    expect(() => saveDraft('conv-1', 'x', null)).not.toThrow()
  })

  it('un storage que lanza no rompe load ni save', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadDraft('conv-1', broken)).toBe('')
    expect(() => saveDraft('conv-1', 'x', broken)).not.toThrow()
  })
})