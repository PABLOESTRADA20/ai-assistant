/**
 * Cliente LLM del piloto, sin base de datos y sin estado global.
 *
 * Usa el endpoint OpenAI-compatible de Groq con un `fetch` inyectable para que
 * los tests no hagan red. El modo real es OPT-IN: hay que pasar `--live`, tener
 * `GROQ_API_KEY` y revisar el diff antes de enviarlo (ya pasa por `scrubText`).
 * Los 429/5xx se reintentan respetando el "try again in Xs" de Groq.
 */

import { GROQ } from '@/app/lib/providers'
import { PILOT_VERDICTS, type PilotTaskName, type PilotVerdict } from '@/app/lib/pilot-traces'

export interface PilotLlmOptions {
  apiKey: string
  model?: string
  apiUrl?: string
  maxTokens?: number
  temperature?: number
  retries?: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

export interface PilotRunOptions {
  live: boolean
  model: string
  verdict: PilotVerdict
  score: number | null
  maxTokens: number
  retries: number
  ref: string | null
}

export const DEFAULT_PILOT_MODEL = 'openai/gpt-oss-20b'
export const DEFAULT_PILOT_MAX_TOKENS = 900
export const DEFAULT_PILOT_RETRIES = 2

/** Parseo de argumentos del script real; lanza si el veredicto no es válido. */
export function parsePilotArgs(args: string[]): PilotRunOptions {
  const get = (name: string): string | null => {
    const prefix = `--${name}=`
    const found = args.find((arg) => arg.startsWith(prefix))
    return found ? found.slice(prefix.length) : null
  }

  const live = args.includes('--live')
  const model = get('model')?.trim() || DEFAULT_PILOT_MODEL
  const verdict = (get('verdict')?.trim() || 'needs-review') as PilotVerdict
  const scoreRaw = get('score')
  const maxTokensRaw = get('max-tokens')
  const parsedMax = maxTokensRaw === null ? Number.NaN : Number(maxTokensRaw)
  const maxTokens =
    Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : DEFAULT_PILOT_MAX_TOKENS
  const retriesRaw = get('retries')
  const parsedRetries = retriesRaw === null ? Number.NaN : Number(retriesRaw)
  const retries =
    Number.isFinite(parsedRetries) && parsedRetries >= 0
      ? Math.min(Math.floor(parsedRetries), 5)
      : DEFAULT_PILOT_RETRIES
  const ref = get('ref')?.trim() || null

  if (!PILOT_VERDICTS.includes(verdict)) {
    throw new Error(`Veredicto inválido: "${verdict}". Usa uno de ${PILOT_VERDICTS.join(', ')}.`)
  }

  let score: number | null = null
  if (scoreRaw !== null) {
    const parsed = Number(scoreRaw)
    if (Number.isFinite(parsed)) score = parsed
  }

  return { live, model, verdict, score, maxTokens, retries, ref }
}

/** Milisegundos sugeridos por Groq, acotados entre 0.5 y 30 s. */
export function retryDelayMs(detail: string): number {
  const seconds = Number(detail.match(/try again in\s*([\d.]+)s/i)?.[1] ?? '1')
  if (!Number.isFinite(seconds)) return 500
  return Math.min(Math.max(seconds * 1000, 500), 30_000)
}

/** Llamada a chat completions; devuelve solo el contenido del mensaje. */
export async function completeWithGroq(prompt: string, options: PilotLlmOptions): Promise<string> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('Falta GROQ_API_KEY para el modo LLM del piloto.')

  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const retries = options.retries ?? 0

  for (let attempt = 0; ; attempt += 1) {
    const res = await doFetch(options.apiUrl ?? GROQ.apiUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_PILOT_MODEL,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? DEFAULT_PILOT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const content = json.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Groq devolvió una respuesta sin contenido.')
      }
      return content
    }

    const detail = (await res.text()).slice(0, 300)
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= retries) {
      throw new Error(`Groq respondió ${res.status}: ${detail}`)
    }
    await sleep(retryDelayMs(detail))
  }
}

/** Etiqueta corta para la traza; el prompt ya incluye la tarea completa. */
export function pilotTaskLabel(task: PilotTaskName): string {
  return task === 'test-generation' ? 'generador de tests' : 'resumidor de PR'
}
