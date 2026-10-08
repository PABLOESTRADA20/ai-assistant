/**
 * El cerebro: búsqueda unificada (vectorial + léxica) sobre memoria a largo
 * plazo, notas de la carpeta de ARIA, notas del vault de Obsidian y mensajes
 * viejos de la conversación en curso.
 *
 * Antes ARIA miraba solo `searchSemanticMemories` (una búsqueda vectorial
 * sobre `Memory`): lo que había quedado en una nota, en el vault o en el
 * historial de la misma conversación no entraba al contexto salvo por el
 * resumen. Acá cada fuente aporta candidatos con su propia similitud y el
 * resultado se funde con un OR probabilístico (`1 - ∏(1 - sᵢ)`): un recuerdo
 * que coincide en lo vectorial Y en lo léxico puntúa más alto que uno que
 * coincide en una sola vía.
 *
 * Los rangos léxicos de Postgres (`ts_rank_cd`) se normalizan a [0,1] con
 * `normalizeLexical` ANTES de fundir: crudos son ~0.01–0.1, así que `clamp01`
 * los dejaba inertes y los aciertos solo-léxicos caían por debajo del umbral.
 *
 * Las piezas puras (`orFuse`, `lexicalSim`) están separadas de la base para
 * poder unit-testearlas sin tocar Postgres (tests/unit/brain.test.ts).
 *
 * También vive acá el espejo Notas → Memoria: cuando se guarda una nota de la
 * carpeta de ARIA, se indexa como una memoria `source: 'note'` con un tag
 * `note:<id>` que permite actualizarla o retirarla al borrar la nota. Así el
 * cerebro la encuentra igual aunque la búsqueda no sea léxica, y la
 * consolidación/olvido la trata como un recuerdo más.
 */
import { Prisma } from '../generated/prisma/wasm.js'
import { prisma } from './prisma'
import { embed } from './llm-embed'
import { createMemory } from './memory'

/* ------------------------------------------------------------------ *
 * Helpers puros (unit-testeados)                                      *
 * ------------------------------------------------------------------ */

/**
 * Combina similitudes de fuentes independientes como un OR probabilístico:
 * 1 - ∏(1 - sᵢ). Devuelve 0 sin fuentes, crece con cada fuente que coincide
 * (monótono, acotado a [0,1]) y favorece el acuerdo entre vectorial y léxico.
 */
export function orFuse(scores: number[]): number {
  let p = 1
  for (const s of scores) {
    if (Number.isFinite(s) && s > 0) p *= 1 - Math.min(1, Math.max(0, s))
  }
  const fused = 1 - p
  return Math.round(Math.max(0, Math.min(1, fused)) * 1000) / 1000
}

/** Clasifica qué tan fuerte es una coincidencia léxica, en [0,1]. */
export function lexicalSim(title: string, content: string, query: string): number {
  const q = query?.trim().toLowerCase() ?? ''
  if (!q) return 0
  const hay = `${title ?? ''}\n${content ?? ''}`.toLowerCase()
  if (hay.includes(q)) return 0.95
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  if (words.length > 0 && words.every((w) => hay.includes(w))) return 0.85
  if (words.some((w) => hay.includes(w))) return 0.6
  return 0
}

/** Suavizado de `normalizeLexical`: menor = más agresivo. */
export const LEXICAL_SMOOTHING = 0.05

/**
 * Lleva un `ts_rank_cd` crudo (≈0.01–0.1 en documentos cortos; puede pasar de
 * 1 con muchas coincidencias) a [0,1) de forma monótona: `rank / (rank + k)`.
 *
 * - rank 0 o no finito → 0
 * - crece siempre y se satura cerca de 1 (nunca llega: tope 0.999)
 * - un match típico (~0.1) ronda 0.67, así sobrevive a `minScore: 0.4`
 *
 * Reemplaza a `clamp01` en las vías léxicas: recortar sin reescalar dejaba la
 * señal léxica casi nula dentro de `orFuse`.
 */
