/**
 * Dataset ReAct/CoT para el generador de tests del piloto (FASE 6, continuación).
 *
 * No ejecuta código, no llama a la red y no toca la BD: recibe las trazas y sus
 * evaluaciones ya anonimizadas y devuelve ejemplos de chat. Lo importante aquí
 * es la SEÑAL: cada ejemplo lleva el razonamiento que llevó a aceptar o rechazar
 * una propuesta, no solo el código final.
 *
 * El split es por GRUPO (`meta.ref`, es decir, el PR de origen), no por ejemplo.
 * Así el modelo no ve en `valid` un caso del mismo diff que ya vio en `train`.
 * Todo vuelve a pasar por `scrubText` antes de escribirse: el dataset es local,
 * vive en `data/lora/` (ignorado) y NUNCA debe subirse a Hugging Face.
 */

import { scrubText, type ScrubKind } from './scrub'
import { sliceWindow } from './truncate'
import type { PilotEvalRecord, PilotTrace } from './pilot-traces'

export type TestgenVerdict = 'ci-passed' | 'ci-failed'
export type TestgenSplit = 'train' | 'valid'
export type TestgenRole = 'system' | 'user' | 'assistant'

export interface TestgenMessage {
  role: TestgenRole
  content: string
}

export interface TestgenExample {
  id: string
  group: string
  split: TestgenSplit
  verdict: TestgenVerdict
  score: number
  messages: TestgenMessage[]
}

export interface TestgenReport {
  traces: number
  testGenerationTraces: number
  withoutEval: number
  wrongTask: number
  wrongVerdict: number
  duplicates: number
  examples: number
  train: number
  valid: number
  groups: number
  heldOutPercent: number
  forcedHeldOut: boolean
  byVerdict: Record<TestgenVerdict, number>
  redactions: number
  byKind: Partial<Record<ScrubKind, number>>
}

export interface TestgenOptions {
  tracesPath: string
  evalsPath: string
  outDir: string
  heldOutPercent: number
  patience: number
  minDelta: number
  maxPromptChars: number
  maxOutputChars: number
  dryRun: boolean
}

export interface TestgenResult {
  examples: TestgenExample[]
  report: TestgenReport
  manifest: Record<string, unknown>
}

export const TESTGEN_SYSTEM = [
  'Eres ARIA, un asistente para programadores. Propones UN test unitario nuevo con Vitest.',
  'Razonas en voz alta antes de responder y usas exactamente este formato:',
  'Pensamiento: ...',
  'Acción: ...',
  'Observación: ...',
  '(repite los pasos que hagan falta y termina con "Respuesta:")',
  'Respuesta:',
  'ARCHIVO: tests/unit/piloto-generado-<nombre>.test.ts',
  '```ts',
  '...código del test...',
  '```',
  'Reglas: el path debe ser nuevo; sin red, sin BD real y sin secretos.',
  'Usa solo símbolos que aparezcan en el diff. Si el diff está truncado, no inventes firmas.',
  'Si una propuesta anterior falló, explica la corrección y no la repitas.',
].join('\n')

const DEFAULTS: TestgenOptions = {
  tracesPath: 'data/traces/pilot.jsonl',
  evalsPath: 'data/traces/eval.jsonl',
  outDir: 'data/lora/testgen-react',
  heldOutPercent: 20,
  patience: 2,
  minDelta: 0.001,
  maxPromptChars: 6_000,
  maxOutputChars: 8_000,
  dryRun: false,
}

/** FNV-1a de 32 bits: estable entre ejecuciones, sin randomness. */
export function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Porcentaje estable de una clave. Determinista y sin dependencias. */
export function bucketFor(value: string): number {
  return hash32(value) % 100
}

/** El PR de origen (o la traza si no hay ref) evita mezclar un mismo diff en dos splits. */
export function groupOf(trace: PilotTrace): string {
  const ref = trace.meta?.ref
  if (typeof ref === 'string' && ref.trim()) return `ref:${ref.trim()}`
  const repo = trace.repo
  if (typeof repo === 'string' && repo.trim()) return `repo:${repo.trim()}`
  return `trace:${trace.id}`
}

function arg(argv: string[], name: string): string | true | undefined {
  const flag = `--${name}`
  const i = argv.indexOf(flag)
  if (i === -1) {
    const prefixed = argv.find((item) => item.startsWith(`${flag}=`))
    return prefixed ? prefixed.slice(flag.length + 1) : undefined
  }
  const next = argv[i + 1]
  if (!next || next.startsWith('--')) return true
  return next
}

