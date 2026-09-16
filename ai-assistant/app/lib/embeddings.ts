import fs from 'fs'
import path from 'path'
import { prisma } from './prisma'
import { getVaultIndex } from './vault-index'
import { embed, EMBEDDING_DIM, MODEL } from './llm-embed'
import type { VaultEntry } from './vault-index'

const MAX_EMBED_CHARS = 900
const MAX_CONTENT_CHARS = 8000
const DEFAULT_LIMIT = 500

function cleanText(text: string): string {
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
  indexed: number
  failed: number
  skipped: number
  model: string
  error?: string
}

export async function reindexVaultEmbeddings(limit = DEFAULT_LIMIT): Promise<ReindexResult> {
  const vp = process.env.VAULT_PATH
  if (!vp) throw new Error('VAULT_PATH no configurada')

  const index = getVaultIndex(true)
  if (!index) throw new Error('VAULT_PATH no indexado')

  const entries = index.entries.slice(0, limit)
  let indexed = 0
  let failed = 0
  let skipped = 0

  try {
    for (const entry of entries) {
      try {
        const full = path.join(vp, entry.path)
        const stat = fs.statSync(full)
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024) {
          skipped++
          continue
        }
        const raw = fs.readFileSync(full, 'utf-8')
        const content = cleanText(raw).slice(0, MAX_CONTENT_CHARS)
        const embedText = `passage: ${entry.title || entry.name}\n${raw.slice(0, MAX_EMBED_CHARS)}`
        const vec = await embed(embedText)
        await upsertNote(entry, content, vec)
        indexed++
      } catch {
        failed++
      }
    }
    return { ok: true, indexed, failed, skipped, model: MODEL }
  } catch (err) {
    return { ok: false, indexed, failed, skipped, model: MODEL, error: String(err) }
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
      return { path: row.path, score: roundScore(row.similarity), snippet }
    })
  } catch {
    return null
  }
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
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