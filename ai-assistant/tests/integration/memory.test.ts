import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/app/lib/prisma'
import {
  consolidateMemories,
  createMemory,
  deleteMemory,
  maybeConsolidate,
  reinforceMemories,
  searchMemories,
  searchSemanticMemories,
  updateMemory,
} from '@/app/lib/memory'

/**
 * Integración de la memoria a largo plazo contra la BD de pruebas.
 *
 * Reglas del harness:
 *  - Sin TEST_DATABASE_URL los tests se OMITEN (tests/setup.ts impide que
 *    DATABASE_URL apunte a producción);
 *  - todo lo que se crea lleva `source`/marcador único y se borra en afterAll;
 *  - los embedding son locales y deterministas (EMBEDDING_PROVIDER=local).
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)
const SOURCE = `vitest-memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const marker = SOURCE.replace(/-/g, '')

describe.skipIf(!RUN)('memoria a largo plazo (integración)', () => {
  afterAll(async () => {
    await prisma.memory.deleteMany({ where: { source: SOURCE } })
    await prisma.sessionContext.deleteMany({ where: { key: 'maintenance:consolidate' } })
    await prisma.sessionContext.deleteMany({ where: { key: { startsWith: 'session:vitest' } } })
  })

  it('createMemory persiste con todos los campos', async () => {
    const mem = await createMemory({
      type: 'long_term',
      category: 'preference',
      content: `${marker} al usuario le gusta el tema oscuro en toda la interfaz`,
      importance: 0.9,
      tags: ['preferencia', 'ui'],
      source: SOURCE,
    })

    expect(mem.id).toBeTruthy()
    expect(mem.importance).toBe(0.9)
    expect(mem.tags).toEqual(['preferencia', 'ui'])
    expect(mem.source).toBe(SOURCE)
    expect(mem.isCompressed).toBe(false)
    expect(mem.createdAt).toBeInstanceOf(Date)

    // Y está realmente en la tabla:
    const row = await prisma.memory.findUnique({ where: { id: mem.id } })
    expect(row).not.toBeNull()
  })

  it('createMemory rechaza contenido vacío', async () => {
    await expect(
      createMemory({ type: 'long_term', category: 'fact', content: '   ', source: SOURCE }),
    ).rejects.toThrow('Contenido vacío')
  })

  it('fusiona duplicados casi idénticos en vez de copiarlos', async () => {
    const content = `${marker} prefiere trabajar con auriculares y silencio total`
    const first = await createMemory({
      type: 'long_term',
      category: 'preference',
      content,
      importance: 0.5,
      source: SOURCE,
    })
    const second = await createMemory({
      type: 'long_term',
      category: 'preference',
      content,
      importance: 0.95,
      source: SOURCE,
    })

    expect(second.id).toBe(first.id)
    expect(second.importance).toBe(0.95) // sube al máximo de ambas

    const copies = await prisma.memory.count({
      where: { source: SOURCE, content: { contains: 'auriculares' } },
    })
    expect(copies).toBe(1)
  })

  it('searchSemanticMemories encuentra lo relevante y descarta lo archivado', async () => {
    const vive = await createMemory({
      type: 'factual',
      category: 'fact',
      content: `${marker} el usuario vive en Lima y trabaja remoto desde casa`,
      importance: 0.8,
      source: SOURCE,
    })
    const color = await createMemory({
      type: 'long_term',
      category: 'preference',
      content: `${marker} al usuario le gusta el color verde en la terminal`,
      importance: 0.3,
      source: SOURCE,
    })
    const archivada = await createMemory({
      type: 'factual',
      category: 'fact',
      content: `${marker} el usuario alguna vez hablo de una reserva olvidada`,
      importance: 0.9,
      source: SOURCE,
    })
    await prisma.memory.update({ where: { id: archivada.id }, data: { isCompressed: true } })

    const hits = await searchSemanticMemories(`${marker} donde vive el usuario`, 5)

    expect(hits[0].id).toBe(vive.id) // gana por similitud + importancia
    expect(hits[0].similarity).toBeGreaterThan(0)
    expect(hits.map((h) => h.id)).toContain(color.id)
    expect(hits.map((h) => h.id)).not.toContain(archivada.id) // olvidada
  })

  it('searchSemanticMemories respeta el límite', async () => {
    const hits = await searchSemanticMemories(`${marker} usuario`, 1)
    expect(hits).toHaveLength(1)
  })

  it('updateMemory edita, re-embebe y revive', async () => {
    const mem = await createMemory({
      type: 'factual',
      category: 'skill',
      content: `${marker} usa Visual Studio Code para todos sus proyectos`,
      importance: 0.5,
      source: SOURCE,
    })
    await prisma.memory.update({ where: { id: mem.id }, data: { isCompressed: true } })

    const edited = await updateMemory(mem.id, {
      content: `${marker} ahora programa exclusivamente en Neovim con tmux`,
      importance: 0.8,
    })

    expect(edited.content).toContain('Neovim')
    expect(edited.importance).toBe(0.8)
    expect(edited.isCompressed).toBe(false) // editar la desarchiva

    // El embedding nuevo encuentra el contenido nuevo:
    const hits = await searchSemanticMemories(`${marker} neovim tmux`, 5)
    expect(hits[0]?.id).toBe(mem.id)
  })

  it('updateMemory rechaza contenido vacío', async () => {
    const mem = await createMemory({
      type: 'fact',
      category: 'fact',
      content: `${marker} temporal para validar ediciones vacias`,
      source: SOURCE,
    })
    await expect(updateMemory(mem.id, { content: '  ' })).rejects.toThrow('Contenido vacío')
  })

  it('searchMemories filtra por categoría, tipo e importancia y oculta archivadas', async () => {
    const all = await searchMemories({ limit: 200, includeCompressed: true })
    const mine = all.filter((m) => m.source === SOURCE)
    expect(mine.length).toBeGreaterThan(2)

    const prefs = await searchMemories({ category: 'preference', limit: 200, includeCompressed: true })
    expect(prefs.filter((m) => m.source === SOURCE).every((m) => m.category === 'preference')).toBe(true)

    const importantes = await searchMemories({ minImportance: 0.7, limit: 200, includeCompressed: true })
    expect(
      importantes.filter((m) => m.source === SOURCE).every((m) => m.importance >= 0.7),
    ).toBe(true)

    // Archivada: visible con includeCompressed, oculta por defecto.
    const oculta = await createMemory({
      type: 'long_term',
      category: 'event',
      content: `${marker} memoria archivada para comprobar el filtro de olvido`,
      source: SOURCE,
    })
    await prisma.memory.update({ where: { id: oculta.id }, data: { isCompressed: true } })

    const conOculta = await searchMemories({ limit: 200, includeCompressed: true })
    expect(conOculta.some((m) => m.id === oculta.id)).toBe(true)

    const sinOculta = await searchMemories({ limit: 200 })
    expect(sinOculta.some((m) => m.id === oculta.id)).toBe(false)
  })

  it('reinforceMemories sube importancia/confianza sin pasarse de 1', async () => {
    const mem = await createMemory({
      type: 'long_term',
      category: 'knowledge',
      content: `${marker} sabe perfectamente como funcionan las cargas utiles de GraphQL`,
      importance: 0.5,
      confidence: 0.5,
      source: SOURCE,
    })

    const n = await reinforceMemories([mem.id, mem.id, 'id-que-no-existe'])
    expect(n).toBe(2) // dedupe de ids

    const row = await prisma.memory.findUnique({ where: { id: mem.id } })
    expect(row!.importance).toBeCloseTo(0.55, 5)
    expect(row!.confidence).toBeCloseTo(0.53, 5)

    for (let i = 0; i < 20; i++) await reinforceMemories([mem.id])
    const capped = await prisma.memory.findUnique({ where: { id: mem.id } })
    expect(capped!.importance).toBe(1)
    expect(capped!.confidence).toBe(1)
  })

  it('consolida: archiva lo viejo, purga lo muy viejo y limpia contextos caducados', async () => {
    const stale = await createMemory({
      type: 'long_term',
      category: 'fact',
      content: `${marker} un dato antiguo poco importante que ya no interesa`,
      importance: 0.2,
      source: SOURCE,
    })
    await prisma.memory.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 60 * 86400000) },
    })

    const ancient = await createMemory({
      type: 'long_term',
      category: 'fact',
      content: `${marker} un dato muy antiguo que toca purgar del todo`,
      importance: 0.1,
      source: SOURCE,
    })
    const oldDate = new Date(Date.now() - 200 * 86400000)
    await prisma.memory.update({
      where: { id: ancient.id },
      data: { isCompressed: true, createdAt: oldDate, updatedAt: oldDate },
    })

    await prisma.sessionContext.create({
      data: {
        key: `session:vitest-expired-${SOURCE}`,
        value: { temporales: true },
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const res = await consolidateMemories({ staleDays: 45, minImportance: 0.35, purgeDays: 120 })
    expect(res.compressed).toBeGreaterThanOrEqual(1)
    expect(res.purged).toBeGreaterThanOrEqual(1)
    expect(res.expiredContexts).toBeGreaterThanOrEqual(1)

    const staleRow = await prisma.memory.findUnique({ where: { id: stale.id } })
    expect(staleRow!.isCompressed).toBe(true) // archivada, no perdida
    expect(await prisma.memory.findUnique({ where: { id: ancient.id } })).toBeNull() // purgada
  })

  it('maybeConsolidate no repite trabajo dentro del intervalo', async () => {
    await prisma.sessionContext.deleteMany({ where: { key: 'maintenance:consolidate' } })

    const first = await maybeConsolidate(24)
    expect(first).not.toBeNull()
    expect(first!.compressed).toBeGreaterThanOrEqual(0)

    const second = await maybeConsolidate(24)
    expect(second).toBeNull() // recién hecho: no toca
  })
  it('deleteMemory borra de verdad', async () => {
    const mem = await createMemory({
      type: 'long_term',
      category: 'event',
      content: `${marker} evento efimero que va a ser borrado enseguida`,
      source: SOURCE,
    })
    await deleteMemory(mem.id)
    expect(await prisma.memory.findUnique({ where: { id: mem.id } })).toBeNull()

    await expect(deleteMemory('id-que-no-existe')).rejects.toThrow()
  })
})
