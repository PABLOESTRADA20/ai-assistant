/**
 * Demo local del piloto de modelo chico.
 *
 *   npm run pilot:demo
 *
 * Igual circuito que el modo real, pero con un completor determinista: no hace
 * red ni consulta la BD. Escribe trazas anonimizadas en data/traces/pilot.jsonl
 * (ignorado por git).
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { SYSTEM_PROMPT } from '../app/lib/aria-core'
import { runPilot } from '../app/lib/pilot-run'
import type { PilotTaskName } from '../app/lib/pilot-traces'

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

async function main(): Promise<void> {
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
  const existingTests = git(['ls-files', 'tests/unit/*.test.ts'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  mkdirSync(dirname(OUT), { recursive: true })
  const result = await runPilot({
    diff,
    changedFiles,
    commits,
    systemPrompt: SYSTEM_PROMPT,
    repo: 'PABLOESTRADA20/ai-assistant',
    existingTests,
    complete: fakeComplete,
    sink: { append: (line) => appendFileSync(OUT, line, 'utf8') },
    verdict: 'needs-review',
    meta: { mode: 'demo' },
  })

  console.log(
    `Piloto (demo): ${changedFiles.length} archivos, ${result.testPath}, ` +
      `${result.prTitle}. ${result.traces} trazas en ${OUT} ` +
      `(redacciones: ${result.redactions}).`,
  )
}

main().catch((err: unknown) => {
  console.error('El piloto falló:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
