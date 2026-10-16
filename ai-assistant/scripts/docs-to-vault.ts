import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * Copia la documentación del proyecto al vault de Obsidian y la indexa para el
 * cerebro (FASE 6).
 *
 *   npm run docs:vault                  # copia e indexa
 *   npm run docs:vault -- --no-index    # solo copia (no toca la tabla VaultNote)
 *   npm run docs:vault -- --dest="ARIA/Otra carpeta"
 *
 * Por qué las dos cosas: escribir el archivo alcanza para verlo en Obsidian,
 * pero el cerebro corre en el Worker y ahí NO hay disco (`VAULT_PATH` es local),
 * así que solo encuentra notas del vault por la tabla `VaultNote`. Por eso,
 * después de copiar, se indexa cada documento (con embedding si hay cuota; si
 * no, sin vector, y igual queda la búsqueda por texto).
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_DEST,
  PROJECT_DOCS,
  firstHeading,
  renderDoc,
  vaultRelPath,
} from '../app/lib/vault-docs'

type Copiado = { rel: string; source: string; content: string }

/** Acepta `--clave`, `--clave=valor` y `--clave valor`. */
function arg(nombre: string): string | true | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i === -1) return undefined
  const siguiente = process.argv[i + 1]
  if (!siguiente || siguiente.startsWith('--')) return true
  return siguiente
}

async function indexar(copiados: Copiado[]): Promise<void> {
  const { prisma } = await import('../app/lib/prisma')
  const { embed } = await import('../app/lib/llm-embed')
  const { cleanText } = await import('../app/lib/embeddings')

  let conVector = 0
  let sinVector = 0

  for (const f of copiados) {
    const name = f.rel.split('/').pop()!.replace(/\.md$/, '')
    const title = firstHeading(f.content, name)
    const content = cleanText(f.content).slice(0, 8000)

    let vector: string | null = null
    try {
      vector = await embed(`passage: ${title}\n${f.content.slice(0, 900)}`)
      conVector++
    } catch (err) {
      sinVector++
      console.log(`  (sin vector, solo texto) ${f.rel}: ${String(err).slice(0, 90)}`)
    }

    await prisma.$executeRaw`
      INSERT INTO "VaultNote" ("path", "name", "title", "content", "embedding", "updatedAt")
      VALUES (${f.rel}, ${name}, ${title}, ${content}, ${vector}::vector, NOW())
      ON CONFLICT ("path") DO UPDATE SET
        "name" = EXCLUDED."name",
        "title" = EXCLUDED."title",
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "updatedAt" = NOW()
    `
    console.log(`  Indexado: ${f.rel}`)
  }

  console.log(`\nCon vector: ${conVector}. Solo texto: ${sinVector}.`)
  console.log('El cerebro ya puede encontrarlos como notas del vault de Obsidian.')
}

async function main(): Promise<void> {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    throw new Error('VAULT_PATH no configurada. Revisá tu .env.local.')
  }

  const destDir =
    typeof arg('dest') === 'string' ? (arg('dest') as string) : DEFAULT_DEST
  const sinIndice = arg('no-index') === true
  const repoRoot = process.cwd()
  const targetDir = path.join(vaultPath, destDir)
  const generado = new Date().toISOString().slice(0, 10)

  fs.mkdirSync(targetDir, { recursive: true })

  console.log(`Vault:   ${vaultPath}`)
  console.log(`Destino: ${targetDir}\n`)

  const copiados: Copiado[] = []
  for (const doc of PROJECT_DOCS) {
    const from = path.join(repoRoot, doc.src)
    if (!fs.existsSync(from)) {
      console.log(`Omitido (no existe): ${doc.src}`)
      continue
    }
    const raw = fs.readFileSync(from, 'utf-8')
    const full = path.join(targetDir, doc.dest)
    fs.writeFileSync(full, renderDoc({ source: doc.src, content: raw, generatedAt: generado }), 'utf-8')
    const rel = vaultRelPath(destDir, doc.dest)
    copiados.push({ rel, source: doc.src, content: raw })
    console.log(`Copiado: ${doc.src}  ->  ${rel}`)
  }

  if (copiados.length === 0) {
    console.log('\nNo se copió nada.')
    return
  }

  if (sinIndice) {
    console.log('\n--no-index: no se indexó. Para el cerebro, corré `npm run db:reindex`.')
    return
  }

  console.log('\nIndexando para el cerebro...')
  await indexar(copiados)
}

main().catch((error) => {
  console.error('Falló la copia al vault:', error)
  process.exitCode = 1
})
