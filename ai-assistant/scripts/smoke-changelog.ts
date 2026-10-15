import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * Smoke de la auditoría de cambios (FASE 4) contra la BD real.
 *
 *   npm run db:smoke-changelog
 *
 * Comprueba, de punta a punta y con las herramientas REALES, lo que los tests
 * unitarios no pueden: que el SQL crudo de `app/lib/changelog.ts` funciona
 * contra Postgres.
 *
 *   1. Crea una memoria de prueba (a mano, sin depender de la extracción).
 *   2. La modifica con `update_memory`.
 *   3. Verifica que la fila de `ChangeLog` guarda el valor anterior y el nuevo.
 *   4. Comprueba que la memoria quedó actualizada.
 *   5. La revierte con `revert_change` y comprueba que vuelve al valor anterior.
 *   6. Comprueba que NO se puede revertir dos veces.
 *
 * Al terminar borra SIEMPRE lo que creó (memoria + filas de auditoría). Usa
 * embeddings locales para no gastar cuota de Workers AI.
 */

// Embeddings locales: cero red, cero cuota. La memoria de prueba se borra al
// final, así que el vector local (mismo espacio que el real solo en dimensión)
// no contamina nada.
process.env.EMBEDDING_PROVIDER ??= 'local'

async function main(): Promise<void> {
  const { prisma } = await import('../app/lib/prisma')
  const { executeToolCall } = await import('../app/lib/tools')

  const call = (name: string, args: Record<string, unknown>) =>
    executeToolCall({
      id: 'smoke',
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    } as never)

  const tag = `smoke-${Date.now()}`
  const original = `valor original ${tag}`
  const nuevo = `valor nuevo ${tag}`
  const memId = crypto.randomUUID()

  try {
    console.log('1) Creando memoria de prueba...')
    await prisma.$executeRaw`
      INSERT INTO "Memory"
        ("id","type","category","content","importance","confidence","tags","source","createdAt","updatedAt")
      VALUES
        (${memId}, 'fact', 'smoke', ${original}, 0.5, 0.5, '[]'::jsonb, 'smoke', NOW(), NOW())
    `
    console.log(`   id=${memId}`)

    console.log('2) update_memory...')
    const upd = JSON.parse(
      await call('update_memory', { id: memId, content: nuevo, importance: 0.9 }),
    ) as { success?: boolean; changeId?: string; error?: string }
    if (!upd.success || !upd.changeId) {
      throw new Error(`update_memory falló: ${JSON.stringify(upd)}`)
    }
    console.log(`   ok · changeId=${upd.changeId}`)

    console.log('3) Fila de auditoría (antes/después)...')
    const cambios = await prisma.$queryRaw<
      { entity: string; before: unknown; after: unknown; revertedAt: Date | null }[]
    >`SELECT "entity","before","after","revertedAt" FROM "ChangeLog" WHERE "id" = ${upd.changeId}`
    if (!cambios[0]) throw new Error('No se creó la fila de auditoría')
    const before = cambios[0].before as { content: string; importance: number }
    const after = cambios[0].after as { content: string; importance: number }
    if (cambios[0].entity !== 'memory') throw new Error(`entity inesperado: ${cambios[0].entity}`)
    if (!before.content.startsWith('valor original')) {
      throw new Error(`before no guarda el valor anterior: ${before.content}`)
    }
    if (!after.content.startsWith('valor nuevo')) {
      throw new Error(`after no guarda el valor nuevo: ${after.content}`)
    }
    console.log(`   entity=${cambios[0].entity} · before.importance=${before.importance} after.importance=${after.importance}`)

    console.log('4) La memoria refleja el cambio...')
    const [actual] = await prisma.$queryRaw<{ content: string; importance: number }[]>`
      SELECT "content","importance" FROM "Memory" WHERE "id" = ${memId}
    `
    if (!actual?.content.startsWith('valor nuevo') || actual.importance !== 0.9) {
      throw new Error(`La memoria no quedó actualizada: ${JSON.stringify(actual)}`)
    }
    console.log(`   content="${actual.content}" importance=${actual.importance}`)

    console.log('5) revert_change...')
    const rev = JSON.parse(await call('revert_change', { changeId: upd.changeId })) as {
      success?: boolean
      error?: string
    }
    if (!rev.success) throw new Error(`revert_change falló: ${JSON.stringify(rev)}`)
    const [vuelta] = await prisma.$queryRaw<{ content: string; importance: number }[]>`
      SELECT "content","importance" FROM "Memory" WHERE "id" = ${memId}
    `
    if (!vuelta?.content.startsWith('valor original') || vuelta.importance !== 0.5) {
      throw new Error(`La reversión no restauró el valor anterior: ${JSON.stringify(vuelta)}`)
    }
    console.log(`   restaurado: content="${vuelta.content}" importance=${vuelta.importance}`)

    console.log('6) Doble reversión debe bloquearse...')
    const otra = JSON.parse(await call('revert_change', { changeId: upd.changeId })) as {
      error?: string
    }
    if (!otra.error) throw new Error('Se pudo revertir el mismo cambio dos veces')
    console.log(`   bloqueada: ${otra.error}`)

    console.log('\n✅ SMOKE DE AUDITORÍA (FASE 4) PASÓ')
  } finally {
    // Limpieza total: ni la memoria ni la auditoría de prueba deben quedar.
    await prisma.$executeRaw`DELETE FROM "Memory" WHERE "id" = ${memId}`
    await prisma.$executeRaw`DELETE FROM "ChangeLog" WHERE "entity" = 'memory' AND "entityId" = ${memId}`
    await prisma.$disconnect()
    console.log('🧹 Limpieza: memoria y auditoría de prueba borradas')
  }
}

main().catch((err) => {
  console.error('❌ SMOKE DE AUDITORÍA FALLÓ:', err)
  process.exit(1)
})
