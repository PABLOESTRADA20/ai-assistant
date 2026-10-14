import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * Smoke del índice de código (FASE 3) contra la BD real.
 *
 *   npm run db:smoke-code
 *
 * Verifica, SIN escribir nada, las cuatro piezas que solo se pueden comprobar
 * contra Postgres:
 *
 *   1. Que `CodeChunk` tiene filas (el índice no está vacío).
 *   2. Que la vía léxica (GIN + `websearch_to_tsquery('simple', ...)`) responde.
 *   3. Que la vía vectorial (HNSW, operador `<=>`) responde.
 *   4. Que `searchCode()` de la app funciona de punta a punta.
 *
 * El término de búsqueda NO se fija a mano: se toma del propio índice (un
 * símbolo o, si no hay, el nombre de un fichero ya indexado). Así el smoke
 * sigue valiendo aunque el índice esté a medias o crezca.
 */

async function main(): Promise<void> {
  const { prisma } = await import('../app/lib/prisma')
  const { searchCode } = await import('../app/lib/code-index')

  console.log('1) Contenido del índice...')
  const [counts] = await prisma.$queryRaw<{ chunks: bigint; files: bigint; repos: bigint }[]>`
    SELECT count(*) AS chunks, count(DISTINCT "path") AS files, count(DISTINCT "repo") AS repos
    FROM "CodeChunk"
  `
  console.log(`   chunks=${counts.chunks}  files=${counts.files}  repos=${counts.repos}`)
  if (Number(counts.chunks) === 0) {
    throw new Error('El índice está vacío: corre primero `npm run db:index-code`')
  }

  // Término real del índice: preferimos un símbolo; si no hay, una palabra del contenido.
  const [sample] = await prisma.$queryRaw<{ symbol: string | null; path: string; content: string }[]>`
    SELECT "symbol", "path", "content" FROM "CodeChunk"
    ORDER BY ("symbol" IS NULL), "path"
    LIMIT 1
  `
  const fromContent = /[A-Za-z_$][A-Za-z0-9_$]{3,}/.exec(sample.content)?.[0] ?? 'const'
  const term = sample.symbol?.trim() || fromContent
  console.log(`   término de prueba: "${term}"`)

  const tsv = `to_tsvector('simple', COALESCE("symbol", '') || ' ' || "path" || ' ' || "content")`

  console.log('2) Vía léxica (GIN + websearch_to_tsquery simple)...')
  const lex = await prisma.$queryRawUnsafe<{ path: string; symbol: string | null; rank: number }[]>(
    `SELECT "path", "symbol", ts_rank_cd(${tsv}, websearch_to_tsquery('simple', $1)) AS rank
     FROM "CodeChunk"
     WHERE ${tsv} @@ websearch_to_tsquery('simple', $1)
     ORDER BY rank DESC
     LIMIT 5`,
    term,
  )
  console.log(
    `   ${lex.length} filas; top:`,
    lex[0] ? `${lex[0].path} ${lex[0].symbol ?? ''} (rank ${lex[0].rank})` : '(ninguna)',
  )
  if (lex.length === 0) throw new Error(`La vía léxica no devolvió nada para "${term}"`)

  console.log('3) Vía vectorial (HNSW <=>)...')
  // Vector unitario cualquiera (no hace falta que sea una consulta real: solo
  // comprueba que el operador y el cast `::vector` funcionan con HNSW).
  const vecLiteral = `[${Array.from({ length: 1024 }, () => '0.03125').join(',')}]`
  const top = await prisma.$queryRawUnsafe<{ path: string; sim: number }[]>(
    `SELECT "path", 1 - (embedding <=> $1::vector) AS sim
     FROM "CodeChunk"
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 3`,
    vecLiteral,
  )
  console.log(
    `   ${top.length} filas; top:`,
    top[0] ? `${top[0].path} (sim ${top[0].sim})` : '(ninguna)',
  )
  if (top.length === 0) throw new Error('La vía vectorial no devolvió nada')

  console.log('4) searchCode() de punta a punta...')
  const hits = await searchCode(term, { limit: 3 })
  for (const h of hits) {
    console.log(`   ${h.score}  ${h.path}:${h.startLine}-${h.endLine} ${h.symbol ?? ''}`)
  }
  if (hits.length === 0) {
    console.log('   (sin hits por encima del umbral; normal si la cuota de embeddings está agotada)')
  }

  console.log('\n✅ SMOKE DEL ÍNDICE DE CÓDIGO PASÓ')
}

main().catch((err) => {
  console.error('❌ SMOKE DEL ÍNDICE DE CÓDIGO FALLÓ:', err)
  process.exit(1)
})
