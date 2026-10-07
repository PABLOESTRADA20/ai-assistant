import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/app/lib/prisma'
import {
  deleteContext,
  getContext,
  getWorkingMemory,
  recordEpisode,
  searchMemories,
  setContext,
  updateWorkingMemory,
} from '@/app/lib/memory'

/**
 * Integración de la memoria de trabajo (por conversación) y de los contextos
 * con TTL. Ver tests/integration/memory.test.ts para las reglas del harness.
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)
const marker = `vitestwm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!RUN)('memoria de trabajo y contextos (integración)', () => {
  afterAll(async () => {
    await prisma.sessionContext.deleteMany({ where: { key: { startsWith: 'session:vitest' } } })
    await prisma.sessionContext.deleteMany({ where: { key: 'maintenance:consolidate' } })
    await prisma.memory.deleteMany({ where: { content: { contains: marker } } })
  })

  it('acumula topics, el más reciente primero, sin repetir', async () => {
    const conv = `${marker}-a`

    await updateWorkingMemory(conv, 'quiero aprender Rust')
    await updateWorkingMemory(conv, 'ahora optimizar Postgres')
    await updateWorkingMemory(conv, 'quiero aprender Rust') // repetido: sube, no duplica

    const wm = await getWorkingMemory(conv)
    expect(wm).not.toBeNull()
    expect(wm!.topics).toEqual(['quiero aprender Rust', 'ahora optimizar Postgres'])
    expect(wm!.goal).toBe('quiero aprender Rust')
    expect(wm!.updatedAt).toBeTruthy()
  })

  it('aisla conversaciones: una no contamina a la otra', async () => {
    const convA = `${marker}-iso-a`
    const convB = `${marker}-iso-b`

    await updateWorkingMemory(convA, 'tema exclusivo de la conversacion A')
    await updateWorkingMemory(convB, 'otro tema exclusivo de la B')

    const a = await getWorkingMemory(convA)
    const b = await getWorkingMemory(convB)
    expect(a!.topics[0]).toContain('conversacion A')
    expect(b!.topics[0]).toContain('la B')
    expect(a!.topics.join(' ')).not.toContain('conversacion B')

    expect(await getWorkingMemory(`${marker}-inexistente`)).toBeNull()
  })

  it('limita el hilo a 8 topics y trunca cada uno a 90 caracteres', async () => {
    const conv = `${marker}-limit`

    for (let i = 1; i <= 10; i++) {
      await updateWorkingMemory(conv, `topic numero ${i}`)
    }
    const wm = await getWorkingMemory(conv)
    expect(wm!.topics).toHaveLength(8)
    expect(wm!.topics[0]).toBe('topic numero 10') // lo más reciente manda

    await updateWorkingMemory(conv, 'x'.repeat(200))
    const long = await getWorkingMemory(conv)
    expect(long!.topics[0]).toHaveLength(90)
  })

  it('ignora mensajes en blanco', async () => {
    const conv = `${marker}-blanco`
    await updateWorkingMemory(conv, '   ')
    expect(await getWorkingMemory(conv)).toBeNull()
  })

  it('los contextos caducan y se pueden borrar', async () => {
    const key = `session:vitest-ttl-${marker}`

    await setContext(key, { numero: 42 }, 30)
    await setContext(key, { numero: 43 }, 30) // upsert: actualiza, no duplica
    expect(await getContext<{ numero: number }>(key)).toEqual({ numero: 43 })

    // Caducado (expiresAt en el pasado): no lo devuelve aunque la fila exista.
    await prisma.sessionContext.updateMany({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await getContext(key)).toBeNull()

    await deleteContext(key)
    expect(await prisma.sessionContext.findFirst({ where: { key } })).toBeNull()
  })

  it('recordEpisode crea un recuerdo episódico recuperable', async () => {
    const ep = await recordEpisode(`${marker} el usuario termino la fase 1 del proyecto`, 0.7, [
      'hitos',
    ])

    expect(ep.type).toBe('episodic')
    expect(ep.category).toBe('event')
    expect(ep.importance).toBe(0.7)
    expect(ep.source).toBe('conversation')

    const found = await searchMemories({ type: 'episodic', limit: 50, includeCompressed: true })
    expect(found.some((m) => m.id === ep.id)).toBe(true)
  })
})
