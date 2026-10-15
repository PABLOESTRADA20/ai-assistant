import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeToolCall } from '@/app/lib/tools'

/**
 * Herramientas de modificación de datos (FASE 4): `update_memory`,
 * `update_cloud_note` y `revert_change`.
 *
 * Se mockean los tres módulos que tocan datos (memory, notes, changelog) para
 * no depender de red ni de Postgres. Lo que se comprueba aquí es la lógica:
 * id obligatorio, lista blanca de campos, topes, límite anti edición masiva,
 * auditoría antes/después y reversión. La auditoría REAL (el SQL crudo de
 * `changelog.ts`) se valida con `npm run db:smoke-changelog` contra la base.
 */
const memoryMod = vi.hoisted(() => ({
  findMemoryById: vi.fn(),
  updateMemory: vi.fn(),
  // quota.ts importa estas dos desde el mismo módulo; deben existir en el mock.
  getContext: vi.fn(),
  setContext: vi.fn(),
}))
const notesMod = vi.hoisted(() => ({ getNote: vi.fn(), updateNote: vi.fn() }))
const changeMod = vi.hoisted(() => ({
  MAX_CHANGES_PER_MINUTE: 12,
  recordChange: vi.fn(),
  countRecentChanges: vi.fn(),
  getChange: vi.fn(),
  latestChange: vi.fn(),
  markReverted: vi.fn(),
}))

vi.mock('@/app/lib/memory', () => ({
  findMemoryById: memoryMod.findMemoryById,
  updateMemory: memoryMod.updateMemory,
  getContext: memoryMod.getContext,
  setContext: memoryMod.setContext,
}))
vi.mock('@/app/lib/notes', () => ({
  getNote: notesMod.getNote,
  updateNote: notesMod.updateNote,
}))
vi.mock('@/app/lib/changelog', () => ({
  MAX_CHANGES_PER_MINUTE: changeMod.MAX_CHANGES_PER_MINUTE,
  recordChange: changeMod.recordChange,
  countRecentChanges: changeMod.countRecentChanges,
  getChange: changeMod.getChange,
  latestChange: changeMod.latestChange,
  markReverted: changeMod.markReverted,
}))

const MEM_ID = '11111111-1111-4111-8111-111111111111'
const NOTE_ID = '22222222-2222-4222-8222-222222222222'
const CHANGE_ID = '33333333-3333-4333-8333-333333333333'

/** Llama a una herramienta como lo haría el bucle de tool-calling. */
const call = (name: string, args: Record<string, unknown>) =>
  executeToolCall({
    id: 'call-1',
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  } as never)

const memoryRow = (over: Record<string, unknown> = {}) => ({
  id: MEM_ID,
  type: 'fact',
  category: 'perfil',
  content: 'Usa Next.js',
  importance: 0.5,
  confidence: 0.5,
  tags: ['stack'],
  source: 'conversation',
  isCompressed: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
})

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: NOTE_ID,
  title: 'Ideas',
  content: 'contenido',
  tags: ['x'],
  source: 'aria',
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const changeRow = (over: Record<string, unknown> = {}) => ({
  id: CHANGE_ID,
  entity: 'memory',
  entityId: MEM_ID,
  action: 'update',
  before: { content: 'Usa Next.js', importance: 0.5, confidence: 0.5, category: 'perfil', type: 'fact', tags: ['stack'] },
  after: { content: 'Usa Deno' },
  actor: 'aria',
  revertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  changeMod.countRecentChanges.mockResolvedValue(0)
  changeMod.recordChange.mockResolvedValue({ id: CHANGE_ID })
})

