import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'

/**
 * Índice de código local (FASE 3).
 *
 * El Worker no puede leer el disco, así que el índice se construye aquí, donde
 * está el repo clonado, y se guarda en Postgres (`CodeChunk`). Después
 * `search_code` lo consulta desde la nube.
 *
 *   npm run db:index-code
 *
 * Puertas de costo (por qué esto no quema la cuota de Workers AI):
 *
 *   1. Si el hash del FICHERO (`fileHash`) no cambió, el fichero se salta entero
 *      y no se llama a ningún embedding. Es la aceptación de la fase: segunda
 *      ejecución sin cambios = cero llamadas.
 *   2. El texto concreto de un trozo puede repetirse entre ejecuciones: se
 *      consulta `EmbeddingCache` antes de llamar y se reutiliza el vector.
 *   3. Antes de empezar cada fichero se comprueba la reserva diaria
 *      (`fallbackBudgetLeft`); si está agotada se corta limpio y se informa.
 *
 * Opcionales (`.env.local`):
 *   CODE_INDEX_ROOT   raíz a indexar (por defecto el directorio actual)
 *   CODE_INDEX_REPO   etiqueta del repo (`owner/repo`); por defecto `local`
 */

interface Env {
  chunkCode: typeof import('../app/lib/code-index').chunkCode
  codeChunkText: typeof import('../app/lib/code-index').codeChunkText
  hashContent: typeof import('../app/lib/code-index').hashContent
  isIndexedFile: typeof import('../app/lib/code-index').isIndexedFile
  CODE_SKIP_DIRS: typeof import('../app/lib/code-index').CODE_SKIP_DIRS
  embed: typeof import('../app/lib/llm-embed').embed
  embeddingCacheGet: typeof import('../app/lib/llm-embed').embeddingCacheGet
  MODEL: typeof import('../app/lib/llm-embed').MODEL
  prisma: typeof import('../app/lib/prisma').prisma
  estimateEmbeddingNeurons: typeof import('../app/lib/quota').estimateEmbeddingNeurons
  fallbackBudgetLeft: typeof import('../app/lib/quota').fallbackBudgetLeft
}

/** Ficheros de más de esto no se leen (coste de memoria por poco valor). */
const MAX_FILE_BYTES = 400 * 1024

interface Walked {
  /** Rutas relativas ya normalizadas a `/`, ordenadas. */
  paths: string[]
  skipped: number
}

function walk(dir: string, skipDirs: Set<string>): Walked {
  const paths: string[] = []
  let skipped = 0

  const visit = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || skipDirs.has(entry.name)) {
          skipped++
          continue
        }
        visit(full)
        continue
      }
      if (!entry.isFile()) continue
      paths.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }

  visit(dir)
  paths.sort()
  return { paths, skipped }
}

