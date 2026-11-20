/**
 * Piloto con LLM real (Groq). OPT-IN: requiere `--live` y GROQ_API_KEY.
 *
 *   npm run pilot:llm -- --live
 *   npm run pilot:llm -- --live --model=openai/gpt-oss-20b --verdict=needs-review --score=4
 *
 * Envía el diff anonimizado a Groq. No despliega, no toca la BD y no imprime
 * la clave. Las trazas se guardan en data/traces/pilot.jsonl (ignorado).
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

async function main(): Promise<void> {
  const args = parsePilotArgs(process.argv.slice(2))
  if (!args.live) {
    throw new Error('El modo LLM requiere --live. Para prueba sin red usa npm run pilot:demo.')
  }

  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('Falta GROQ_API_KEY en .env.local o en el entorno.')

  const diff = git(['diff', 'HEAD'])
  if (!diff.trim()) {
    console.log('Sin cambios en git diff HEAD; no se llamó al LLM.')
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
  const result = await runPilot({
    diff,
    changedFiles,
    commits,
    systemPrompt: SYSTEM_PROMPT,
    repo: 'PABLOESTRADA20/ai-assistant',
    complete: (prompt) =>
      completeWithGroq(prompt, {
        apiKey,
        model: args.model,
        maxTokens: args.maxTokens,
      }),
    sink: { append: (line) => appendFileSync(OUT, line, 'utf8') },
    verdict: args.verdict,
    score: args.score ?? undefined,
    meta: { mode: 'llm', model: args.model },
  })

  console.log(
    `Piloto (LLM ${args.model}): ${changedFiles.length} archivos, ${result.testPath}, ` +
      `${result.prTitle}. ${result.traces} trazas en ${OUT} ` +
      `(redacciones: ${result.redactions}).`,
  )
}

main().catch((err: unknown) => {
  console.error('El piloto falló:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