describe('update_memory', () => {
  it('rechaza un id que no es uuid y no toca nada', async () => {
    const res = JSON.parse(await call('update_memory', { id: 'nope', content: 'x' }))
    expect(res.error).toMatch(/id de memoria válido/)
    expect(memoryMod.updateMemory).not.toHaveBeenCalled()
  })

  it('exige al menos un campo que cambiar', async () => {
    const res = JSON.parse(await call('update_memory', { id: MEM_ID }))
    expect(res.error).toMatch(/ningún campo/)
  })

  it('acota el contenido a 2000 caracteres', async () => {
    const res = JSON.parse(await call('update_memory', { id: MEM_ID, content: 'x'.repeat(2001) }))
    expect(res.error).toMatch(/2000/)
    expect(memoryMod.updateMemory).not.toHaveBeenCalled()
  })

  it('valida el rango de importance', async () => {
    const res = JSON.parse(await call('update_memory', { id: MEM_ID, importance: 2 }))
    expect(res.error).toMatch(/importance/)
  })

  it('actualiza y audita el valor anterior y el nuevo', async () => {
    memoryMod.findMemoryById.mockResolvedValue(memoryRow())
    memoryMod.updateMemory.mockResolvedValue(memoryRow({ content: 'Usa Deno', importance: 0.9 }))

    const res = JSON.parse(
      await call('update_memory', { id: MEM_ID, content: 'Usa Deno', importance: 0.9 }),
    )

    expect(res.success).toBe(true)
    expect(res.changeId).toBe(CHANGE_ID)
    expect(memoryMod.updateMemory).toHaveBeenCalledWith(MEM_ID, { content: 'Usa Deno', importance: 0.9 })
    expect(changeMod.recordChange).toHaveBeenCalledWith({
      entity: 'memory',
      entityId: MEM_ID,
      before: expect.objectContaining({ content: 'Usa Next.js', importance: 0.5 }),
      after: expect.objectContaining({ content: 'Usa Deno', importance: 0.9 }),
    })
  })

  it('corta ante demasiados cambios seguidos (anti edición masiva)', async () => {
    memoryMod.findMemoryById.mockResolvedValue(memoryRow())
    changeMod.countRecentChanges.mockResolvedValue(12)

    const res = JSON.parse(await call('update_memory', { id: MEM_ID, importance: 0.9 }))

    expect(res.error).toMatch(/Demasiados cambios/)
    expect(memoryMod.updateMemory).not.toHaveBeenCalled()
    expect(changeMod.recordChange).not.toHaveBeenCalled()
  })

  it('informa si la memoria no existe', async () => {
    memoryMod.findMemoryById.mockResolvedValue(null)
    const res = JSON.parse(await call('update_memory', { id: MEM_ID, importance: 0.9 }))
    expect(res.error).toMatch(/No encontré/)
  })

  it('audita igual si el embedding no se pudo recalcular', async () => {
    // 1ª lectura: el valor anterior. 2ª: la relectura tras el fallo.
    memoryMod.findMemoryById
      .mockResolvedValueOnce(memoryRow())
      .mockResolvedValueOnce(memoryRow({ content: 'Usa Deno' }))
    memoryMod.updateMemory.mockRejectedValue(new Error('[embed] reserva de Workers AI agotada'))

    const res = JSON.parse(await call('update_memory', { id: MEM_ID, content: 'Usa Deno' }))

    expect(res.success).toBe(true)
    expect(res.warning).toMatch(/embedding/)
    expect(changeMod.recordChange).toHaveBeenCalledTimes(1)
    expect(changeMod.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ content: 'Usa Deno' }) }),
    )
  })
})

