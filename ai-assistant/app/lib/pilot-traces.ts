/**
 * Registro de trazas del piloto de modelos chicos (FASE 6, continuación).
 *
 * Guarda prompt, herramientas, salida y veredicto en JSONL para convertir
 * interacciones reales en datos de entrenamiento. Todo pasa por `scrubText`
 * antes de escribirse: el archivo resultante es local, está ignorado por git y
 * NUNCA debe subirse a Hugging Face ni a un repositorio público.
 *
 * No hace E/S por su cuenta: recibe un `TraceSink`. Así los tests usan un sink
 * en memoria y el script de demo decide dónde escribir.
 */

import { scrubText, type ScrubKind } from '@/app/lib/scrub'
import { sliceWindow } from '@/app/lib/truncate'

export type PilotTaskName = 'test-generation' | 'pr-summary'

export type PilotVerdict =
  | 'accepted'
  | 'rejected'
  | 'needs-review'
  | 'ci-passed'
  | 'ci-failed'

/** Valores admitidos para el veredicto del piloto. */
export const PILOT_VERDICTS: readonly PilotVerdict[] = [
  'accepted',
  'rejected',
  'needs-review',
  'ci-passed',
  'ci-failed',
] as const

export interface PilotToolTrace {
  name: string
  args?: unknown
  result?: unknown
}

export interface PilotTraceInput {
  task: PilotTaskName
  prompt: string
  output: string
  tools?: PilotToolTrace[]
  verdict?: PilotVerdict
  score?: number
  repo?: string
  meta?: Record<string, unknown>
  /** Anonimizaciones hechas antes de construir el prompt (p. ej. antes de enviar a Groq). */
  extraRedactions?: number
  extraByKind?: Partial<Record<ScrubKind, number>>
  now?: () => Date
}

export interface PilotTrace {
  id: string
  ts: string
  task: PilotTaskName
  repo: string | null
  prompt: string
  tools: PilotToolTrace[]
  output: string
  verdict: PilotVerdict | null
  score: number | null
  redactions: number
  byKind: Partial<Record<ScrubKind, number>>
  truncated: boolean
  meta: Record<string, unknown>
}

/** Destino de una línea JSONL. */
export interface TraceSink {
  append(line: string): void
}

export type PilotEvalVerdict = 'ci-passed' | 'ci-failed' | 'needs-review'

/** Evaluación de una traza; se guarda aparte para no mutar la traza original. */
export interface PilotEvalRecord {
  id: string
  traceId: string
  task: PilotTaskName
  verdict: PilotEvalVerdict
  score: number
  reasons: string[]
  details: string | null
  ts: string
}

/** Destino de las evaluaciones (JSONL separado de las trazas). */
export interface EvalSink {
  append(line: string): void
}

const MAX_FIELD_CHARS = 20_000

type Scrubbed<T> = {
  value: T
  redactions: number
  byKind: Partial<Record<ScrubKind, number>>
  truncated: boolean
}

function emptyCounts(): Partial<Record<ScrubKind, number>> {
  return {}
}

function mergeCounts(
  into: Partial<Record<ScrubKind, number>>,
  from: Partial<Record<ScrubKind, number>>,
): void {
  for (const [key, count] of Object.entries(from)) {
    const kind = key as ScrubKind
    into[kind] = (into[kind] ?? 0) + (count ?? 0)
  }
}

function scrubString(text: string): Scrubbed<string> {
  const window = sliceWindow(text, 0, MAX_FIELD_CHARS)
  const clean = scrubText(window.content)
  return {
    value: clean.text,
    redactions: clean.redactions,
    byKind: clean.byKind,
    truncated: window.truncated,
  }
}

function scrubValue(value: unknown): Scrubbed<unknown> {
  if (value === undefined) {
    return { value: undefined, redactions: 0, byKind: emptyCounts(), truncated: false }
  }
  if (typeof value === 'string') return scrubString(value)

  const json = JSON.stringify(value)
  const clean = scrubString(json ?? String(value))
  try {
    return { ...clean, value: JSON.parse(clean.value) as unknown }
  } catch {
    return { ...clean, value: clean.value }
  }
}

/**
 * Crea un registrador que anonimiza y escribe una traza por llamada.
 *
 * @example
 * const lines: string[] = []
 * const log = createTraceLogger({ append: (l) => lines.push(l) })
 * log.record({ task: 'pr-summary', prompt, output })
 */
export function createTraceLogger(sink: TraceSink) {
  return {
    record(input: PilotTraceInput): PilotTrace {
      const ts = (input.now?.() ?? new Date()).toISOString()
      const byKind = emptyCounts()
      let redactions = 0
      let truncated = false

      const take = <T>(clean: Scrubbed<T>): T => {
        redactions += clean.redactions
        truncated ||= clean.truncated
        mergeCounts(byKind, clean.byKind)
        return clean.value
      }

      redactions += input.extraRedactions ?? 0
      mergeCounts(byKind, input.extraByKind ?? {})

      const prompt = take(scrubString(input.prompt))
      const output = take(scrubString(input.output))
      const repo = input.repo ? take(scrubString(input.repo)) : null
      const meta = take(scrubValue(input.meta ?? {}))
      const tools = (input.tools ?? []).map((tool) => ({
        name: take(scrubString(tool.name)),
        ...(tool.args !== undefined ? { args: take(scrubValue(tool.args)) } : {}),
        ...(tool.result !== undefined ? { result: take(scrubValue(tool.result)) } : {}),
      }))

      const score =
        typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : null

      const trace: PilotTrace = {
        id: `${ts}-${input.task}-${prompt.length}-${output.length}`,
        ts,
        task: input.task,
        repo,
        prompt,
        tools,
        output,
        verdict: input.verdict ?? null,
        score,
        redactions,
        byKind,
        truncated,
        meta: (meta ?? {}) as Record<string, unknown>,
      }

      sink.append(`${JSON.stringify(trace)}\n`)
      return trace
    },
  }
}