function has(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`) || argv.some((item) => item.startsWith(`${name}=`))
}

function numberOption(argv: string[], name: string, fallback: number): number {
  const value = arg(argv, name)
  if (typeof value !== 'string') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringOption(argv: string[], name: string, fallback: string): string {
  const value = arg(argv, name)
  return typeof value === 'string' && value.trim() ? value : fallback
}

/** Parse de banderas del CLI. La lógica de negocio no depende de `process.argv`. */
export function parseOptions(argv: string[], overrides: Partial<TestgenOptions> = {}): TestgenOptions {
  const options: TestgenOptions = {
    ...DEFAULTS,
    tracesPath: stringOption(argv, 'traces', DEFAULTS.tracesPath),
    evalsPath: stringOption(argv, 'evals', DEFAULTS.evalsPath),
    outDir: stringOption(argv, 'out', DEFAULTS.outDir),
    heldOutPercent: numberOption(argv, 'held-out', DEFAULTS.heldOutPercent),
    patience: numberOption(argv, 'patience', DEFAULTS.patience),
    minDelta: numberOption(argv, 'min-delta', DEFAULTS.minDelta),
    maxPromptChars: numberOption(argv, 'max-prompt-chars', DEFAULTS.maxPromptChars),
    maxOutputChars: numberOption(argv, 'max-output-chars', DEFAULTS.maxOutputChars),
    dryRun: has(argv, 'dry') || has(argv, 'dry-run'),
    ...overrides,
  }

  if (options.heldOutPercent < 0 || options.heldOutPercent > 100) {
    throw new Error('--held-out debe estar entre 0 y 100')
  }
  if (!Number.isInteger(options.patience) || options.patience < 1) {
    throw new Error('--patience debe ser un entero >= 1')
  }
  if (options.minDelta < 0) throw new Error('--min-delta no puede ser negativo')
  if (options.maxPromptChars < 200 || options.maxOutputChars < 200) {
    throw new Error('los límites de chars deben ser >= 200')
  }
  return options
}

interface Cleaned {
  text: string
  redactions: number
  byKind: Partial<Record<ScrubKind, number>>
}

function clean(input: string): Cleaned {
  const result = scrubText(input)
  return {
    text: result.text.replace(/\s+/g, ' ').trim(),
    redactions: result.redactions,
    byKind: result.byKind,
  }
}

function clip(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1))}…`
}

function addClean(report: TestgenReport, cleaned: Cleaned): void {
  report.redactions += cleaned.redactions
  for (const [kind, count] of Object.entries(cleaned.byKind)) {
    const key = kind as ScrubKind
    report.byKind[key] = (report.byKind[key] ?? 0) + (count ?? 0)
  }
}

/** Última evaluación de cada traza: el archivo JSONL puede tener reevaluaciones. */
export function latestEvaluations(evals: PilotEvalRecord[]): Map<string, PilotEvalRecord> {
  const latest = new Map<string, PilotEvalRecord>()
  for (const record of evals) {
    const previous = latest.get(record.traceId)
    if (!previous || record.ts >= previous.ts) latest.set(record.traceId, record)
  }
  return latest
}

function changedBases(trace: PilotTrace): string[] {
  const value = trace.meta?.changedFiles
  if (!Array.isArray(value)) return []
  return value
    .filter((file): file is string => typeof file === 'string')
    .map((file) => file.split('/').pop() ?? file)
    .filter(Boolean)
    .slice(0, 6)
}

/** Nombre inventado que hizo fallar vitest, si el log lo dice explícitamente. */
export function inventedSymbol(details: string | null): string | null {
  if (!details) return null
  const match = details.match(/\b([A-Za-z_$][\w$]*)\s+is not a function/i)
  return match?.[1] ?? null
}

function assistantContent(trace: PilotTrace, evaluation: PilotEvalRecord): Cleaned {
  const reasons = evaluation.reasons.map((reason) => clean(reason).text).filter(Boolean)
  const reasonsText = reasons.slice(0, 4).map((reason) => clip(reason, 180)).join('; ')
  const rawDetails = clean(clip(evaluation.details ?? '', 320)).text
  // El log de vitest se convierte en corrección, no en código que el modelo pueda copiar.
  const details = rawDetails.replace(
    /\b([A-Za-z_$][\w$]*)\s+is not a function/gi,
    (_match, name: string) => `${name} no existe en el cambio`,
  )
  const files = changedBases(trace).join(', ') || 'los archivos del cambio'
  const rawOutput = sliceWindow(trace.output, 0, 8_000).content
  const output = clean(rawOutput).text

  const lines =
    evaluation.verdict === 'ci-passed'
      ? [
          `Pensamiento: El diff toca ${files}. Voy a comprobar que la propuesta use símbolos reales y no dependa de red, BD ni secretos.`,
          'Acción: buscar en el diff el símbolo probado y validar que el path del test sea nuevo.',
          `Observación: la evaluación dio ci-passed (${evaluation.score}/5): ${reasonsText}.`,
          'Pensamiento: la propuesta referencia el cambio y cumple la rúbrica; la conservo.',
          'Acción: entregar el test en el formato exacto exigido.',
          'Observación: bloque cerrado y path dentro de tests/unit/.',
          'Respuesta:',
          output,
        ]
      : [
          `Pensamiento: La evaluación dio ci-failed (${evaluation.score}/5); no entrego la propuesta original tal cual.`,
          'Acción: contrastar cada razón con el diff y con la rúbrica del generador.',
          `Observación: ${reasonsText}${details ? ` La ejecución añadió: ${details}` : ''}`,
          `Pensamiento: el fallo principal es ${reasons[0] ?? 'no verificable'}. Repetir el código reforzaría el error.`,
          'Acción: reescribir el test con path nuevo en tests/unit/, Vitest, sin red/BD/secretos y solo símbolos presentes en el diff.',
          inventedSymbol(evaluation.details)
            ? `Observación: ${inventedSymbol(evaluation.details)} no existe en el cambio; no se importa. Si el diff está truncado, se reduce la aserción al comportamiento visible.`
            : 'Observación: corrección lista; no se inventan firmas aunque el diff esté truncado.',
          'Respuesta:',
          'No entrego la propuesta original. Aplico la corrección anterior antes de generar código.',
        ]

  const full = lines.join('\n')
  const cleaned = clean(full)
  return { ...cleaned, text: clip(cleaned.text, 8_000) }
}

