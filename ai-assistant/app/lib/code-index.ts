/**
 * Índice de código (FASE 3): troceo y búsqueda sobre `CodeChunk`.
 *
 * El Worker no puede leer el disco del PC ni clonar repos, así que el índice se
 * construye EN LOCAL con `scripts/index-code.ts` y vive en Postgres. Acá solo se
 * consulta: `searchCode` funde una vía vectorial (HNSW, `embedding <=>`) con una
 * léxica (GIN, `ts_rank_cd`) sobre `CodeChunk`, igual que el cerebro sobre
 * `Memory`. Así ARIA "conoce" el repo por significado sin leer archivo por
 * archivo ni cargar la PC.
 *
 * El troceado (`chunkCode`) es puro: ni Postgres ni `node:fs`, para poder
 * testearlo (tests/unit/code-index.test.ts) y correrlo desde el script.
 */
import { Prisma } from '../generated/prisma/wasm.js'
import { prisma } from './prisma'
import { embed } from './llm-embed'
import { normalizeLexical, orFuse } from './brain'
import { round01 } from './num'

/* ------------------------------------------------------------------ *
 * Constantes                                                          *
 * ------------------------------------------------------------------ */

/** Extensiones que se indexan. El objetivo es código, no binarios ni assets. */
export const CODE_INDEX_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'prisma', 'sql', 'sh', 'ps1',
  'yml', 'yaml', 'json', 'toml',
  'css', 'scss', 'html', 'md',
])

/** Carpetas que nunca se indexan (pesadas, generadas o de vendor). */
export const CODE_SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.open-next', '.wrangler', '.turbo',
  'dist', 'build', 'out', 'coverage', 'generated', 'vendor',
])

/** Máximo de caracteres por trozo. Las funciones largas se parten por líneas. */
export const CODE_MAX_CHUNK_CHARS = 1800

/** Un trozo más corto que esto se fusiona con el siguiente (imports, consts). */
export const CODE_MIN_CHUNK_CHARS = 200

/** Umbral de similitud vectorial para que un candidato entre al ranking. */
export const CODE_VECTOR_FLOOR = 0.1

/** Puntaje mínimo para devolver un resultado. */
export const CODE_MIN_SCORE = 0.25

/** Máximo de resultados aceptados por `searchCode`. */
export const CODE_MAX_LIMIT = 20

/** Pool de candidatos que se traen de cada vía antes de fundir. */
const CODE_SEARCH_POOL = 12

/* ------------------------------------------------------------------ *
 * Tipos                                                               *
 * ------------------------------------------------------------------ */

export type CodeChunkKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'file'
  | 'block'

export interface CodeChunkInput {
  /** Nombre de la función/clase/constante, si se detectó. */
  symbol: string | null
  kind: CodeChunkKind
  /** Línea inicial, 1-based e incluida. */
  startLine: number
  /** Línea final, 1-based e incluida. */
  endLine: number
  /** Código exacto del trozo. */
  content: string
  contentHash: string
  lang: string | null
}

export interface CodeHit {
  repo: string
  path: string
  symbol: string | null
  kind: string
  lang: string | null
  startLine: number
  endLine: number
  content: string
  score: number
}

export interface CodeSearchOptions {
  /** Límite de resultados (1..20). Por defecto 6. */
  limit?: number
  /** `owner/repo` para acotar; omite para buscar en todo lo indexado. */
  repo?: string | null
  /** Umbral de score. Por defecto `CODE_MIN_SCORE`. */
  minScore?: number
}

/* ------------------------------------------------------------------ *
 * Helpers puros                                                       *
 * ------------------------------------------------------------------ */

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', prisma: 'prisma', sql: 'sql',
  sh: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', json: 'json',
  toml: 'toml', css: 'css', scss: 'scss', html: 'html', md: 'markdown',
}

/** Lenguaje por extensión, o null si no está en la lista. */
export function langFromPath(path: string): string | null {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
  return LANG_BY_EXT[ext] ?? null
}

/** ¿Este archivo debe ir al índice? (extensión conocida) */
export function isIndexedFile(path: string): boolean {
  const name = path.split('/').pop() ?? path
  // Lockfiles y generado: sin código que merezca embedder.
  if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(name)) return false
  return langFromPath(path) !== null
}

