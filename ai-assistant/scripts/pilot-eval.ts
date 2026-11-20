/**
 * Evalúa las trazas del piloto y guarda los veredictos en data/traces/eval.jsonl.
 *
 *   npm run pilot:eval            # solo trazas del modo LLM
 *   npm run pilot:eval -- --all   # incluye el demo determinista
 *
 * Los tests propuestos se ejecutan en un worktree temporal creado desde HEAD.
 * No hay red, no se consulta la BD, no se despliega y nunca se escribe sobre el
 * árbol de trabajo real. Los códigos peligrosos se descartan antes de ejecutar.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  applyVitestResult,
  buildEvalRecord,
  cleanLog,
  evaluatePrSummary,
  evaluateTestProposal,
  serializeEvalRecord,
  type ProposalEval,
  type VitestResult,
} from '../app/lib/pilot-eval'
import { parsePrSummary, parseTestProposal } from '../app/lib/pilot-tasks'
import type { PilotEvalVerdict, PilotTrace } from '../app/lib/pilot-traces'

const TRACES = resolve('data/traces/pilot.jsonl')
const EVALS = resolve('data/traces/eval.jsonl')
const WORKTREE = resolve('.tmp/pilot-eval')

/** El repo tiene el proyecto en un subdirectorio (`ai-assistant/`). */
const PREFIX = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' })
  .trim()
  .replace(/\\/g, '/')
const PROJECT = PREFIX ? join(WORKTREE, PREFIX) : WORKTREE

function git(args: string[]): void {
  execFileSync('git', args, { stdio: 'ignore' })
}

function readTraces(includeAll: boolean): PilotTrace[] {
  if (!existsSync(TRACES)) return []
  return readFileSync(TRACES, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PilotTrace]
      } catch {
        return []
      }
    })
    .filter((trace) => includeAll || trace.meta?.mode === 'llm')
}

function runVitest(file: string, cwd: string): VitestResult {
  const cli = resolve('node_modules/vitest/vitest.mjs')
  if (!existsSync(cli)) throw new Error(`No se encontró vitest en ${cli}.`)

  const result = spawnSync(process.execPath, [cli, 'run', file], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error) : ''),
  }
}

function changedFilesOf(trace: PilotTrace): string[] {
  const value = trace.meta?.changedFiles
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function recordEval(
  trace: PilotTrace,
  evaluation: ProposalEval,
  details?: string,
): void {
  mkdirSync(dirname(EVALS), { recursive: true })
  appendFileSync(
    EVALS,
    serializeEvalRecord(buildEvalRecord({ trace, evaluation, details })),
    'utf8',
  )
}

function evaluateTrace(trace: PilotTrace): void {
  const changedFiles = changedFilesOf(trace)


  if (trace.task === 'test-generation') {
    const proposal = parseTestProposal(trace.output)
    if (!proposal) {
      recordEval(
        trace,
        { score: 0, reasons: ['formato inválido'], safeToRun: false, verdict: 'ci-failed' },
        trace.output.slice(0, 1_200),
      )
      return
    }

    const base = evaluateTestProposal({
      proposal,
      changedFiles,
      pathExists: (path) => existsSync(join(PROJECT, path)),
    })

    if (!base.safeToRun) {
      recordEval(trace, base, proposal.path)
      return
    }

    const file = join(PROJECT, proposal.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, proposal.code, 'utf8')
    const result = runVitest(proposal.path, PROJECT)
    recordEval(
      trace,
      applyVitestResult(base, result),
      cleanLog(`${result.stdout}\n${result.stderr}`),
    )
    return
  }

  const proposal = parsePrSummary(trace.output)
  if (!proposal) {
    recordEval(
      trace,
      { score: 0, reasons: ['formato inválido'], safeToRun: false, verdict: 'ci-failed' },
      trace.output.slice(0, 1_200),
    )
    return
  }
  recordEval(trace, evaluatePrSummary(proposal, changedFiles), trace.output.slice(0, 1_200))
}

async function main(): Promise<void> {
  const traces = readTraces(process.argv.includes('--all'))
  if (!traces.length) {
    console.log('No hay trazas para evaluar (usa --all para incluir el demo).')
    return
  }

  try {
    git(['worktree', 'remove', '--force', WORKTREE])
  } catch {
    // Un worktree huérfano de una corrida anterior; se limpia abajo.
  }
  rmSync(WORKTREE, { recursive: true, force: true })
  mkdirSync(dirname(WORKTREE), { recursive: true })
  git(['worktree', 'add', '--detach', WORKTREE, 'HEAD'])

  try {
    for (const trace of traces) {
      try {
        evaluateTrace(trace)
      } catch (err: unknown) {
        recordEval(
          trace,
          {
            score: 0,
            reasons: ['error al evaluar'],
            safeToRun: false,
            verdict: 'ci-failed',
          },
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  } finally {
    try {
      git(['worktree', 'remove', '--force', WORKTREE])
    } catch {
      // Se fuerza el borrado del directorio de todas formas.
    }
    rmSync(WORKTREE, { recursive: true, force: true })
  }

  const records = readFileSync(EVALS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { verdict: PilotEvalVerdict })
  const latest = records.slice(-traces.length)
  const passed = latest.filter((item) => item.verdict === 'ci-passed').length
  const failed = latest.filter((item) => item.verdict === 'ci-failed').length
  const review = latest.filter((item) => item.verdict === 'needs-review').length

  console.log(
    `Evaluadas ${latest.length} trazas: ${passed} ci-passed, ${failed} ci-failed, ` +
      `${review} needs-review. Veredictos en ${EVALS}.`,
  )
}

main().catch((err: unknown) => {
  console.error('La evaluación falló:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
