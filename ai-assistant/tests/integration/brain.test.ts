import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/app/lib/prisma'
import { embed } from '@/app/lib/llm-embed'
import { mirrorNoteToMemory, removeMirroredNote, searchBrain } from '@/app/lib/brain'

/**
 * Integración del cerebro unificado contra la BD de pruebas.
 *
 * Reglas del harness:
 *  - Sin TEST_DATABASE_URL los tests se OMITEN (tests/setup.ts impide que
 *    DATABASE_URL apunte a producción);
 *  - todo lo creado lleva marcador único y se borra en afterAll;
 *  - embeddings locales y deterministas (EMBEDDING_PROVIDER=local).
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)
const SOURCE = `vitest-brain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const marker = SOURCE.replace(/-/g, '')

describe.skipIf(!RUN)('cerebro: búsqueda unificada (integración)', () => {
  let convA = ''
  let convB = ''

  afterAll(async () => {
    await prisma.memory.deleteMany({ where: { source: SOURCE } })
    await prisma.$executeRaw`DELETE FROM "Note" WHERE "title" LIKE ${`Plan ${marker}%`}`
    await prisma.$executeRaw`DELETE FROM "VaultNote" WHERE "path" LIKE ${`vitest-brain-${marker}/%`}`
    if (convA || convB) {
      await prisma.conversation.deleteMany({ where: { id: { in: [convA, convB] } } })
    }
  })

  it('busca en memoria, vault, notas y mensajes de la misma conversación', async () => {
    // Memoria a largo plazo con el marcador (createMemory le calcula el
    // embedding y evita duplicados).
    const { createMemory } = await import('@/app/lib/memory')
    await createMemory({
      type: 'long_term',
      category: 'knowledge',
      content: `${marker} usa rust para el backend de la cola`,
      importance: 0.8,
      source: SOURCE,
    })

    // Nota del vault de Obsidian (embedding local).
    const vaultVec = await embed(`passage: ${marker} con cifrado de extremo a extremo`)
    const vaultPath = `vitest-brain-${marker}/seguridad.md`
    await prisma.$executeRaw`
      INSERT INTO "VaultNote" ("path", "name", "title", "content", "embedding", "updatedAt")
      VALUES (${vaultPath}, 'seguridad.md', 'Seguridad detrás', ${marker + ' con cifrado de extremo a extremo'}, ${vaultVec}::vector, NOW())
    `

    // Nota de la carpeta de ARIA (léxica). El cliente generado no conoce el
    // modelo Note, así que se inserta con SQL directo (igual que app/lib/notes.ts).
    await prisma.$executeRaw`
      INSERT INTO "Note" ("id", "title", "content", "tags", "source", "updatedAt")
      VALUES (${randomUUID()}, ${`Plan ${marker}`}, 'cambiar la pila a postgresql 17 y armar el índice hnsw', ${JSON.stringify(['brain'])}::jsonb, 'web', NOW())
    `

    // Mensajes: uno en la conversación A y otro en la B (no debe filtrarse).
    const [ca, cb] = await Promise.all([
      prisma.conversation.create({ data: { title: `brain-a-${marker}` } }),
      prisma.conversation.create({ data: { title: `brain-b-${marker}` } }),
    ])
    convA = ca.id
    convB = cb.id
    await prisma.message.create({
      data: { conversationId: ca.id, role: 'user', content: `${marker} es clave para el deploy del viernes` },
    })
    await prisma.message.create({
      data: { conversationId: cb.id, role: 'user', content: `${marker} de otro hilo que no debería filtrarse` },
    })

    const hits = await searchBrain(marker, { conversationId: ca.id, minScore: 0 })

    const kinds = new Set(hits.map((h) => h.kind))
    expect(kinds.has('memory')).toBe(true)
    expect(kinds.has('vault')).toBe(true)
    expect(kinds.has('note')).toBe(true)
    expect(kinds.has('message')).toBe(true)

    const messages = hits.filter((h) => h.kind === 'message')
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((m) => m.conversationId === ca.id)).toBe(true)
    expect(messages.some((m) => m.conversationId === cb.id)).toBe(false)

    const note = hits.find((h) => h.kind === 'note')
    expect(note?.title).toContain(marker)
  })

  it('encuentra una entrada del vault SIN embedding por su keyword (vía léxica)', async () => {
    // Simula el caso real del hallazgo: sin vector (entrada vieja o cuota de
    // embeddings), el vault quedaba invisible aunque tuviera la palabra exacta.
    await prisma.$executeRaw`
      INSERT INTO "VaultNote" ("path", "name", "title", "content", "embedding", "updatedAt")
      VALUES (${`vitest-brain-${marker}/respaldo.md`}, 'respaldo.md', NULL,
              ${marker + ' reglas de respaldo nocturno y rotación de copias'},
              NULL::vector, NOW())
    `

    const hits = await searchBrain(marker, { minScore: 0.3 })
    const vaultLex = hits.find((h) => h.kind === 'vault' && h.content.includes('respaldo nocturno'))
    expect(vaultLex).toBeTruthy()
  })

  it('sin conversationId no incluye mensajes', async () => {
    const hits = await searchBrain(marker, { minScore: 0 })
    expect(hits.some((h) => h.kind === 'message')).toBe(false)
  })

  it('respeta limit y minScore', async () => {
    const few = await searchBrain(marker, { limit: 2, minScore: 0 })
    expect(few.length).toBeLessThanOrEqual(2)

    // El umbral mide relevancia pura; el empujón de importancia/recencia solo
    // ordena lo que ya lo pasó, así que 0.99 sigue excluyendo todo.
    const none = await searchBrain(marker, { minScore: 0.99 })
    expect(none.length).toBe(0)
  })

  it('espejo de notas: indexa como memoria y se puede retirar', async () => {
    const noteId = randomUUID()
    const noteTitle = `Mirror ${marker}`
    await mirrorNoteToMemory({
      id: noteId,
      title: noteTitle,
      content: `${marker} el café se toma sin azúcar`,
      tags: ['brain', 'café'],
    })

    const mirrored = await prisma.$queryRaw<{ id: string; tags: unknown; source: string }[]>`
      SELECT "id", "tags", "source" FROM "Memory"
      WHERE "tags" @> ${JSON.stringify([`note:${noteId}`])}::jsonb
    `
    expect(mirrored.length).toBe(1)
    expect(mirrored[0].source).toBe('note')

    // La búsqueda unificada la encuentra como memoria.
    const hits = await searchBrain(marker, { minScore: 0 })
    const found = hits.find(
      (h) => h.kind === 'memory' && h.content.includes('café se toma sin azúcar'),
    )
    expect(found).toBeTruthy()

    // Retirar el espejo borra la memoria, no la nota.
    const removed = await removeMirroredNote(noteId)
    expect(removed).toBe(true)
    const gone = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Memory" WHERE "tags" @> ${JSON.stringify([`note:${noteId}`])}::jsonb
    `
    expect(gone.length).toBe(0)
  })

  it('consulta vacía devuelve lista vacía', async () => {
    expect(await searchBrain('   ')).toEqual([])
  })
})