/** Markdown estable del mapa del repo: cambia solo si cambia algo. */
function buildRepoMap(
  label: string,
  files: Map<string, string[]>,
  totalChunks: number,
): string {
  const dirs = new Map<string, { path: string; symbols: string[] }[]>()
  for (const [file, symbols] of files) {
    const dir = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/` : '(raíz)'
    const bucket = dirs.get(dir) ?? []
    bucket.push({ path: file, symbols })
    dirs.set(dir, bucket)
  }

  const lines: string[] = [
    `# REPO_MAP — ${label}`,
    '',
    '> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a',
    '> escribir solo si cambia algo. ARIA lo usa junto con `search_code` para ir',
    '> directo al trozo de código relevante sin leer fichero por fichero.',
    '',
    `- Ficheros indexados: ${files.size}`,
    `- Trozos: ${totalChunks}`,
    `- Embeddings: \`@cf/baai/bge-m3\` (1024 dims)`,
    '',
  ]

  for (const dir of [...dirs.keys()].sort()) {
    lines.push(`## ${dir}`)
    for (const { path: file, symbols } of dirs.get(dir)!) {
      const shown = symbols.length > 0 ? symbols.join(', ') : '—'
      lines.push(`- \`${file}\` → ${shown}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

async function main(): Promise<void> {
  const lib = await import('../app/lib/code-index')
  const llm = await import('../app/lib/llm-embed')
  const quota = await import('../app/lib/quota')
  const { prisma } = await import('../app/lib/prisma')

  const env: Env = {
    chunkCode: lib.chunkCode,
    codeChunkText: lib.codeChunkText,
    hashContent: lib.hashContent,
    isIndexedFile: lib.isIndexedFile,
    CODE_SKIP_DIRS: lib.CODE_SKIP_DIRS,
    embed: llm.embed,
    embeddingCacheGet: llm.embeddingCacheGet,
    MODEL: llm.MODEL,
    prisma,
    estimateEmbeddingNeurons: quota.estimateEmbeddingNeurons,
    fallbackBudgetLeft: quota.fallbackBudgetLeft,
  }

  const root = path.resolve(process.env.CODE_INDEX_ROOT || process.cwd())
  const repo = process.env.CODE_INDEX_REPO?.trim() || 'local'
  const started = Date.now()

  if (!fs.existsSync(root)) {
    throw new Error(`CODE_INDEX_ROOT no existe: ${root}`)
  }

  const { paths: allPaths, skipped: skippedDirs } = walk(root, env.CODE_SKIP_DIRS)

  // Solo ficheros con extensión conocida y tamaño razonable.
  const targets: { rel: string; abs: string }[] = []
  let tooBig = 0
  for (const rel of allPaths) {
    if (!env.isIndexedFile(rel)) continue
    const abs = path.join(root, rel)
    try {
      if (fs.statSync(abs).size > MAX_FILE_BYTES) {
        tooBig++
        continue
      }
    } catch {
      continue
    }
    targets.push({ rel, abs })
  }

  // Estado actual del índice: camino -> hash del fichero.
  const existingRows = await env.prisma.$queryRaw<{ path: string; fileHash: string }[]>`
    SELECT DISTINCT "path", "fileHash" FROM "CodeChunk" WHERE "repo" = ${repo}
  `
  const existingHash = new Map(existingRows.map((r) => [r.path, r.fileHash]))

  let unchanged = 0
  let indexed = 0
  let deleted = 0
  let chunksWritten = 0
  let embedApi = 0
  let embedCache = 0
  let failed = 0
  let neurons = 0
  let stoppedForQuota = false

  const seen = new Set<string>()

  for (const { rel, abs } of targets) {
    seen.add(rel)

    if (stoppedForQuota) continue

    let content: string
    try {
      content = fs.readFileSync(abs, 'utf-8')
    } catch {
      failed++
      continue
    }

    const fileHash = env.hashContent(content)
    if (existingHash.get(rel) === fileHash) {
      unchanged++
      continue
    }

    const chunks = env.chunkCode(rel, content)
    if (chunks.length === 0) {
      continue
    }

    if (!(await env.fallbackBudgetLeft())) {
      stoppedForQuota = true
      console.warn(`[index-code] reserva de Workers AI agotada: se corta en ${rel}`)
      continue
    }

    // 1) vectores primero: si un embedding falla, no se borra el índice previo.
    const vectors: string[] = []
    try {
      for (const chunk of chunks) {
        const text = env.codeChunkText(rel, chunk)
        const cached = await env.embeddingCacheGet(text)
        if (cached) {
          vectors.push(cached)
          embedCache++
          continue
        }
        vectors.push(await env.embed(text))
        embedApi++
        neurons += env.estimateEmbeddingNeurons(text)
      }
    } catch (err) {
      failed++
      if (/reserva de Workers AI agotada/i.test(String(err))) stoppedForQuota = true
      console.warn(`[index-code] ${rel}: ${String(err)}`)
      continue
    }

    // 2) swap atómico por fichero: nada de "borrado sin reescritura".
    try {
      const statements = [
        env.prisma.$executeRaw`
          DELETE FROM "CodeChunk" WHERE "repo" = ${repo} AND "path" = ${rel}
        `,
        ...chunks.map((chunk, i) => env.prisma.$executeRaw`
          INSERT INTO "CodeChunk"
            ("id", "repo", "path", "symbol", "kind", "lang", "startLine", "endLine",
             "content", "contentHash", "fileHash", "embedding", "createdAt", "updatedAt")
          VALUES (
            ${randomUUID()}, ${repo}, ${rel}, ${chunk.symbol}, ${chunk.kind}, ${chunk.lang},
            ${chunk.startLine}, ${chunk.endLine}, ${chunk.content}, ${chunk.contentHash},
            ${fileHash}, ${vectors[i]}::vector, NOW(), NOW()
          )
        `),
      ]
      await env.prisma.$transaction(statements)
      indexed++
      chunksWritten += chunks.length
    } catch (err) {
      failed++
      console.warn(`[index-code] ${rel}: no se pudo guardar: ${String(err)}`)
    }
  }

  // Ficheros que desaparecieron del disco: se retiran del índice.
  for (const [path] of existingHash) {
    if (seen.has(path)) continue
    try {
      const removed = await env.prisma.$executeRaw`
        DELETE FROM "CodeChunk" WHERE "repo" = ${repo} AND "path" = ${path}
      `
      deleted += Number(removed)
    } catch (err) {
      console.warn(`[index-code] no se pudo borrar ${path}: ${String(err)}`)
    }
  }

  // Mapa del repo: se reescribe SOLO si cambia el contenido resultante.
  const symbolRows = await env.prisma.$queryRaw<{ path: string; symbol: string | null }[]>`
    SELECT "path", "symbol" FROM "CodeChunk" WHERE "repo" = ${repo} ORDER BY "path"
  `
  const symbolsByPath = new Map<string, string[]>()
  for (const row of symbolRows) {
    if (!row.symbol) continue
    const bucket = symbolsByPath.get(row.path) ?? []
    if (!bucket.includes(row.symbol)) bucket.push(row.symbol)
    symbolsByPath.set(row.path, bucket)
  }
  const label = repo === 'local' ? path.basename(root) : repo
  const mapPath = path.join(root, 'REPO_MAP.md')
  const map = buildRepoMap(label, symbolsByPath, symbolRows.length)
  let mapWritten = false
  try {
    const current = fs.readFileSync(mapPath, 'utf-8')
    if (current !== map) {
      fs.writeFileSync(mapPath, map, 'utf-8')
      mapWritten = true
    }
  } catch {
    fs.writeFileSync(mapPath, map, 'utf-8')
    mapWritten = true
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    JSON.stringify(
      {
        root,
        repo,
        scanned: allPaths.length,
        candidates: targets.length,
        ignoredDirs: skippedDirs,
        ignoredBig: tooBig,
        indexed,
        unchanged,
        deleted,
        chunks: chunksWritten,
        embeddings: { api: embedApi, cache: embedCache },
        estimatedNeurons: neurons,
        failed,
        quota: stoppedForQuota ? 'agotada (se retoma sola al día siguiente)' : 'ok',
        repoMap: mapWritten ? 'actualizado' : 'sin cambios',
        seconds,
        model: env.MODEL,
      },
      null,
      2,
    ),
  )

  if (failed > 0) {
    console.warn(`[index-code] ${failed} ficheros fallaron (revisá los avisos de arriba).`)
  }
}

main().catch((err) => {
  console.error('ERROR', err)
  process.exit(1)
})