export function normalizeLexical(
  rank: number,
  smoothing: number = LEXICAL_SMOOTHING,
): number {
  const r = Number.isFinite(rank) && rank > 0 ? rank : 0
  if (r === 0) return 0
  const k = Number.isFinite(smoothing) && smoothing > 0 ? smoothing : LEXICAL_SMOOTHING
  return Math.min(0.999, Math.round((r / (r + k)) * 1000) / 1000)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

function preview(content: string, max = 240): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Etiqueta corta de un resultado para el contexto: le dice al modelo de dónde
 * salió cada dato sin filtrar el origen al usuario.
 */
export function labelHit(hit: BrainHit): string {
  switch (hit.kind) {
    case 'memory':
      // Las notas espejadas viven en Memoria con source 'note'.
      if (hit.source === 'note') return `[nota guardada en la carpeta de ARIA]`
      return `[memoria · ${hit.type ?? 'info'}/${hit.category ?? 'general'} · imp ${hit.importance ?? 0.5}]`
    case 'note':
      return `[nota de la carpeta de ARIA · ${hit.title ?? ''}]`
    case 'vault':
      return `[nota del vault de Obsidian · ${hit.title ?? ''}]`
    case 'message':
      return `[mensaje anterior de esta conversación]`
  }
}

/* ------------------------------------------------------------------ *
 * Dedup por contenido (colapsa duplicados y casi-duplicados)          *
 * ------------------------------------------------------------------ */

/** Similitud de Jaccard a partir de la cual dos contenidos son el mismo dato. */
export const DEDUPE_JACCARD = 0.85

/** Tokens significativos (minúsculas, sin acentos, ≥3 letras) de un texto. */
function contentTokens(content: string): Set<string> {
  const tokens = content
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
  return new Set(tokens)
}

/** Jaccard sobre conjuntos de tokens, en [0,1]. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let inter = 0
  for (const t of small) if (big.has(t)) inter++
  const union = a.size + b.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * Colapsa resultados con el MISMO dato y conserva el primero de cada grupo.
 *
 * El cerebro deduplica por `hit.id`, pero distintas fuentes describen el mismo
 * dato: una nota de la carpeta de ARIA y su espejo en `Memory` (mismo texto con
 * el prefijo `Nota "..."`), o dos memorias reformuladas. Como `searchBrain`
 * ordena por score descendente ANTES de llamar acá, el primero aceptado de cada
 * grupo es el mejor. Se colapsa por contenido normalizado y, si no, por Jaccard
 * de tokens ≥ `threshold` (conservador: no funde textos que solo comparten tema).
 */
export function dedupeHits(hits: BrainHit[], threshold = DEDUPE_JACCARD): BrainHit[] {
  const kept: BrainHit[] = []
  const seenKeys = new Set<string>()
  const tokenSets: Set<string>[] = []

  for (const hit of hits) {
    const key = hit.content.replace(/\s+/g, ' ').trim().toLowerCase()
    if (key && seenKeys.has(key)) continue

    const tokens = contentTokens(hit.content)
    if (tokens.size > 0 && tokenSets.some((s) => jaccard(s, tokens) >= threshold)) {
      continue
    }

    if (key) seenKeys.add(key)
    tokenSets.push(tokens)
    kept.push(hit)
  }

  return kept
}

/* ------------------------------------------------------------------ *
 * Resultado                                                            *
 * ------------------------------------------------------------------ */

export type BrainKind = 'memory' | 'note' | 'vault' | 'message'

export interface BrainHit {
  kind: BrainKind
  id: string
  title?: string
  content: string
  /** Trozo corto listo para inyectar al contexto o mostrar en la UI. */
  snippet: string
  tags: string[]
  source: string
  type?: string
  category?: string
  importance?: number
  createdAt: string
  /** Puntaje fundido [0,1]. */
  score: number
  conversationId?: string
}

export interface BrainSearchOptions {
  /** Máximo de resultados devueltos. Por defecto 8. */
  limit?: number
  /** Puntaje mínimo para devolver (puede subirse para el contexto). */
  minScore?: number
  /** Si viene, incluye los mensajes viejos de esa conversación. */
  conversationId?: string | null
}

const MAX_LIMIT = 20
const VECTOR_FLOOR = 0.1

/* ------------------------------------------------------------------ *
 * Empujón de ranking por importancia + recencia                        *
 * ------------------------------------------------------------------ */

/** Tope del empujón: 1.2. No alcanza a dar vuelta saltos de relevancia mayores. */
export const RANK_BOOST_MAX = 0.2
const IMPORTANCE_WEIGHT = 0.12
const RECENCY_WEIGHT = 0.08
/** Días para que el componente de recencia caiga a la mitad. */
const RECENCY_HALF_LIFE_DAYS = 120

/**
 * Multiplicador acotado `[1, 1 + RANK_BOOST_MAX]` para el score fusionado.
 *
 * - `importance` (1–10, opcional) aporta hasta `IMPORTANCE_WEIGHT`;
 * - la recencia (`createdAt`) decae con media vida de `RECENCY_HALF_LIFE_DAYS`
 *   y aporta hasta `RECENCY_WEIGHT`.
 *
 * Es multiplicativo y con tope, así que ordena a igual relevancia (o cerca)
 * pero NO puede adelantar a un resultado claramente más relevante. Se aplica
 * sobre los que ya pasaron el umbral: no permite cruzar `minScore` por sí solo.
 */
export function rankBoost(hit: BrainHit, now: number = Date.now()): number {
  const imp = hit.importance
  const importance =
    typeof imp === 'number' && Number.isFinite(imp) ? clamp01((imp - 1) / 9) : 0
  const ts = Date.parse(hit.createdAt)
  const recency = Number.isFinite(ts)
    ? Math.pow(0.5, Math.max(0, now - ts) / 86_400_000 / RECENCY_HALF_LIFE_DAYS)
    : 0
  const boost = importance * IMPORTANCE_WEIGHT + recency * RECENCY_WEIGHT
  return 1 + Math.min(RANK_BOOST_MAX, boost)
}

/* ------------------------------------------------------------------ *
 * Búsqueda unificada                                                  *
 * ------------------------------------------------------------------ */

/** Estrategia de puntaje por fuente, lista de candidatos. */
interface Candidate {
  hit: BrainHit
  scores: number[]
}

/** Fila de la búsqueda vectorial/léxica de `Memory`. */
type MemoryRow = {
  id: string
  type: string
  category: string
  content: string
  importance: number
  tags: unknown
  source: string
  createdAt: Date
  sim: number
}

/** Fila de la búsqueda vectorial de `VaultNote`. */
type VaultVectorRow = {
  path: string
  name: string
  title: string | null
  content: string
  updatedAt: Date
  sim: number
}

/** Fila de la búsqueda léxica de `VaultNote`. */
type VaultLexRow = {
  path: string
  name: string
  title: string | null
  content: string
  updatedAt: Date
  rank: number
}

/** Fila de la búsqueda léxica de `Note`. */
type NoteRow = {
  id: string
  title: string
  content: string
  tags: unknown
  source: string
  createdAt: Date
  updatedAt: Date
  rank: number
}

/** Fila de la búsqueda léxica de `Message`. */
type MsgRow = { id: string; role: string; content: string; createdAt: Date; rank: number }

/**
 * Ejecuta una consulta de una fuente del cerebro y, si falla, devuelve filas
 * vacías (best-effort como la caché): una tabla caída no tumba el resto de la
 * búsqueda ni el request que la llama.
 */
async function safeQuery<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run()
  } catch (err) {
    console.warn(`[brain] fuente ${label} no disponible:`, err)
    return []
  }
}

