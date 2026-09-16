import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { createMemory, searchSemanticMemories, searchMemories, getContext, setContext, deleteContext } =
    await import('../app/lib/memory')

  console.log('1) Creando memoria de prueba...')
  const mem = await createMemory({
    type: 'long_term',
    category: 'preference',
    content: 'Al usuario le gusta usar VS Code y Python para sus proyectos',
    importance: 0.9,
    tags: ['preference', 'editor', 'python'],
    source: 'smoke-test',
  })
  console.log('   id:', mem.id, '| importance:', mem.importance)

  console.log('2) Búsqueda semántica (coseno)...')
  const hits = await searchSemanticMemories('qué editor usa el usuario', 3)
  const best = hits[0]
  console.log('   hit:', best.content, '| similarity:', best.similarity)
  if (!best || (best.similarity ?? 0) < 0.5) {
    throw new Error('La búsqueda semántica no encontró la memoria esperada')
  }

  console.log('3) Dedupe: re-creando la misma memoria (debe fusionar, no duplicar)...')
  await createMemory({
    type: 'long_term',
    category: 'preference',
    content: 'Al usuario le gusta usar VS Code y Python para sus proyectos',
    importance: 0.95,
    tags: ['preference'],
    source: 'smoke-test',
  })
  const after = await searchMemories({ category: 'preference', limit: 10 })
  const same = after.filter((m) => m.content.includes('VS Code'))
  console.log('   copias de la memoria:', same.length)
  if (same.length !== 1) throw new Error(`Se esperaba 1 memoria fusionada, hay ${same.length}`)
  console.log('   importance tras fusión:', same[0].importance, '(esperado >= 0.95)')
  if (same[0].importance < 0.95) throw new Error('No se subió importance al fusionar')

  console.log('4) Working memory (SessionContext)...')
  await setContext('smoke', { hello: 'world' }, 5)
  const ctx = await getContext<{ hello: string }>('smoke')
  console.log('   ctx:', JSON.stringify(ctx))
  if (ctx?.hello !== 'world') throw new Error('getContext no devolvió el valor guardado')
  await deleteContext('smoke')

  console.log('5) Limpieza...')
  const { prisma } = await import('../app/lib/prisma')
  await prisma.memory.deleteMany({ where: { source: 'smoke-test' } })
  console.log('   ok')

  console.log('\n✅ SMOKE TEST DE MEMORIA PASÓ')
}

main().catch((err) => {
  console.error('❌ SMOKE TEST FALLÓ:', err)
  process.exit(1)
})