/**
 * Hash estable de 16 hex (FNV-1a × dos semillas) usado para detectar cambios.
 *
 * Puro y barato a propósito: corre en el Worker y en el script sin importar
 * `node:crypto`. Para "¿cambió este fichero?" es más que suficiente; las
 * colisiones darían un falso "sin cambios" y solo en texto prácticamente
 * idéntico.
 */
export function hashContent(text: string): string {
  let h1 = 2166136261
  let h2 = 2166136261 ^ 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 16777619)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Braces de una línea ignorando cadenas y comentarios.
 *
 * Sin esto, `{` dentro de un string o de un comentario desalineaba la
 * profundidad y los troces salían en el lugar equivocado. No pretende ser un
 * parser: los regex literales con llaves y las plantillas multilínea con llaves
 * desbalanceadas siguen siendo puntos ciegos conocidos y aceptados (como mucho
 * parten un trozo de más, nunca pierden código).
 */
function braceDelta(line: string): number {
  let delta = 0
  let i = 0
  let quote: string | null = null

  while (i < line.length) {
    const c = line[i]

    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }

    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue }

    if (c === '/') {
      const next = line[i + 1]
      if (next === '/' && (i === 0 || /[\s(,=:[{;]/.test(line[i - 1]))) break
      if (next === '*') {
        const end = line.indexOf('*/', i + 2)
        i = end === -1 ? line.length : end + 2
        continue
      }
    }

    if (c === '{') delta++
    else if (c === '}') delta--
    i++
  }
  return delta
}

/** Declaración al inicio de la línea: nombre y tipo. null si no es una. */
function declInfo(line: string): { symbol: string | null; kind: CodeChunkKind } | null {
  const head = line.match(
    /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  )
  if (head) {
    const raw = head[1]
    const kind: CodeChunkKind = raw === 'enum' ? 'type' : (raw as CodeChunkKind)
    return { symbol: head[2], kind }
  }

  const var_ = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/)
  if (var_) return { symbol: var_[1], kind: 'const' }

  return null
}

interface Segment {
  start: number
  end: number
  symbol: string | null
  kind: CodeChunkKind
}

function segmentChars(lines: string[], seg: Segment): number {
  let total = 0
  for (let i = seg.start; i <= seg.end; i++) total += lines[i].length + 1
  return total
}

/**
 * Parte un segmento excesivamente largo en sub-segmentos de a lo sumo
 * `maxChars`, cortando siempre en líneas completas (nunca a mitad de un
 * identificador).
 */
function splitLong(
  lines: string[],
  seg: Segment,
  maxChars: number,
): Segment[] {
  if (segmentChars(lines, seg) <= maxChars) return [seg]

  const parts: Segment[] = []
  let start = seg.start
  let size = 0
  for (let i = seg.start; i <= seg.end; i++) {
    const len = lines[i].length + 1
    if (size > 0 && size + len > maxChars) {
      parts.push({ start, end: i - 1, symbol: seg.symbol, kind: seg.kind })
      start = i
      size = 0
    }
    size += len
  }
  if (start <= seg.end) {
    parts.push({ start, end: seg.end, symbol: seg.symbol, kind: seg.kind })
  }
  return parts
}

/**
 * Trocea un fichero en bloques por función/clase/archivo.
 *
 * Estrategia (deliberadamente simple, sin parser de lenguajes):
 *
 * 1. Corte en cada declaración que empieza a profundidad 0 de llaves
 *    (`function`, `class`, `interface`, `type`, `enum`, `const` de módulo). La
 *    profundidad evita partir dentro de un bloque; `braceDelta` ignora llaves
 *    en strings y comentarios.
 * 2. Todo lo anterior al primer corte (imports, doc) queda como `block` y se
 *    fusiona hacia adelante si es diminuto, igual que cualquier segmento corto:
 *    trozos de 3 líneas solo encarecerían el embedding.
 * 3. Los segmentos que pasan de `CODE_MAX_CHUNK_CHARS` se parten en líneas
 *    completas conservando símbolo y tipo.
 *
 * Devuelve [] para un fichero vacío o solo con espacios.
 */
