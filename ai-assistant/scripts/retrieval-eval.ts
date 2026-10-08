/**
 * Evaluación LOCAL de recuperación del cerebro (cero red, cero API, cero BD).
 *
 * Mide Recall@k y MRR de la pipeline de scoring REAL — `orFuse`,
 * `normalizeLexical`, `rankBoost`, `dedupeHits` (funciones puras de brain.ts) —
 * sobre fixtures sintéticos con ground-truth. No toca la base de datos ni
 * llama a ningún modelo: los "sims" son valores ficticios que imitan la forma
 * real de los puntajes (vectorial ~0.3–0.9, ts_rank_cd léxico ~0.05–0.2).
 *
 * Compara el comportamiento ANTES de la FASE 2 (el rank léxico crudo se
 * fusionaba con `clamp01`, así que ~0.06 quedaba casi irrelevante y bajo el
 * umbral) con DESPUÉS (`normalizeLexical`, que lo lleva a ~0.55–0.75 y deja
 * sobrevivir a resultados que solo matchean por keyword).
 *
 *   npm run eval:retrieval
 */
import { pathToFileURL } from 'node:url'
import {
  dedupeHits,
  normalizeLexical,
  orFuse,
  rankBoost,
  type BrainHit,
} from '../app/lib/brain'

/* ------------------------------------------------------------------ *
 * Métricas                                                            *
 * ------------------------------------------------------------------ */

export interface RankedHit {
  id: string
  score: number
}

/** Fracción de ids relevantes que aparecen en el top-k. */
export function recallAtK(ranked: RankedHit[], relevant: string[], k: number): number {
  if (!Array.isArray(relevant) || relevant.length === 0 || !(k > 0)) return 0
  const top = new Set(ranked.slice(0, k).map((h) => h.id))
  const found = relevant.filter((id) => top.has(id)).length
  return found / relevant.length
}

/** Recíproco de la posición del primer relevante; 0 si no aparece en el ranking. */
export function mrr(ranked: RankedHit[], relevant: string[]): number {
  if (!Array.isArray(relevant) || relevant.length === 0) return 0
  const wanted = new Set(relevant)
  for (let i = 0; i < ranked.length; i++) {
    if (wanted.has(ranked[i].id)) return 1 / (i + 1)
  }
  return 0
}

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

const NOW = Date.parse('2026-10-08T00:00:00.000Z')
const MIN_SCORE = 0.4
/** Mismo piso de similitud vectorial que `searchBrain` (VECTOR_FLOOR). */
const VECTOR_FLOOR = 0.1

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString()
}

interface EvalDoc {
  id: string
  content: string
  importance: number
  /** Antigüedad en días: alimenta el componente de recencia de `rankBoost`. */
  ageDays: number
  /** Similitud vectorial cruda; 0 = sin vector (cuota agotada o sin embedding). */
  vectorSim: number
  /** ts_rank_cd en bruto (≈0.05–0.2) de la vía léxica. */
  lexicalRank: number
}

interface EvalCase {
  id: string
  query: string
  docs: EvalDoc[]
  /** Ids de `docs` que son la respuesta correcta. */
  relevant: string[]
}

/**
 * Fixtures con ground-truth:
 * - q1: el hit relevante tiene vector débil (0.3) y un buen match léxico;
 *   con la vía léxica cruda no pasa el umbral y queda fuera del top-3.
 * - q2: el hit relevante NO TIENE vector (simula cuota de embeddings agotada),
 *   solo match léxico; antes de 2.1 era directamente invisible.
 */
const CASES: EvalCase[] = [
  {
    id: 'q1',
    query: 'cómo levanto el servidor de la cola',
    relevant: ['d1'],
    docs: [
      { id: 'd1', content: 'levantar el server de la cola con systemd y espera activa', importance: 7, ageDays: 5, vectorSim: 0.3, lexicalRank: 0.09 },
      { id: 'd2', content: 'recetas de cocina italiana con albahaca fresca', importance: 3, ageDays: 60, vectorSim: 0.45, lexicalRank: 0 },
      { id: 'd3', content: 'cola de espera del soporte técnico', importance: 6, ageDays: 30, vectorSim: 0.42, lexicalRank: 0.05 },
      { id: 'd4', content: 'deploy del viernes con rollback automático', importance: 8, ageDays: 2, vectorSim: 0.5, lexicalRank: 0 },
    ],
  },
  {
    id: 'q2',
    query: 'qué ip tiene el servidor de staging',
    relevant: ['d5'],
    docs: [
      { id: 'd5', content: 'la ip del server de staging es 10.0.0.7 y el acceso es por vpn', importance: 5, ageDays: 10, vectorSim: 0, lexicalRank: 0.14 },
      { id: 'd6', content: 'plan de migración de postgres 16 a 17', importance: 4, ageDays: 90, vectorSim: 0.5, lexicalRank: 0 },
      { id: 'd7', content: 'presupuesto del mes y facturas vencidas', importance: 6, ageDays: 40, vectorSim: 0.44, lexicalRank: 0 },
    ],
  },
]

