/**
 * Evaluación del piloto: convierte propuestas del LLM en veredictos.
 *
 * Es pura: no ejecuta código generado ni toca archivos. El script `pilot:eval`
 * inyecta `pathExists` y el `VitestRunner` para hacer la parte peligrosa en un
 * worktree temporal. Todo lo que se guarda pasa por `scrubText`.
 */

import { randomUUID } from 'node:crypto'

import { scrubText } from '@/app/lib/scrub'
import type { PrSummaryProposal, TestProposal } from '@/app/lib/pilot-tasks'
import type { PilotEvalRecord, PilotEvalVerdict, PilotTrace } from '@/app/lib/pilot-traces'

export interface ProposalEval {
  score: number
  reasons: string[]
  safeToRun: boolean
  verdict: PilotEvalVerdict
}

export interface VitestResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** El script real inyecta spawnSync; los tests inyectan un vi.fn(). */
export type VitestRunner = (file: string, cwd: string) => VitestResult

export interface TestEvalInput {
  proposal: TestProposal
  changedFiles: string[]
  pathExists: (path: string) => boolean
}

/** Patrones que hacen inseguro ejecutar el código que propuso el modelo. */
const DENIED = [
  /child_process/,
  /\bexec(?:Sync)?\s*\(/,
  /\bspawn(?:Sync)?\s*\(/,
  /(?:node:)?\bfs\b/,
  /\bprocess\.env\b/,
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\bPrismaClient\b/,
  /\brequire\s*\(/,
  /\bDATABASE_URL\b|\bGROQ_API_KEY\b|\bWHATSAPP_APP_SECRET\b/,
]

function deniedPattern(code: string): string | null {
  const found = DENIED.find((pattern) => pattern.test(code))
  return found ? found.source : null
}

/** Quita códigos ANSI y saltos de la salida de vitest para guardar texto legible. */
export function cleanLog(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim()
}

function changedBases(changedFiles: string[]): string[] {
  return changedFiles
    .flatMap((file) => {
      const base = file.split('/').pop() ?? file
      const stem = base.replace(/\.[^.]+$/, '')
      return stem && stem !== base ? [base, stem] : [base]
    })
    .filter(Boolean)
}

/** Rúbrica del test propuesto: 0-5 puntos y si es seguro ejecutarlo. */
export function evaluateTestProposal(input: TestEvalInput): ProposalEval {
  const reasons: string[] = []
  let score = 0
  const denied = deniedPattern(input.proposal.code)
  if (denied) {
    reasons.push(`patrón prohibido (${denied})`)
  } else {
    score += 1
    reasons.push('sin red, BD ni procesos')
  }

  if (/from\s+['"]vitest['"]/.test(input.proposal.code)) {
    score += 1
    reasons.push('importa Vitest')
  } else {
    reasons.push('no importa Vitest')
  }

  if (/\bexpect\s*\(/.test(input.proposal.code)) {
    score += 1
    reasons.push('tiene aserciones')
  } else {
    reasons.push('sin aserciones')
  }

  const path = input.proposal.path
  const exists = input.pathExists(path)
  if (!exists && path.startsWith('tests/unit/') && !path.includes('..')) {
    score += 1
    reasons.push('path nuevo')
  } else {
    reasons.push('path inválido o ya existe')
  }

  const bases = changedBases(input.changedFiles)
  if (bases.some((base) => input.proposal.code.includes(base))) {
    score += 1
    reasons.push('referencia archivos del cambio')
  } else {
    reasons.push('no referencia los archivos cambiados')
  }

  const safeToRun = !denied && !exists && input.proposal.code.length < 20_000
  return { score, reasons, safeToRun, verdict: safeToRun ? 'needs-review' : 'ci-failed' }
}

/** Rúbrica del resumen de PR: 0-5 puntos, sin ejecución de código. */
export function evaluatePrSummary(
  proposal: PrSummaryProposal,
  changedFiles: string[],
): ProposalEval {
  const reasons: string[] = []
  let score = 0

  if (proposal.title.trim() && proposal.title.length <= 72) {
    score += 1
    reasons.push('título válido')
  } else {
    reasons.push('título vacío o demasiado largo')
  }

  let sections = 0
  for (const section of ['## Qué cambia', '## Por qué', '## Validación']) {
    if (proposal.body.includes(section)) sections += 1
    else reasons.push(`falta ${section}`)
  }
  score += sections

  const text = `${proposal.title}\n${proposal.body}`
  const bases = changedBases(changedFiles)
  if (bases.some((base) => text.includes(base))) {
    score += 1
    reasons.push('menciona archivos del cambio')
  } else {
    reasons.push('no menciona los archivos cambiados')
  }

  return {
    score,
    reasons,
    safeToRun: false,
    verdict: score >= 4 ? 'ci-passed' : 'ci-failed',
  }
}

/** Se queda con la parte útil del log: el aviso de Vite no aporta señal. */
function failureSnippet(result: VitestResult): string {
  const text = `${result.stdout}\n${result.stderr}`
  const marker = text.search(/FAIL|AssertionError|Error:/)
  return cleanLog(marker >= 0 ? text.slice(marker) : text).slice(0, 160)
}

/** Incorpora el resultado real de vitest a la rúbrica estática. */
export function applyVitestResult(base: ProposalEval, result: VitestResult): ProposalEval {
  const ok = result.exitCode === 0
  return {
    score: ok ? base.score : Math.max(0, base.score - 1),
    reasons: [
      ...base.reasons,
      ok
        ? `vitest en verde: ${cleanLog(result.stdout).slice(0, 160)}`
        : `vitest falló (${result.exitCode}): ${failureSnippet(result)}`,
    ],
    safeToRun: false,
    verdict: ok && base.score >= 3 ? 'ci-passed' : 'ci-failed',
  }
}

export interface BuildEvalRecordInput {
  trace: PilotTrace
  evaluation: ProposalEval
  details?: string
  now?: () => Date
}

/** Construye el registro anonimizado que se añade a `data/traces/eval.jsonl`. */
export function buildEvalRecord(input: BuildEvalRecordInput): PilotEvalRecord {
  const clean = (text: string): string => scrubText(text).text
  return {
    id: randomUUID(),
    traceId: input.trace.id,
    task: input.trace.task,
    verdict: input.evaluation.verdict,
    score: input.evaluation.score,
    reasons: input.evaluation.reasons.map(clean),
    details: input.details ? clean(input.details.slice(0, 1_200)) : null,
    ts: (input.now?.() ?? new Date()).toISOString(),
  }
}

export function serializeEvalRecord(record: PilotEvalRecord): string {
  return `${JSON.stringify(record)}\n`
}
