import { v4 as uuidv4 } from 'uuid'
import { Prisma } from '../generated/prisma/wasm.js'
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

/** Cuanto sube una memoria cada vez que se usa para responder. */
const REINFORCE_IMPORTANCE = 0.05
const REINFORCE_CONFIDENCE = 0.03

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
  isCompressed: boolean
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
  isCompressed: boolean
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
    isCompressed: row.isCompressed,
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
    // Ya existe una memoria casi identica: se refuerza en vez de duplicarla.
    const best = dups[0]
    await prisma.$executeRaw`
      UPDATE "Memory"
      SET "importance" = ${Math.max(best.importance, importance)},
          "confidence" = ${Math.max(best.confidence, confidence)},
          "updatedAt" = NOW()
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

/**
 * Edita una memoria existente. Si cambia el contenido se recalcula su embedding
 * (el campo es `Unsupported` en Prisma, por eso el embedding se escribe con SQL
 * crudo). Editar a mano tambien desarchiva: si el usuario la toca, es que la
 * quiere viva.
 */
export interface MemoryUpdate {
  type?: string
  category?: string
  content?: string
  importance?: number
  confidence?: number
  tags?: string[]
}

export async function updateMemory(id: string, patch: MemoryUpdate): Promise<StoredMemory> {
  const content = patch.content?.trim()
  if (patch.content !== undefined && !content) throw new Error('Contenido vacío')

  const revive = patch.content !== undefined || patch.importance !== undefined

  await prisma.memory.update({
    where: { id },
    data: {
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(patch.importance !== undefined ? { importance: clamp01(patch.importance) } : {}),
      ...(patch.confidence !== undefined ? { confidence: clamp01(patch.confidence) } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(revive ? { isCompressed: false } : {}),
    },
  })

  if (content !== undefined) {
    const vec = await embed(`passage: ${content}`)
    await prisma.$executeRaw`
      UPDATE "Memory" SET "embedding" = ${vec}::vector WHERE "id" = ${id}
    `
  }

  return getMemoryById(id)
}

/**
 * Busqueda semantica. Excluye memorias archivadas (olvidadas) y ordena por una
 * mezcla de similitud + importancia, para que un recuerdo relevante y valorado
 * gane a uno igual de parecido pero trivial.
 */
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
      isCompressed: boolean
      createdAt: Date
      similarity: number
    }[]
  >`
    SELECT "id", "type", "category", "content", "importance", "confidence", "tags", "source",
           "isCompressed", "createdAt",
           1 - (embedding <=> ${vec}::vector) AS similarity
    FROM "Memory"
    WHERE embedding IS NOT NULL
      AND "isCompressed" = false
      AND 1 - (embedding <=> ${vec}::vector) >= ${minSimilarity}
    ORDER BY (1 - (embedding <=> ${vec}::vector)) * (0.7 + 0.3 * "importance") DESC
    LIMIT ${limit}
  `
  return rows.map((row) => toStored(row))
}

export interface MemoryFilters {
  type?: string
  category?: string
  minImportance?: number
  limit?: number
  /** Incluir memorias archivadas (por defecto no; el inspector si las muestra). */
  includeCompressed?: boolean
}

export async function searchMemories(filters: MemoryFilters = {}): Promise<StoredMemory[]> {
  const { type, category, minImportance, limit = 20, includeCompressed = false } = filters
  const where: Prisma.MemoryWhereInput = {
    ...(includeCompressed ? {} : { isCompressed: false }),
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

/**
 * Refuerza las memorias que acaban de usarse para responder: sube su
 * importancia/confianza y renueva `updatedAt`, de modo que el olvido por
 * antiguedad no se las lleve por delante. Se hace en una sola consulta.
 */
export async function reinforceMemories(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 16)
  if (unique.length === 0) return 0

  await prisma.$executeRaw`
    UPDATE "Memory"
    SET "importance" = LEAST(1, "importance" + ${REINFORCE_IMPORTANCE}),
        "confidence" = LEAST(1, "confidence" + ${REINFORCE_CONFIDENCE}),
        "updatedAt" = NOW()
    WHERE "isCompressed" = false
      AND "id" IN (${Prisma.join(unique)})
  `
  return unique.length
}

/**
 * Consolidacion y olvido.
 *
 *   - Archiva (isCompressed = true) las memorias antiguas y poco importantes:
 *     dejan de recuperarse, pero no se pierden.
 *   - Purga definitivamente las archivadas que ya son muy viejas (por
 *     `createdAt`, que no cambia, para que archivarlas no reinicie el reloj).
 *   - Limpia contextos de sesion caducados.
 */
export interface ConsolidateOptions {
  staleDays?: number
  minImportance?: number
  purgeDays?: number
}

export interface ConsolidateResult {
  compressed: number
  purged: number
  expiredContexts: number
}

export async function consolidateMemories(
  options: ConsolidateOptions = {}
): Promise<ConsolidateResult> {
  const staleDays = options.staleDays ?? 45
  const minImportance = options.minImportance ?? 0.35
  const purgeDays = options.purgeDays ?? 120

  const now = Date.now()
  const staleCutoff = new Date(now - staleDays * 86400000)
  const purgeCutoff = new Date(now - purgeDays * 86400000)

  const compressed = await prisma.memory.updateMany({
    where: {
      isCompressed: false,
      importance: { lt: minImportance },
      updatedAt: { lt: staleCutoff },
    },
    data: { isCompressed: true },
  })

  const purged = await prisma.memory.deleteMany({
    where: { isCompressed: true, createdAt: { lt: purgeCutoff } },
  })

  const expiredContexts = await prisma.sessionContext.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return {
    compressed: compressed.count,
    purged: purged.count,
    expiredContexts: expiredContexts.count,
  }
}

export interface MemoryStats {
  total: number
  compressed: number
  byType: Record<string, number>
  byCategory: Record<string, number>
  avgImportance: number
  updatedAt: string
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const rows = await prisma.memory.findMany({
    select: { type: true, category: true, importance: true, isCompressed: true },
    take: 5000,
  })

  const byType: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  let compressed = 0
  let sum = 0

  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
    if (row.isCompressed) compressed++
    sum += row.importance
  }

  return {
    total: rows.length,
    compressed,
    byType,
    byCategory,
    avgImportance: rows.length ? roundScore(sum / rows.length) : 0,
    updatedAt: new Date().toISOString(),
  }
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

// --- Memoria de trabajo (por conversacion) ---------------------------------

export interface WorkingMemory {
  topics: string[]
  goal?: string
  updatedAt?: string
}

function sessionKey(conversationId?: string | null): string {
  return conversationId ? `session:${conversationId}` : 'session:global'
}

export async function getWorkingMemory(
  conversationId?: string | null
): Promise<WorkingMemory | null> {
  return getContext<WorkingMemory>(sessionKey(conversationId))
}

/**
 * Anade el turno actual al hilo de trabajo de la conversacion. La clave incluye
 * el `conversationId` para que dos chats distintos no se contaminen entre si
 * (antes era una unica clave global 'session').
 */
export async function updateWorkingMemory(
  conversationId: string | null | undefined,
  userContent: string
): Promise<void> {
  const text = userContent.replace(/\s+/g, ' ').trim()
  if (!text) return

  const key = sessionKey(conversationId)
  const prev = (await getContext<WorkingMemory>(key)) ?? { topics: [] }
  const topic = text.slice(0, 90)
  const topics = [topic, ...prev.topics.filter((t) => t !== topic)].slice(0, 8)

  await setContext(key, { topics, goal: topic, updatedAt: new Date().toISOString() }, 60 * 24)
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

const MAINTENANCE_KEY = 'maintenance:consolidate'

/**
 * Consolidacion perezosa: se lanza de fondo desde el chat con probabilidad baja
 * y no repite el trabajo mas de una vez cada `minIntervalHours`. Asi el cerebro
 * se ordena solo sin depender de un cron.
 */
export async function maybeConsolidate(
  minIntervalHours = 24
): Promise<ConsolidateResult | null> {
  const last = await getContext<{ at: string }>(MAINTENANCE_KEY)
  if (last?.at && Date.now() - new Date(last.at).getTime() < minIntervalHours * 3600000) {
    return null
  }
  await setContext(MAINTENANCE_KEY, { at: new Date().toISOString() }, 60 * 24 * 7)
  return consolidateMemories()
}