/* ------------------------------------------------------------------ *
 * Pipeline (mismas reglas y helpers puros que `searchBrain`)           *
 * ------------------------------------------------------------------ */

/**
 * Ordena los docs de un caso como lo haría `searchBrain`: fusiona con
 * `orFuse`, descarta por `minScore`, aplica `rankBoost` y deduplica.
 * `lexical` es la función de normalización del rank léxico: `clamp01`
 * (antes de 2.1) o `normalizeLexical` (después de 2.1).
 */
function rankCaseDocs(docs: EvalDoc[], lexical: (rank: number) => number): RankedHit[] {
  const hits: BrainHit[] = docs
    .map((doc) => {
      const scores: number[] = []
      if (doc.vectorSim >= VECTOR_FLOOR) scores.push(clamp01(doc.vectorSim))
      if (doc.lexicalRank > 0) scores.push(clamp01(lexical(doc.lexicalRank)))
      const base = orFuse(scores)
      if (base < MIN_SCORE) return null
      const hit: BrainHit = {
        kind: 'memory',
        id: doc.id,
        content: doc.content,
        snippet: doc.content.slice(0, 120),
        tags: [],
        source: 'eval',
        importance: doc.importance,
        createdAt: isoDaysAgo(doc.ageDays),
        score: 0,
      }
      return { ...hit, score: clamp01(base * rankBoost(hit, NOW)) }
    })
    .filter((h): h is BrainHit => h !== null)
  hits.sort((a, b) => b.score - a.score)
  return dedupeHits(hits).map((h) => ({ id: h.id, score: h.score }))
}

function measure(ranked: RankedHit[], relevant: string[]): CaseMetrics {
  return { recallAt3: recallAtK(ranked, relevant, 3), mrr: mrr(ranked, relevant) }
}

/* ------------------------------------------------------------------ *
 * Reporte                                                             *
 * ------------------------------------------------------------------ */

export interface CaseMetrics {
  recallAt3: number
  mrr: number
}

export interface EvalCaseRow {
  id: string
  query: string
  before: CaseMetrics
  after: CaseMetrics
}

export interface RetrievalEvalReport {
  cases: EvalCaseRow[]
  before: CaseMetrics
  after: CaseMetrics
  improved: boolean
}

export function buildRetrievalEvalReport(): RetrievalEvalReport {
  const cases: EvalCaseRow[] = CASES.map((c) => ({
    id: c.id,
    query: c.query,
    before: measure(rankCaseDocs(c.docs, clamp01), c.relevant),
    after: measure(rankCaseDocs(c.docs, normalizeLexical), c.relevant),
  }))

  const total = (pick: (row: EvalCaseRow) => CaseMetrics): CaseMetrics => ({
    recallAt3:
      cases.reduce((sum, row) => sum + pick(row).recallAt3, 0) / cases.length,
    mrr: cases.reduce((sum, row) => sum + pick(row).mrr, 0) / cases.length,
  })

  const before = total((row) => row.before)
  const after = total((row) => row.after)
  const improved = after.recallAt3 > before.recallAt3 && after.mrr > before.mrr
  return { cases, before, after, improved }
}

export function formatRetrievalReport(report: RetrievalEvalReport): string {
  const fmt = (m: CaseMetrics) => `R@3 ${m.recallAt3.toFixed(2)} · MRR ${m.mrr.toFixed(2)}`
  const lines = [
    'Evaluación de recuperación (Recall@3 / MRR) — pipeline real, cero red/API/BD.',
    '',
    ...report.cases.flatMap((c) => [
      `  ${c.id} «${c.query}»`,
      `    antes:   ${fmt(c.before)}`,
      `    después: ${fmt(c.after)}`,
    ]),
    '',
    `  TOTAL  antes:   ${fmt(report.before)}`,
    `         después: ${fmt(report.after)}`,
    '',
    report.improved
      ? '✅ normalizeLexical (2.1) sube recall y orden: lo léxico puro ya no queda bajo el umbral.'
      : '⚠️ Las métricas no mejoran: revisar la pipeline.',
  ]
  return lines.join('\n')
}

function main(): void {
  const report = buildRetrievalEvalReport()
  console.log(formatRetrievalReport(report))
  if (!report.improved) process.exit(1)
}

// Solo corre como CLI: importarlo desde un test no debe imprimir ni salir.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) main()