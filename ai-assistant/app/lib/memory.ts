import { v4 as uuidv4 } from 'uuid'
import { Prisma } from './generated/prisma/index.js'
import { prisma } from './prisma'
import { embed } from './llm-embed'

export const MEMORY_TYPES = {
  longTerm: 'long_term',
  episodic: 'episodic',
  factual: 'factual',
  procedural: 'procedural',
  semantic: 'semantic',
} as const

export const MEMORY_CATEGORIES = {
  preference: 'preference',
  knowledge: 'knowledge',
  event: 'event',
  skill: 'skill',
  fact: 'fact',
} as const

const DEDUPE_THRESHOLD = 0.92

export interface MemoryInput {
  type: string
  category: string
  content: string
  importance?: number
  confidence?: number
  tags?: string[]
  source?: string
}

export interface StoredMemory {
  id: string
  type: string
  category: string
  content: string
  importance: number
  confidence: number
  tags: string[]
  source: string
  createdAt: Date
  similarity?: number
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

function toTags(json: unknown): string[] {
  if (Array.isArray(json)) return json.filter((t): t is string => typeof t === 'string')
  return []
}

function toStored(row: {
  id: string
  type: string
  category: string
  content: string
  importance: number
  confidence: number
  tags: unknown
  source: string
  createdAt: Date
  similarity?: number
}): StoredMemory {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    tags: toTags(row.tags),
    source: row.source,
    createdAt: row.createdAt,
    ...(row.similarity !== undefined ? { similarity: roundScore(row.similarity) } : {}),
  }
}

async function getMemoryById(id: string): Promise<StoredMemory> {
  const row = await prisma.memory.findUnique({ where: { id } })
  if (!row) throw new Error('Memoria no encontrada')
  return toStored(row)
}

export async function createMemory(input: MemoryInput): Promise<StoredMemory> {
  const content = input.content.trim()
  if (!content) throw new Error('Contenido vacío')

  const importance = clamp01(input.importance ?? 0.5)
  const confidence = clamp01(input.confidence ?? 0.5)
  const vec = await embed(`passage: ${content}`)

  const dups = await prisma.$queryRaw<
    { id: string; importance: number; confidence: number; similarity: number }[]
  >`
    SELECT "id", "importance", "confidence", 1 - (embedding <=> ${vec}::vector) AS similarity
    FROM "Memory"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT 1
  `

  if (dups.length > 0 && dups[0].similarity >= DEDUPE_THRESHOLD) {
    const best = dups[0]
    await prisma.$executeRaw`
      UPDATE "Memory"
      SET "importance" = ${Math.max(best.importance, importance)},
          "confidence" = ${Math.max(best.confidence, confidence)}
      WHERE "id" = ${best.id}
    `
    return getMemoryById(best.id)
  }

  const id = uuidv4()
  await prisma.$executeRaw`
    INSERT INTO "Memory"
      ("id", "type", "category", "content", "importance", "confidence", "tags", "source", "embedding", "createdAt", "updatedAt")
    VALUES
      (${id}, ${input.type}, ${input.category}, ${content}, ${importance}, ${confidence},
       ${JSON.stringify(input.tags ?? [])}::jsonb, ${input.source ?? 'conversation'}, ${vec}::vector, NOW(), NOW())
  `
  return getMemoryById(id)
}

export async function searchSemanticMemories(
  query: string,
  limit = 5,
  minSimilarity = 0
): Promise<StoredMemory[]> {
  const vec = await embed(`query: ${query}`)
  const rows = await prisma.$queryRaw<
    {
      id: string
      type: string
      category: string
      content: string
      importance: number
      confidence: number
      tags: unknown
      source: string
      createdAt: Date
      similarity: number
    }[]
  >`
    SELECT "id", "type", "category", "content", "importance", "confidence", "tags", "source", "createdAt",
           1 - (embedding <=> ${vec}::vector) AS similarity
    FROM "Memory"
    WHERE embedding IS NOT NULL
      AND 1 - (embedding <=> ${vec}::vector) >= ${minSimilarity}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${limit}
  `
  return rows.map((row) => toStored(row))
}

export interface MemoryFilters {
  type?: string
  category?: string
  minImportance?: number
  limit?: number
}

export async function searchMemories(filters: MemoryFilters = {}): Promise<StoredMemory[]> {
  const { type, category, minImportance, limit = 20 } = filters
  const where: Prisma.MemoryWhereInput = {
    ...(type ? { type } : {}),
    ...(category ? { category } : {}),
    ...(minImportance !== undefined ? { importance: { gte: minImportance } } : {}),
  }
  const rows = await prisma.memory.findMany({
    where,
    orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })
  return rows.map((row) => toStored(row))
}

export async function deleteMemory(id: string): Promise<void> {
  await prisma.memory.delete({ where: { id } })
}

export async function consolidateMemories(
  olderThanDays = 30,
  minImportance = 0.3
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000)
  const res = await prisma.memory.updateMany({
    where: { createdAt: { lt: cutoff }, importance: { lt: minImportance }, isCompressed: false },
    data: { isCompressed: true },
  })
  return res.count
}

export async function recordEpisode(
  content: string,
  importance = 0.5,
  tags: string[] = []
): Promise<StoredMemory> {
  return createMemory({
    type: MEMORY_TYPES.episodic,
    category: MEMORY_CATEGORIES.event,
    content,
    importance,
    confidence: 0.6,
    tags,
    source: 'conversation',
  })
}

export async function getContext<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.sessionContext.findFirst({
    where: { key, expiresAt: { gt: new Date() } },
  })
  return (row?.value as T) ?? null
}

export async function setContext(key: string, value: unknown, ttlMinutes = 30): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60000)
  const data = {
    value: value as Prisma.InputJsonValue,
    expiresAt,
  }
  await prisma.sessionContext.upsert({
    where: { key },
    update: data,
    create: { key, ...data },
  })
}

export async function deleteContext(key: string): Promise<void> {
  await prisma.sessionContext.deleteMany({ where: { key } })
}