/** Candidato de vault a partir de un aporte puntuado (vectorial, léxico). */
function vaultCandidate(
  row: { path: string; name: string; title: string | null; content: string; updatedAt: Date },
  scores: number[],
): Candidate {
  return {
    scores,
    hit: {
      kind: 'vault',
      id: row.path,
      title: row.title ?? row.name,
      content: row.content,
      snippet: preview(row.content),
      tags: [],
      source: 'vault',
      createdAt: toIso(row.updatedAt),
      score: 0,
    },
  }
}

function memoryHit(
  row: MemoryRow,
  score: (sim: number) => number = clamp01,
): Candidate {
  return {
    scores: [score(row.sim)],
    hit: {
      kind: 'memory',
      id: row.id,
      content: row.content,
      snippet: preview(row.content),
      tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
      source: row.source,
      type: row.type,
      category: row.category,
      importance: row.importance,
      createdAt: new Date(row.createdAt).toISOString(),
      score: 0,
    },
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Búsqueda unificada del cerebro.
 *
 * Orden: 1) memoria a largo plazo (vectorial + léxica), 2) vault de Obsidian
 * (vectorial + léxica), 3) notas de la carpeta de ARIA (léxica), 4) mensajes
 * viejos de la conversación en curso (léxica). Cada fuente produce
 * similitudes que se funden con `orFuse`; el resultado se recorta por
 * `minScore`, se ordena y se limita.
 */
