/**
 * Cliente LLM del piloto, sin base de datos y sin estado global.
 *
 * Usa el endpoint OpenAI-compatible de Groq con un `fetch` inyectable para que
 * los tests no hagan red. El modo real es OPT-IN: hay que pasar `--live`, tener
 * `GROQ_API_KEY` y revisar el diff antes de enviarlo (ya pasa por `scrubText`).
 */

import { GROQ } from '@/app/lib/providers'
import { PILOT_VERDICTS, type PilotTaskName, type PilotVerdict } from '@/app/lib/pilot-traces'

export interface PilotLlmOptions {
  apiKey: string
  model?: string
  apiUrl?: string
  maxTokens?: number
  temperature?: number
  fetchImpl?: typeof fetch
}

export interface PilotRunOptions {
  live: boolean
  model: string
  verdict: PilotVerdict
  score: number | null
  maxTokens: number
}

export const DEFAULT_PILOT_MODEL = 'openai/gpt-oss-20b'
export const DEFAULT_PILOT_MAX_TOKENS = 900

/** Parseo de argumentos del script real; lanza si el modo no está habilitado. */
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

  if (!PILOT_VERDICTS.includes(verdict)) {
    throw new Error(`Veredicto inválido: "${verdict}". Usa uno de ${PILOT_VERDICTS.join(', ')}.`)
  }

  let score: number | null = null
  if (scoreRaw !== null) {
    const parsed = Number(scoreRaw)
    if (Number.isFinite(parsed)) score = parsed
  }

  return { live, model, verdict, score, maxTokens }
}

/** Llamada única a chat completions; devuelve solo el contenido del mensaje. */
export async function completeWithGroq(prompt: string, options: PilotLlmOptions): Promise<string> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('Falta GROQ_API_KEY para el modo LLM del piloto.')

  const doFetch = options.fetchImpl ?? fetch
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

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`Groq respondió ${res.status}: ${detail}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Groq devolvió una respuesta sin contenido.')
  }
  return content
}

/** Etiqueta corta para la traza; el prompt ya incluye la tarea completa. */
export function pilotTaskLabel(task: PilotTaskName): string {
  return task === 'test-generation' ? 'generador de tests' : 'resumidor de PR'
}