export function chunkCode(path: string, content: string): CodeChunkInput[] {
  const normalized = (content ?? '').replace(/\r\n?/g, '\n')
  if (normalized.trim() === '') return []

  const lines = normalized.split('\n')
  const lang = langFromPath(path)

  // 1) cortes en declaraciones de profundidad 0
  const cuts: Segment[] = []
  let depth = 0
  let pending: Segment | null = null

  for (let i = 0; i < lines.length; i++) {
    const delta = braceDelta(lines[i])
    const info = depth === 0 ? declInfo(lines[i]) : null

    if (info) {
      // El comentario/docblock que precede a la declaración viaja con ella.
      let start = i
      while (start > 0 && /^\s*(\/\/|\/\*|\*|$)/.test(lines[start - 1])) start--
      if (pending) {
        pending.end = start - 1
        cuts.push(pending)
      }
      pending = { start, end: lines.length - 1, symbol: info.symbol, kind: info.kind }
    }

    depth = Math.max(0, depth + delta)
  }
  if (pending) cuts.push(pending)

  // 2) segmento inicial (imports y comentarios) si hay declaraciones
  let segments: Segment[] = cuts
  if (cuts.length === 0) {
    segments = [{ start: 0, end: lines.length - 1, symbol: null, kind: 'file' }]
  } else if (cuts[0].start > 0) {
    segments = [{ start: 0, end: cuts[0].start - 1, symbol: null, kind: 'block' }, ...cuts]
  }

  // 3) fusiona los segmentos diminutos con el siguiente (o con el previo)
  const merged: Segment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    const size = segmentChars(lines, seg)
    if (last && (size < CODE_MIN_CHUNK_CHARS || segmentChars(lines, last) < CODE_MIN_CHUNK_CHARS)) {
      if (!last.symbol && seg.symbol) {
        last.symbol = seg.symbol
        last.kind = seg.kind
      }
      last.end = seg.end
    } else {
      merged.push({ ...seg })
    }
  }

  // 4) reparte lo que quedó demasiado largo
  const out: CodeChunkInput[] = []
  for (const seg of merged) {
    for (const part of splitLong(lines, seg, CODE_MAX_CHUNK_CHARS)) {
      const code = lines.slice(part.start, part.end + 1).join('\n')
      if (code.trim() === '') continue
      out.push({
        symbol: part.symbol,
        kind: part.kind,
        startLine: part.start + 1,
        endLine: part.end + 1,
        content: code,
        contentHash: hashContent(`${path}|${part.start}|${part.end}|${code}`),
        lang,
      })
    }
  }
  return out
}

/**
 * Texto que se le pasa al modelo de embeddings.
 *
 * Lleva ruta, símbolo y tipo delante del código: la consulta "dónde se guarda
 * una nota" debe puntuar alto contra `path: app/lib/notes.ts :: saveNote`, no
 * solo contra el cuerpo de la función (que habla de otra cosa).
 */
export function codeChunkText(path: string, chunk: CodeChunkInput): string {
  const head = chunk.symbol ? `${path} :: ${chunk.symbol}` : path
  return `passage: ${chunk.lang ?? 'code'} ${head} (${chunk.kind})\n${chunk.content}`
}

/**
 * Funde las dos vías de un mismo trozo: vectorial + léxica (1 - ∏(1 - sᵢ)).
 *
 * Puro y separado de la base para poder testearlo sin Postgres.
 */
export function fuseCodeScores(
  vectorSim: number | null | undefined,
  lexicalRank: number | null | undefined,
): number {
  const scores: number[] = []
  if (typeof vectorSim === 'number' && Number.isFinite(vectorSim)) {
    scores.push(Math.min(1, Math.max(0, vectorSim)))
  }
  if (typeof lexicalRank === 'number' && Number.isFinite(lexicalRank)) {
    scores.push(normalizeLexical(lexicalRank))
  }
  return orFuse(scores)
}

/** Línea de una ficha de resultado, para el JSON que ve el modelo. */
export function formatCodeLocation(hit: CodeHit): string {
  const symbol = hit.symbol ? ` ${hit.symbol} (${hit.kind})` : ` (${hit.kind})`
  return `${hit.path}:${hit.startLine}-${hit.endLine}${symbol}`
}

