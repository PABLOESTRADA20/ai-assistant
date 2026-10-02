import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { v4 as uuidv4 } from 'uuid'

const SOURCE = 'brain-smoke'

async function main() {
  const memory = await import('../app/lib/memory')
  const { prisma } = await import('../app/lib/prisma')

  const marker = `brain-smoke-${uuidv4().slice(0, 8)}`

  const cleanup = async () => {
    await prisma.memory.deleteMany({ where: { source: SOURCE } })
    await prisma.sessionContext.deleteMany({ where: { key: { startsWith: 'session:brain-smoke' } } })
  }

  try {
    console.log('1) Memoria de trabajo aislada por conversacion...')
    const convA = `brain-smoke-a-${marker}`
    const convB = `brain-smoke-b-${marker}`
    await memory.updateWorkingMemory(convA, 'quiero aprender Rust')
    await memory.updateWorkingMemory(convA, 'ahora optimizar Postgres')
    const wmA = await memory.getWorkingMemory(convA)
    const wmB = await memory.getWorkingMemory(convB)
    console.log('   topics A:', JSON.stringify(wmA?.topics))
    if (!wmA || wmA.topics.length !== 2) throw new Error('La memoria de trabajo no acumulo los topics')
    if (wmA.topics[0] !== 'ahora optimizar Postgres') throw new Error('El topic mas reciente no va primero')
    if (wmB !== null) throw new Error('La memoria de trabajo se filtro entre conversaciones')

    console.log('2) createMemory + updateMemory (re-embedding)...')
    const created = await memory.createMemory({
      type: 'long_term',
      category: 'fact',
      content: `${marker} usa PostgreSQL para producir`,
      importance: 0.4,
      source: SOURCE,
    })
    const edited = await memory.updateMemory(created.id, {
      content: `${marker} usa PostgreSQL 17 para producir`,
      importance: 0.8,
    })
    if (!edited.content.includes('PostgreSQL 17') || edited.importance !== 0.8) {
      throw new Error('updateMemory no aplico los cambios')
    }
    console.log('   editado:', edited.content, '| imp:', edited.importance)

    console.log('3) reinforceMemories (Prisma.join)...')
    const before = edited.importance
    const n = await memory.reinforceMemories([created.id, created.id, 'no-existe'])
    const after = await prisma.memory.findUnique({ where: { id: created.id } })
    console.log(`   reforzadas=${n} imp ${before} -> ${after?.importance}`)
    if (!after || after.importance <= before) throw new Error('El refuerzo no subio la importancia')

    console.log('4) searchSemanticMemories excluye archivadas...')
    await prisma.memory.update({ where: { id: created.id }, data: { isCompressed: true } })
    const hidden = await memory.searchSemanticMemories(`herramienta de ${marker}`, 5, 0)
    if (hidden.some((m) => m.id === created.id)) throw new Error('Una memoria archivada seguia apareciendo')
    await prisma.memory.update({ where: { id: created.id }, data: { isCompressed: false } })
    console.log('   archivada oculta correctamente')

    console.log('5) getMemoryStats...')
    const stats = await memory.getMemoryStats()
    console.log('   total:', stats.total, '| archivadas:', stats.compressed, '| media:', stats.avgImportance)
    if (typeof stats.total !== 'number' || stats.total < 1) throw new Error('getMemoryStats no devolvio datos')

    console.log('6) consolidateMemories (purga de una archivada antigua)...')
    await prisma.$executeRaw`
      UPDATE "Memory" SET "isCompressed" = true, "createdAt" = NOW() - INTERVAL '60 days'
      WHERE "id" = ${created.id}
    `
    // minImportance -1 => no archiva nada; purgeDays 30 => purga solo lo muy viejo/archivado
    const result = await memory.consolidateMemories({
      staleDays: 0,
      minImportance: -1,
      purgeDays: 30,
    })
    console.log('   resultado:', JSON.stringify(result))
    const gone = await prisma.memory.findUnique({ where: { id: created.id } })
    if (gone) throw new Error('La memoria archivada antigua no se purgo')
    if (result.purged < 1) throw new Error('El contador de purgadas no cuadra')

    console.log('\n✅ SMOKE TEST DEL CEREBRO PASO')
  } finally {
    await cleanup()
    console.log('🧹 datos de prueba eliminados')
    process.exit(0)
  }
}

main().catch(async (err) => {
  console.error('❌ SMOKE TEST DEL CEREBRO FALLO:', err)
  process.exit(1)
})
