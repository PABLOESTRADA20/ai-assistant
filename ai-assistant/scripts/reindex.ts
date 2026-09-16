import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { reindexVaultEmbeddings, semanticSearchDb } = await import('../app/lib/embeddings')

  console.log('Reindexando embeddings...')
  const res = await reindexVaultEmbeddings()
  console.log('Reindex:', JSON.stringify(res))

  console.log('\nProbando búsqueda semántica:')
  for (const q of ['arquitectura del cerebro', 'roadmap de semanas', 'redes neuronales']) {
    const rows = await semanticSearchDb(q)
    console.log(`\n--- "${q}" ---`)
    console.log(JSON.stringify(rows?.slice(0, 3), null, 2))
  }
}

main().catch((err) => {
  console.error('ERROR', err)
  process.exit(1)
})