export async function searchBrain(
  query: string,
  options: BrainSearchOptions = {},
): Promise<BrainHit[]> {
  const q = query?.trim() ?? ''
  if (!q) return []

  const limit = Math.min(Math.max(1, options.limit ?? 8), MAX_LIMIT)
  const minScore = clamp01(options.minScore ?? 0)
  const conversationId = options.conversationId || null

  // El embedding puede fallar (cuota, red, binding ausente en Node): el cerebro
  // sigue funcionando con la vía léxica.
  let vec: string | null = null
  try {
    vec = await embed(`query: ${q}`)
  } catch {
    vec = null
  }

  const queryTs = Prisma.sql`websearch_to_tsquery('spanish', ${q})`
  const byKey = new Map<string, Candidate>()

  const push = (candidate: Candidate) => {
    const existing = byKey.get(candidate.hit.id)
    if (existing) existing.scores.push(...candidate.scores)
    else byKey.set(candidate.hit.id, candidate)
  }

  // ---- Fuentes (paralelas y best-effort) ----------------------------------
  // Todas las consultas son independientes: se lanzan con Promise.all y la
  // latencia es la de la más lenta, no la suma. Cada una viaja en `safeQuery`:
  // si una tabla falla (caída, esquema, red) las demás igual responden.
  const [memVectorial, memLexical, vaultRows, vaultLexRows, noteRows, msgRows] = await Promise.all([
    vec
      ? safeQuery('memoria vectorial', () =>
          prisma.$queryRaw<MemoryRow[]>`
            SELECT "id", "type", "category", "content", "importance", "tags", "source", "createdAt",
                   1 - (embedding <=> ${vec}::vector) AS sim
            FROM "Memory"
            WHERE embedding IS NOT NULL
              AND "isCompressed" = false
              AND 1 - (embedding <=> ${vec}::vector) >= ${VECTOR_FLOOR}
            ORDER BY (1 - (embedding <=> ${vec}::vector)) * (0.7 + 0.3 * "importance") DESC
            LIMIT 20
          `,
        )
      : Promise.resolve([] as MemoryRow[]),
    safeQuery('memoria léxica', () =>
      prisma.$queryRaw<MemoryRow[]>`
        SELECT "id", "type", "category", "content", "importance", "tags", "source", "createdAt",
               ts_rank_cd(to_tsvector('spanish', "content"), ${queryTs}) AS sim
        FROM "Memory"
        WHERE "isCompressed" = false
          AND to_tsvector('spanish', "content") @@ ${queryTs}
        LIMIT 15
      `,
    ),
    vec
      ? safeQuery('vault vectorial', () =>
          prisma.$queryRaw<VaultVectorRow[]>`
            SELECT "path", "name", "title", "content", "updatedAt",
                   1 - (embedding <=> ${vec}::vector) AS sim
            FROM "VaultNote"
            WHERE embedding IS NOT NULL
              AND 1 - (embedding <=> ${vec}::vector) >= ${VECTOR_FLOOR}
            ORDER BY embedding <=> ${vec}::vector
            LIMIT 10
          `,
        )
      : Promise.resolve([] as VaultVectorRow[]),
    // Vía léxica del vault: sin esto, una entrada sin vector (o con cuota de
    // embeddings agotada) quedaba invisible aunque tuviera la keyword exacta.
    safeQuery('vault léxico', () =>
      prisma.$queryRaw<VaultLexRow[]>`
        SELECT "path", "name", "title", "content", "updatedAt",
               ts_rank_cd(to_tsvector('spanish', concat_ws(' ', COALESCE("title", ''), "content")), ${queryTs}) AS rank
        FROM "VaultNote"
        WHERE to_tsvector('spanish', concat_ws(' ', COALESCE("title", ''), "content")) @@ ${queryTs}
        ORDER BY "updatedAt" DESC
        LIMIT 10
      `,
    ),
    safeQuery('notas', () =>
      prisma.$queryRaw<NoteRow[]>`
        SELECT "id", "title", "content", "tags", "source", "createdAt", "updatedAt",
               ts_rank_cd(to_tsvector('spanish', concat_ws(' ', "title", "content")), ${queryTs}) AS rank
        FROM "Note"
        WHERE to_tsvector('spanish', concat_ws(' ', "title", "content")) @@ ${queryTs}
        ORDER BY "updatedAt" DESC
        LIMIT 15
      `,
    ),
    conversationId
      ? safeQuery('mensajes', () =>
          prisma.$queryRaw<MsgRow[]>`
            SELECT "id", "role", "content", "createdAt",
                   ts_rank_cd(to_tsvector('spanish', "content"), ${queryTs}) AS rank
            FROM "Message"
            WHERE "conversationId" = ${conversationId}
              AND to_tsvector('spanish', "content") @@ ${queryTs}
            ORDER BY "createdAt" DESC
            LIMIT 15
          `,
        )
      : Promise.resolve([] as MsgRow[]),
  ])

  for (const row of memVectorial) push(memoryHit(row))
  // Vía léxica: el ts_rank_cd crudo se normaliza a [0,1] antes de fundir.
  for (const row of memLexical) push(memoryHit(row, normalizeLexical))
  for (const row of vaultRows) push(vaultCandidate(row, [clamp01(row.sim)]))
  for (const row of vaultLexRows) push(vaultCandidate(row, [normalizeLexical(row.rank)]))
  for (const row of noteRows) {
    const lex = lexicalSim(row.title, row.content, q)
    const rank = normalizeLexical(row.rank)
    push({
      scores: [Math.max(lex, rank)],
      hit: {
        kind: 'note',
        id: row.id,
        title: row.title,
        content: row.content,
        snippet: `${row.title}: ${preview(row.content, 160)}`,
        tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
        source: row.source,
        createdAt: toIso(row.createdAt),
        score: 0,
      },
    })
  }
  for (const row of msgRows) {
    const lex = lexicalSim('', row.content, q)
    const rank = normalizeLexical(row.rank)
    push({
      scores: [Math.max(lex, rank)],
      hit: {
        kind: 'message',
        id: row.id,
        content: row.content,
        snippet: preview(row.content, 200),
        tags: [],
        source: 'conversation',
        createdAt: toIso(row.createdAt),
        conversationId: conversationId ?? undefined,
        score: 0,
      },
    })
  }

  // ---- Fusión, filtro y orden ----------------------------------------------
  const now = Date.now()
  const hits: BrainHit[] = []
  for (const candidate of byKey.values()) {
    const base = orFuse(candidate.scores)
    if (base < minScore) continue
    // Importancia + recencia ponderan el puntaje devuelto y el ORDEN final
    // (ver `rankBoost`), pero el umbral sigue midiendo relevancia pura: el
    // empujón no mete al contexto un resultado sin suficiente relevancia.
    const score = clamp01(base * rankBoost(candidate.hit, now))
    hits.push({ ...candidate.hit, score })
  }

  hits.sort(
    (a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
  // Dedup por contenido ANTES de recortar: si no, dos recuerdos casi iguales
  // (o una nota y su espejo en memoria) se comen dos cupos de `limit`.
  return dedupeHits(hits).slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * Espejo Notas → Memoria                                              *
 * ------------------------------------------------------------------ */

const NOTE_TAG_PREFIX = 'note:'

function noteTag(noteId: string): string {
  return `${NOTE_TAG_PREFIX}${noteId}`
}

/**
 * Retira el espejo de una nota de la carpeta de ARIA (por el tag que dejó la
 * última indexación). Best-effort: si la base no responde, false.
 */
export async function removeMirroredNote(noteId: string): Promise<boolean> {
  if (!noteId) return false
  try {
    const count = await prisma.$executeRaw`
      DELETE FROM "Memory"
      WHERE "source" = 'note' AND "tags" @> ${JSON.stringify([noteTag(noteId)])}::jsonb
    `
    return count > 0
  } catch {
    return false
  }
}

/**
 * Indexa una nota de la carpeta de ARIA como memoria (source 'note' + tag
 * `note:<id>`). Se llama tras guardar o editar la nota; borrar la nota llama a
 * `removeMirroredNote`. Best-effort: nunca hace fallar el guardado de la nota.
 */
export async function mirrorNoteToMemory(note: {
  id: string
  title: string
  content: string
  tags?: unknown
}): Promise<boolean> {
  try {
    await removeMirroredNote(note.id)
    const content = `Nota "${(note.title ?? '').trim()}":\n${(note.content ?? '').trim()}`
    if (!content.trim()) return false

    await createMemory({
      type: 'factual',
      category: 'knowledge',
      content: content.slice(0, 4000),
      importance: 0.6,
      confidence: 0.8,
      tags: [
        ...(Array.isArray(note.tags)
          ? note.tags.filter((t): t is string => typeof t === 'string')
          : []),
        noteTag(note.id),
      ],
      source: 'note',
    })
    return true
  } catch (err) {
    console.warn('[brain] el espejo de la nota no quedó listo:', err)
    return false
  }
}