/* ------------------------------------------------------------------ *
 * Búsqueda                                                            *
 * ------------------------------------------------------------------ */

type Row = {
  repo: string
  path: string
  symbol: string | null
  kind: string
  lang: string | null
  startLine: number
  endLine: number
  content: string
  sim: number
}

type LexRow = Omit<Row, 'sim'> & { rank: number }

/**
 * Ejecuta una consulta y devuelve [] si falla: una vía caída no tumba la otra
 * ni el request que la llama (mismo criterio que `safeQuery` del cerebro).
 */
async function safeCodeQuery<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run()
  } catch (err) {
    console.warn(`[code-index] vía ${label} no disponible:`, err)
    return []
  }
}

/**
 * Busca código por significado (vectorial) y por coincidencia léxica (GIN),
 * fundiendo ambas vías con `fuseCodeScores`. Best-effort: si el índice está
 * vacío o la BD no responde devuelve [] y el que la llama lo explica.
 */
export async function searchCode(
  query: string,
  options: CodeSearchOptions = {},
): Promise<CodeHit[]> {
  const q = query?.trim() ?? ''
  if (!q) return []

  const limit = Math.min(Math.max(1, options.limit ?? 6), CODE_MAX_LIMIT)
  const repo = options.repo?.trim() || null
  const minScore = options.minScore ?? CODE_MIN_SCORE

  // El embedding puede fallar (cuota, red, binding ausente): la vía léxica
  // igual responde, igual que en el cerebro.
  let vec: string | null = null
  try {
    vec = await embed(`query: ${q}`)
  } catch {
    vec = null
  }

  const tsv = Prisma.sql`to_tsvector('simple', COALESCE("symbol", '') || ' ' || "path" || ' ' || "content")`
  const queryTs = Prisma.sql`websearch_to_tsquery('simple', ${q})`
  const repoFilter = repo ? Prisma.sql`AND "repo" = ${repo}` : Prisma.empty

  const [vecRows, lexRows] = await Promise.all([
    vec
      ? safeCodeQuery('vectorial', () =>
          prisma.$queryRaw<Row[]>`
            SELECT "repo", "path", "symbol", "kind", "lang", "startLine", "endLine", "content",
                   1 - (embedding <=> ${vec}::vector) AS sim
            FROM "CodeChunk"
            WHERE embedding IS NOT NULL
              ${repoFilter}
              AND 1 - (embedding <=> ${vec}::vector) >= ${CODE_VECTOR_FLOOR}
            ORDER BY embedding <=> ${vec}::vector
            LIMIT ${CODE_SEARCH_POOL}
          `,
        )
      : Promise.resolve([] as Row[]),
    safeCodeQuery('léxica', () =>
      prisma.$queryRaw<LexRow[]>`
        SELECT "repo", "path", "symbol", "kind", "lang", "startLine", "endLine", "content",
               ts_rank_cd(${tsv}, ${queryTs}) AS rank
        FROM "CodeChunk"
        WHERE ${tsv} @@ ${queryTs}
          ${repoFilter}
        LIMIT ${CODE_SEARCH_POOL}
      `,
    ),
  ])

  const byKey = new Map<string, { hit: Omit<CodeHit, 'score'>, scores: number[] }>()
  const push = (row: Omit<Row, 'sim'>, score: number) => {
    const key = `${row.repo}:${row.path}:${row.startLine}`
    const existing = byKey.get(key)
    if (existing) {
      existing.scores.push(score)
      return
    }
    byKey.set(key, {
      scores: [score],
      hit: {
        repo: row.repo,
        path: row.path,
        symbol: row.symbol,
        kind: row.kind,
        lang: row.lang,
        startLine: row.startLine,
        endLine: row.endLine,
        content: row.content,
      },
    })
  }

  for (const row of vecRows) push(row, round01(row.sim))
  for (const row of lexRows) push(row, normalizeLexical(row.rank))

  const hits: CodeHit[] = []
  for (const entry of byKey.values()) {
    const score = orFuse(entry.scores)
    if (score < minScore) continue
    hits.push({ ...entry.hit, score: round01(score) })
  }

  hits.sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine,
  )
  return hits.slice(0, limit)
}