/**
 * Construye los ejemplos. Devuelve también un informe auditable y el manifest
 * con la configuración de early stopping para el cuaderno de entrenamiento.
 */
export function buildTestgenDataset(
  traces: PilotTrace[],
  evals: PilotEvalRecord[],
  options: TestgenOptions = parseOptions([]),
): TestgenResult {
  const report: TestgenReport = {
    traces: traces.length,
    testGenerationTraces: 0,
    withoutEval: 0,
    wrongTask: 0,
    wrongVerdict: 0,
    duplicates: 0,
    examples: 0,
    train: 0,
    valid: 0,
    groups: 0,
    heldOutPercent: options.heldOutPercent,
    forcedHeldOut: false,
    byVerdict: { 'ci-passed': 0, 'ci-failed': 0 },
    redactions: 0,
    byKind: {},
  }

  const latest = latestEvaluations(evals)
  const seen = new Set<string>()
  const examples: TestgenExample[] = []

  for (const trace of traces) {
    if (trace.task !== 'test-generation') {
      report.wrongTask++
      continue
    }
    report.testGenerationTraces++
    const evaluation = latest.get(trace.id)
    if (!evaluation) {
      report.withoutEval++
      continue
    }
    if (evaluation.verdict !== 'ci-passed' && evaluation.verdict !== 'ci-failed') {
      report.wrongVerdict++
      continue
    }
    if (seen.has(trace.id)) {
      report.duplicates++
      continue
    }
    seen.add(trace.id)

    const group = groupOf(trace)
    const prompt = clean(sliceWindow(trace.prompt, 0, options.maxPromptChars).content)
    const answer = assistantContent(trace, evaluation)
    addClean(report, prompt)
    addClean(report, answer)

    examples.push({
      id: `testgen-${hash32(trace.id).toString(16)}`,
      group,
      split: bucketFor(group) < options.heldOutPercent ? 'valid' : 'train',
      verdict: evaluation.verdict,
      score: evaluation.score,
      messages: [
        { role: 'system', content: TESTGEN_SYSTEM },
        { role: 'user', content: clip(prompt.text, options.maxPromptChars) },
        { role: 'assistant', content: answer.text },
      ],
    })
    report.byVerdict[evaluation.verdict]++
  }

  examples.sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id))

  const groups = [...new Set(examples.map((example) => example.group))]
  report.groups = groups.length
  if (groups.length > 1 && options.heldOutPercent > 0 && !examples.some((e) => e.split === 'valid')) {
    const smallest = [...groups].sort((a, b) => bucketFor(a) - bucketFor(b))[0]
    for (const example of examples) {
      example.split = example.group === smallest ? 'valid' : 'train'
    }
    report.forcedHeldOut = true
  }

  report.examples = examples.length
  report.train = examples.filter((example) => example.split === 'train').length
  report.valid = examples.filter((example) => example.split === 'valid').length

  return {
    examples,
    report,
    manifest: {
      source: { traces: options.tracesPath, evals: options.evalsPath },
      format: 'chat',
      split: {
        strategy: 'group-hash',
        groupField: 'meta.ref',
        heldOutPercent: options.heldOutPercent,
      },
      earlyStopping: {
        monitor: 'valid_loss',
        mode: 'min',
        patience: options.patience,
        minDelta: options.minDelta,
      },
      privacy: {
        scrubbed: true,
        publicUploadForbidden: true,
      },
      report,
      examples: examples.map(({ id, group, split, verdict, score }) => ({
        id,
        group,
        split,
        verdict,
        score,
      })),
    },
  }
}

/** JSONL de entrenamiento: solo `messages`, como el resto de datasets del repo. */
export function serializeTestgenJsonl(examples: TestgenExample[]): string {
  return examples.map((example) => `${JSON.stringify({ messages: example.messages })}\n`).join('')
}
