/**
 * Demo local del piloto de modelo chico.
 *
 *   npm run pilot:demo
 *
 * Toma el diff real de la working tree, construye los prompts con el system
 * prompt de producción, usa un "modelo" determinista (sin red) y guarda las
 * trazas anonimizadas en data/traces/pilot.jsonl (ignorado por git).
 *
 * No despliega, no consulta la BD y no envía nada a ningún proveedor.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { SYSTEM_PROMPT } from '../app/lib/aria-core'
import { createTraceLogger, type PilotTaskName } from '../app/lib/pilot-traces'
import {
  buildPrSummaryPrompt,
  buildTestGenerationPrompt,
  parsePrSummary,
  parseTestProposal,
} from '../app/lib/pilot-tasks'

const OUT = resolve('data/traces/pilot.jsonl')

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
}

/** Sustituto del LLM: deja el circuito completo sin llamadas de red. */
function fakeComplete(_prompt: string, task: PilotTaskName): string {
  if (task === 'test-generation') {
    return [
      'ARCHIVO: tests/unit/piloto-generado.test.ts',
      '```ts',
      "import { describe, expect, it } from 'vitest'",
      '',
      "describe('piloto: propuesta de test', () => {",
      "  it('comprueba el nuevo comportamiento', () => {",
      '    expect(true).toBe(true)',
      '  })',
      '})',
      '```',
      '- generado por el piloto; revisar antes de commitear',
    ].join('\n')
  }
  return [
    'TÍTULO: Piloto de trazas, tests y resumen de PR',
    '',
    '## Qué cambia',
    'Añade registro de trazas anonimizadas y dos aplicaciones de ejemplo.',
    '',
    '## Por qué',
    'Genera señal medible para entrenar un modelo chico sin tocar producción.',
    '',
    '## Validación',
    'Pendiente de validar en CI.',
  ].join('\n')
}

function main(): void {
  const diff = git(['diff', 'HEAD'])
  if (!diff.trim()) {
    console.log('Sin cambios en git diff HEAD; no hay trazas nuevas.')
    return
  }

  const changedFiles = git(['diff', '--name-only', 'HEAD'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const commits = git(['log', '-5', '--pretty=%h %s'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  mkdirSync(dirname(OUT), { recursive: true })
  const logger = createTraceLogger({
    append: (line) => appendFileSync(OUT, line, 'utf8'),
  })

  const testPrompt = buildTestGenerationPrompt({
    diff,
    changedFiles,
    systemPrompt: SYSTEM_PROMPT,
  })
  const testProposal = parseTestProposal(fakeComplete(testPrompt, 'test-generation'))
  if (!testProposal) throw new Error('El generador de tests devolvió un formato inválido.')

  const testTrace = logger.record({
    task: 'test-generation',
    prompt: testPrompt,
    output: fakeComplete(testPrompt, 'test-generation'),
    tools: [{ name: 'git_diff', result: diff }],
    verdict: 'needs-review',
    repo: 'PABLOESTRADA20/ai-assistant',
    meta: {
      changedFiles: changedFiles.length,
      proposalPath: testProposal.path,
      notes: testProposal.notes,
    },
  })

  const prPrompt = buildPrSummaryPrompt({
    diff,
    commits,
    systemPrompt: SYSTEM_PROMPT,
    repo: 'PABLOESTRADA20/ai-assistant',
  })
  const prProposal = parsePrSummary(fakeComplete(prPrompt, 'pr-summary'))
  if (!prProposal) throw new Error('El resumidor de PR devolvió un formato inválido.')

  const prTrace = logger.record({
    task: 'pr-summary',
    prompt: prPrompt,
    output: fakeComplete(prPrompt, 'pr-summary'),
    tools: [{ name: 'git_log', result: commits.join('\n') }],
    verdict: 'needs-review',
    repo: 'PABLOESTRADA20/ai-assistant',
    meta: { proposalTitle: prProposal.title },
  })

  console.log(
    `Piloto: ${changedFiles.length} archivos, ${testProposal.path}, ` +
      `${prProposal.title}. Trazas en ${OUT} ` +
      `(redacciones: ${testTrace.redactions + prTrace.redactions}).`,
  )
}

main()
