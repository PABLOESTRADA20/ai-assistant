import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/prisma', () => ({
  prisma: { $queryRaw: queryRaw },
}))

import { hydrateMessages } from '@/app/lib/persist-messages'

beforeEach(() => {
  queryRaw.mockReset()
})

describe('hydrateMessages', () => {
  it('hidrata sources/context cuando la fila los tiene', async () => {
    const sources = [{ kind: 'memory', id: 'm1' }]
    const context = { budget: 4000 }
    queryRaw.mockResolvedValue([{ id: 'a1', sources, context }])

    const result = await hydrateMessages([{ id: 'a1', role: 'assistant' }])

    expect(result[0]).toMatchObject({ sources, context })
  })

  it('elimina los null que Prisma 7 añade a mensajes sin extras', async () => {
    queryRaw.mockResolvedValue([{ id: 'a1', sources: null, context: null }])

    const result = await hydrateMessages([
      { id: 'a1', role: 'user', sources: null, context: null },
    ])

    expect(result[0]).toEqual({ id: 'a1', role: 'user' })
    expect('sources' in result[0]).toBe(false)
    expect('context' in result[0]).toBe(false)
  })
})