describe('update_cloud_note', () => {
  it('rechaza id inválido y exige campos', async () => {
    expect(JSON.parse(await call('update_cloud_note', { id: 'x', title: 'T' })).error).toMatch(
      /id de nota válido/,
    )
    expect(JSON.parse(await call('update_cloud_note', { id: NOTE_ID })).error).toMatch(/ningún campo/)
  })

  it('actualiza y audita', async () => {
    notesMod.getNote.mockResolvedValue(noteRow())
    notesMod.updateNote.mockResolvedValue(noteRow({ title: 'Ideas v2', pinned: true }))

    const res = JSON.parse(
      await call('update_cloud_note', { id: NOTE_ID, title: 'Ideas v2', pinned: true }),
    )

    expect(res.success).toBe(true)
    expect(res.note.title).toBe('Ideas v2')
    expect(notesMod.updateNote).toHaveBeenCalledWith(NOTE_ID, { title: 'Ideas v2', pinned: true })
    expect(changeMod.recordChange).toHaveBeenCalledWith({
      entity: 'note',
      entityId: NOTE_ID,
      before: expect.objectContaining({ title: 'Ideas', pinned: false }),
      after: expect.objectContaining({ title: 'Ideas v2', pinned: true }),
    })
  })

  it('informa si la nota no existe o no se pudo guardar', async () => {
    notesMod.getNote.mockResolvedValue(null)
    expect(JSON.parse(await call('update_cloud_note', { id: NOTE_ID, title: 'X' })).error).toMatch(
      /No encontré/,
    )

    notesMod.getNote.mockResolvedValue(noteRow())
    notesMod.updateNote.mockResolvedValue(null)
    expect(JSON.parse(await call('update_cloud_note', { id: NOTE_ID, title: 'X' })).error).toMatch(
      /No se pudo actualizar/,
    )
    expect(changeMod.recordChange).not.toHaveBeenCalled()
  })
})

describe('revert_change', () => {
  it('exige changeId o entity + entityId', async () => {
    const res = JSON.parse(await call('revert_change', {}))
    expect(res.error).toMatch(/changeId/)
  })

  it('revierte por changeId reaplicando el valor anterior', async () => {
    changeMod.getChange.mockResolvedValue(changeRow())
    memoryMod.findMemoryById.mockResolvedValue(memoryRow({ content: 'Usa Deno' }))
    memoryMod.updateMemory.mockResolvedValue(memoryRow())
    changeMod.markReverted.mockResolvedValue(true)

    const res = JSON.parse(await call('revert_change', { changeId: CHANGE_ID }))

    expect(res.success).toBe(true)
    expect(memoryMod.updateMemory).toHaveBeenCalledWith(
      MEM_ID,
      expect.objectContaining({ content: 'Usa Next.js', importance: 0.5 }),
    )
    expect(changeMod.markReverted).toHaveBeenCalledWith(CHANGE_ID)
  })

  it('revierte el último cambio de una nota por entity + entityId', async () => {
    changeMod.latestChange.mockResolvedValue(
      changeRow({
        entity: 'note',
        entityId: NOTE_ID,
        before: { title: 'Ideas', content: 'hola', tags: [], pinned: false },
      }),
    )
    notesMod.getNote.mockResolvedValue(noteRow())
    notesMod.updateNote.mockResolvedValue(noteRow())
    changeMod.markReverted.mockResolvedValue(true)

    const res = JSON.parse(await call('revert_change', { entity: 'note', entityId: NOTE_ID }))

    expect(res.success).toBe(true)
    expect(changeMod.latestChange).toHaveBeenCalledWith('note', NOTE_ID)
    expect(notesMod.updateNote).toHaveBeenCalledWith(
      NOTE_ID,
      expect.objectContaining({ title: 'Ideas', content: 'hola' }),
    )
  })

  it('no revierte dos veces el mismo cambio', async () => {
    changeMod.getChange.mockResolvedValue(changeRow({ revertedAt: '2026-01-02T00:00:00.000Z' }))
    const res = JSON.parse(await call('revert_change', { changeId: CHANGE_ID }))
    expect(res.error).toMatch(/ya estaba revertido/)
    expect(memoryMod.updateMemory).not.toHaveBeenCalled()
  })

  it('avisa si el cambio no guarda valor anterior', async () => {
    changeMod.getChange.mockResolvedValue(changeRow({ before: null }))
    const res = JSON.parse(await call('revert_change', { changeId: CHANGE_ID }))
    expect(res.error).toMatch(/valor anterior/)
    expect(changeMod.markReverted).not.toHaveBeenCalled()
  })

  it('avisa si el registro ya no existe', async () => {
    changeMod.getChange.mockResolvedValue(changeRow())
    memoryMod.findMemoryById.mockResolvedValue(null)
    const res = JSON.parse(await call('revert_change', { changeId: CHANGE_ID }))
    expect(res.error).toMatch(/ya no existe/)
    expect(changeMod.markReverted).not.toHaveBeenCalled()
  })
})
