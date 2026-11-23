/**
 * Piloto con LLM real (Groq). OPT-IN: requiere `--live` y GROQ_API_KEY.
 *
 *   npm run pilot:llm -- --live
 *   npm run pilot:llm -- --live --ref=3530f64 --verdict=ci-passed
 *   npm run pilot:llm -- --live --model=qwen/qwen3.8-27b --max-tokens=900 --retries=2
 *
 * `--ref=` toma el diff de un commit contra su primer padre, pensado para PRs
 * ya fusionados. Envía el diff anonimizado a Groq. No despliega, no toca la BD
 * y no imprime la clave. Las trazas van a data/traces/pilot.jsonl (ignorado).
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { SYSTEM_PROMPT } from '../app/lib/aria-core'
import { completeWithGroq, parsePilotArgs } from '../app/lib/pilot-llm'
import { runPilot } from '../app/lib/pilot-run'

const OUT = resolve('data/traces/pilot.jsonl')

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
}

/** Working tree por defecto; con --ref, el cambio introducido por ese commit. */
function sourceArgs(ref: string | null): { diff: string[]; files: string[]; commits: string[] } {
  if (!ref) {
    return {
      diff: ['diff', 'HEAD'],
      files: ['diff', '--name-only', 'HEAD'],
      commits: ['log', '-5', '--pretty=%h %s'],
    }
  }
  return {
    diff: ['diff', `${ref}^1`, ref],
    files: ['diff', '--name-only', `${ref}^1`, ref],
    commits: ['log', '-1', '--pretty=%h %s', ref],
  }
}

async function main(): Promise<void> {
  const args = parsePilotArgs(process.argv.slice(2))
  if (!args.live) {
    throw new Error('El modo LLM requiere --live. Para prueba sin red usa npm run pilot:demo.')
  }

  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('Falta GROQ_API_KEY en .env.local o en el entorno.')

  const source = sourceArgs(args.ref)
  const diff = git(source.diff)
  if (!diff.trim()) {
    console.log(`Sin cambios para ${args.ref ?? 'HEAD'}; no se llamó al LLM.`)
    return
  }

  const changedFiles = git(source.files)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const commits = git(source.commits)
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
    complete: (prompt) =>
      completeWithGroq(prompt, {
        apiKey,
        model: args.model,
        maxTokens: args.maxTokens,
        retries: args.retries,
      }),
    sink: { append: (line) => appendFileSync(OUT, line, 'utf8') },
    verdict: args.verdict,
    score: args.score ?? undefined,
    meta: { mode: 'llm', model: args.model, ...(args.ref ? { ref: args.ref } : {}) },
  })

  console.log(
    `Piloto (LLM ${args.model}${args.ref ? ` @ ${args.ref}` : ''}): ` +
      `${changedFiles.length} archivos, ${result.testPath}, ${result.prTitle}. ` +
      `${result.traces} trazas en ${OUT} (redacciones: ${result.redactions}).`,
  )
}

main().catch((err: unknown) => {
  console.error('El piloto falló:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
