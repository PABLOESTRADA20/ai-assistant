/**
 * Orquestación compartida del piloto: construye prompts, llama al completor
 * (real o determinista), parsea y guarda las trazas. Sin red propia ni BD.
 */

import { scrubText, type ScrubKind, type ScrubResult } from '@/app/lib/scrub'
import type { PilotTaskName, PilotVerdict, TraceSink } from '@/app/lib/pilot-traces'
import { createTraceLogger } from '@/app/lib/pilot-traces'
import {
  buildPrSummaryPrompt,
  buildTestGenerationPrompt,
  parsePrSummary,
  parseTestProposal,
} from '@/app/lib/pilot-tasks'

export interface PilotRunInput {
  diff: string
  changedFiles: string[]
  commits: string[]
  systemPrompt: string
  repo: string
  complete: (prompt: string, task: PilotTaskName) => string | Promise<string>
  sink: TraceSink
  verdict?: PilotVerdict
  score?: number
  meta?: Record<string, unknown>
}

export interface PilotRunResult {
  testPath: string
  prTitle: string
  redactions: number
  traces: number
}

/** Anonimiza antes de construir el prompt: lo que sale hacia el LLM ya va limpio. */
function safe(text: string): ScrubResult {
  return scrubText(text)
}

interface Counts {
  redactions: number
  byKind: Partial<Record<ScrubKind, number>>
}

function addCounts(items: ScrubResult[]): Counts {
  const byKind: Partial<Record<ScrubKind, number>> = {}
  let redactions = 0
  for (const item of items) {
    redactions += item.redactions
    for (const [key, count] of Object.entries(item.byKind)) {
      const kind = key as ScrubKind
      byKind[kind] = (byKind[kind] ?? 0) + (count ?? 0)
    }
  }
  return { redactions, byKind }
}

/**
 * Ejecuta las dos aplicaciones del piloto. Lanza si el completor devuelve un
 * formato que los parsers no aceptan; así no se guardan trazas inútiles.
 */
export async function runPilot(input: PilotRunInput): Promise<PilotRunResult> {
  const diff = safe(input.diff)
  const changedFiles = input.changedFiles.map(safe)
  const commits = input.commits.map(safe)
  const systemPrompt = safe(input.systemPrompt)
  const repo = safe(input.repo)
  const logger = createTraceLogger(input.sink)

  const testCounts = addCounts([diff, systemPrompt, repo, ...changedFiles])
  const prCounts = addCounts([diff, systemPrompt, repo, ...commits])

  const testPrompt = buildTestGenerationPrompt({
    diff: diff.text,
    changedFiles: changedFiles.map((item) => item.text),
    systemPrompt: systemPrompt.text,
  })
  const testOutput = await input.complete(testPrompt, 'test-generation')
  const testProposal = parseTestProposal(testOutput)
  if (!testProposal) {
    throw new Error(
      `El generador de tests devolvió un formato inválido: ${testOutput.slice(0, 500)}`,
    )
  }

  const testTrace = logger.record({
    task: 'test-generation',
    prompt: testPrompt,
    output: testOutput,
    tools: [{ name: 'git_diff', result: diff.text }],
    verdict: input.verdict ?? 'needs-review',
    score: input.score,
    repo: repo.text,
    extraRedactions: testCounts.redactions,
    extraByKind: testCounts.byKind,
    meta: {
      ...(input.meta ?? {}),
      changedFiles: changedFiles.length,
      proposalPath: testProposal.path,
      notes: testProposal.notes,
    },
  })

  const prPrompt = buildPrSummaryPrompt({
    diff: diff.text,
    commits: commits.map((item) => item.text),
    systemPrompt: systemPrompt.text,
    repo: repo.text,
  })
  const prOutput = await input.complete(prPrompt, 'pr-summary')
  const prProposal = parsePrSummary(prOutput)
  if (!prProposal) {
    throw new Error(`El resumidor de PR devolvió un formato inválido: ${prOutput.slice(0, 500)}`)
  }

  const prTrace = logger.record({
    task: 'pr-summary',
    prompt: prPrompt,
    output: prOutput,
    tools: [{ name: 'git_log', result: commits.map((item) => item.text).join('\n') }],
    verdict: input.verdict ?? 'needs-review',
    score: input.score,
    repo: repo.text,
    extraRedactions: prCounts.redactions,
    extraByKind: prCounts.byKind,
    meta: { ...(input.meta ?? {}), proposalTitle: prProposal.title },
  })

  return {
    testPath: testProposal.path,
    prTitle: prProposal.title,
    redactions: testTrace.redactions + prTrace.redactions,
    traces: 2,
  }
}
