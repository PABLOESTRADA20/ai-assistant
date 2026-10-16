import fs from 'fs'
import path from 'path'
import { prisma } from './prisma'
import { getVaultIndex } from './vault-index'
import { embed, EMBEDDING_DIM, MODEL } from './llm-embed'
import { round01 } from './num'
import type { VaultEntry } from './vault-index'

const MAX_EMBED_CHARS = 900
const MAX_CONTENT_CHARS = 8000
const DEFAULT_LIMIT = 500

export function cleanText(text: string): string {
  return text
    .replace(/^```[a-z]*\s*$/gm, '')
    .replace(/[`*_~|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function upsertNote(
  entry: VaultEntry,
  content: string,
  embedding: string
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "VaultNote" ("path", "name", "title", "content", "embedding", "updatedAt")
    VALUES (${entry.path}, ${entry.name}, ${entry.title ?? null}, ${content}, ${embedding}::vector, NOW())
    ON CONFLICT ("path") DO UPDATE SET
      "name" = EXCLUDED."name",
      "title" = EXCLUDED."title",
      "content" = EXCLUDED."content",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = NOW()
  `
}

export interface ReindexResult {
  ok: boolean
  /** Notas embebidas (nuevas o cambiadas) en esta pasada. */
  indexed: number
  failed: number
  /** Entradas que no son un fichero legible o que superan el tamaño máximo. */
  skipped: number
  /** Notas sin cambios desde la última indexación: NO gastaron cuota. */
  unchanged: number
  model: string
  error?: string
}

export interface ReindexOptions {
  /** Máximo de vectores nuevos por pasada (por defecto `DEFAULT_LIMIT`). */
  limit?: number
  /** Reindexa aunque el contenido no haya cambiado (por defecto `false`). */
  force?: boolean
}

/**
 * Decide si una nota guardada necesita que se le recalcule el vector.
 *
 * Es pura y se prueba aparte. Regla: solo se reindexa si no existe, si todavía
 * no tiene vector (p. ej. cuando se agotó la cuota) o si su contenido limpio
 * cambió. Así una pasada sobre el vault entero casi no gasta cuota.
 */
export function needsReindex(
  existing: { content: string; hasEmbedding: boolean } | undefined,
  nextContent: string,
  force = false,
): boolean {
  if (force) return true
  if (!existing) return true
  if (!existing.hasEmbedding) return true
  return existing.content !== nextContent
}

/**
 * Indexa (o actualiza) los vectores del vault en `VaultNote`.
 *
 * Es **incremental**: si el contenido limpio de una nota no cambió y ya tenía
 * vector, se omite sin gastar cuota. `limit` cuenta VECTORES nuevos, no
 * entradas examinadas, de modo que una pasada corta alcanza para las notas
 * cambiadas aunque estén al final del índice.
 */
export async function reindexVaultEmbeddings(
  options: ReindexOptions = {},
): Promise<ReindexResult> {
  const vp = process.env.VAULT_PATH
  if (!vp) throw new Error('VAULT_PATH no configurada')

  const index = getVaultIndex(true)
  if (!index) throw new Error('VAULT_PATH no indexado')

  const limit =
    Number.isFinite(options.limit) && (options.limit as number) > 0
      ? (options.limit as number)
      : DEFAULT_LIMIT
  const force = options.force === true

  // Mapa de lo ya guardado (contenido limpio + si tiene vector). Si la tabla no
  // responde, se reindexa todo, como antes.
  const existing = new Map<string, { content: string; hasEmbedding: boolean }>()
  try {
    const rows = await prisma.$queryRaw<
      { path: string; content: string; hasEmbedding: boolean }[]
    >`SELECT "path", "content", (embedding IS NOT NULL) AS "hasEmbedding" FROM "VaultNote"`
    for (const row of rows) {
      existing.set(row.path, { content: row.content, hasEmbedding: row.hasEmbedding })
    }
  } catch {
    /* sin mapa: todo cuenta como nuevo */
  }

  let indexed = 0
  let failed = 0
  let skipped = 0
  let unchanged = 0

  try {
    for (const entry of index.entries) {
      if (indexed >= limit) break
      try {
        const full = path.join(vp, entry.path)
        const stat = fs.statSync(full)
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) {
          skipped++
          continue
        }
        const raw = fs.readFileSync(full, 'utf-8')
        const content = cleanText(raw).slice(0, MAX_CONTENT_CHARS)
        if (!needsReindex(existing.get(entry.path), content, force)) {
          unchanged++
          continue
        }
        const embedText = `passage: ${entry.title || entry.name}\n${raw.slice(0, MAX_EMBED_CHARS)}`
        const vec = await embed(embedText)
        await upsertNote(entry, content, vec)
        existing.set(entry.path, { content, hasEmbedding: true })
        indexed++
      } catch {
        failed++
      }
    }
    return { ok: true, indexed, failed, skipped, unchanged, model: MODEL }
  } catch (err) {
    return { ok: false, indexed, failed, skipped, unchanged, model: MODEL, error: String(err) }
  }
}

export interface DbSemanticFile {
  path: string
  score: number
  snippet?: string
}

export async function semanticSearchDb(
  query: string,
  limit = 6
): Promise<DbSemanticFile[] | null> {
  try {
    const vec = await embed(`query: ${query}`)
    const rows = await prisma.$queryRaw<
      { path: string; name: string; content: string; similarity: number }[]
    >`
      SELECT "path", "name", "content", 1 - (embedding <=> ${vec}::vector) AS similarity
      FROM "VaultNote"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${limit}
    `
    return rows.map((row) => {
      const snippet = matchSnippet(row.content, query)
      return { path: row.path, score: round01(row.similarity), snippet }
    })
  } catch {
    return null
  }
}

function matchSnippet(content: string, query: string): string | undefined {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  const hay = content.toLowerCase()
  let idx = -1
  for (const w of words) {
    idx = hay.indexOf(w)
    if (idx >= 0) break
  }
  if (idx < 0) idx = 0
  const start = Math.max(0, idx - 60)
  return content.slice(start, start + 180).replace(/\s+/g, ' ').trim()
}