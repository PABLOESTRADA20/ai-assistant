/**
 * Cliente de chat con auto-cambio de modelo.
 *
 * Cuando un modelo se queda sin cuota (Groq: 200.000 tokens/día por modelo;
 * Workers AI: 10.000 neuronas/día), el servidor devuelve 429 con
 * `code: 'quota_daily'`. Antes eso se mostraba como error y el usuario tenía que
 * cambiar de modelo a mano. Ahora se reintenta la MISMA petición con el siguiente
 * modelo de la lista, de forma transparente, avisando con `onFallback`.
 *
 * El orden prioriza Groq (más cuota) y deja Workers AI/DeepSeek al final: es
 * gratis pero solo tiene 10.000 neuronas/día y, al ser de razonamiento, no
 * soporta herramientas.
 */
import { apiFetch } from '@/app/lib/auth-client'
import type { SourceRef, ToolInvocation } from '@/app/types'

export const MODEL_FALLBACK_ORDER = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
]

/** El token de acceso dejó de ser válido: la app ya volvió al login. */
export class UnauthorizedError extends Error {
  constructor() {
    super('No autorizado')
    this.name = 'UnauthorizedError'
  }
}

export interface StreamChatOptions {
  messages: { role: string; content: string }[]
  model: string
  conversationId?: string
  signal: AbortSignal
  onContent: (accumulated: string) => void
  onTool: (tool: ToolInvocation, all: ToolInvocation[]) => void
  /** Se llama cuando llegan las fuentes del cerebro usadas en este turno. */
  onSources?: (sources: SourceRef[]) => void
  /** Se llama justo antes de reintentar con otro modelo. */
  onFallback?: (from: string, to: string, reason: string) => void
  /**
   * Se llama cuando el servidor comunica que la cuota diaria está agotada y
   * cuándo vuelve (ISO). El banner con cuenta regresiva se alimenta de esto.
   */
  onQuota?: (until: string) => void
}

export interface StreamChatResult {
  content: string
  tools: ToolInvocation[]
  /** Fuentes del cerebro (memoria/nota/vault/mensaje) usadas en la respuesta. */
  sources: SourceRef[]
  /** Modelo que finalmente respondió (puede diferir del solicitado). */
  model: string
  /** Modelo original, si hubo auto-cambio. */
  switchedFrom?: string
}

/**
 * ¿Merece la pena reintentar con otro modelo?
 *
 * Solo con errores de cuota/rate-limit/infraestructura. Un 400 (petición
 * inválida) o un 401 no se arreglan cambiando de modelo.
 */
function isRetryable(status: number, code: string | undefined, message: string): boolean {
  if (status === 429 || status === 502 || status === 503) return true
  if (code === 'quota_daily' || code === 'rate_limit' || code === 'upstream_error') return true
  // Falta la API key de un proveedor: otro proveedor sí podría responder.
  if (/no configurada|not configured|binding AI/i.test(message)) return true
  // Red de seguridad: algunos errores de cuota llegan envueltos en un 500.
  if (/tokens per day|TPD|free-models-per-day|per day|daily limit|neurons|rate limit|rate_limit_exceeded|quota/i.test(message)) return true
  return false
}

export async function streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
  const chain = [opts.model, ...MODEL_FALLBACK_ORDER.filter((m) => m !== opts.model)]
  let lastError: Error | null = null

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i]
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: opts.messages,
        model: candidate,
        conversationId: opts.conversationId,
      }),
      signal: opts.signal,
    })

    if (res.status === 401) throw new UnauthorizedError()

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: unknown
        code?: unknown
        until?: unknown
      }
      const message = typeof payload.error === 'string' ? payload.error : `Error ${res.status}`
      const code = typeof payload.code === 'string' ? payload.code : undefined
      const until = typeof payload.until === 'string' ? payload.until : undefined
      if (until) opts.onQuota?.(until)
      const next = chain[i + 1]

      if (next && isRetryable(res.status, code, message)) {
        lastError = new Error(message)
        console.warn(
          `[chat] ${candidate} no disponible (${res.status}${code ? ` ${code}` : ''}): ${message}. Probando ${next}`,
        )
        opts.onFallback?.(candidate, next, message)
        continue
      }
      throw new Error(message)
    }

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    let accumulated = ''
    // Puede cambiar si el servidor avisa que cambió de modelo para usar tools.
    let servedModel = candidate
    const toolEvents: ToolInvocation[] = []
    const sourceEvents: SourceRef[] = []

    if (reader) {
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'model_switch') {
              servedModel = typeof parsed.to === 'string' ? parsed.to : candidate
              const reason = typeof parsed.reason === 'string' ? parsed.reason : 'no_tools'
              if (typeof parsed.until === 'string') opts.onQuota?.(parsed.until)
              opts.onFallback?.(
                typeof parsed.from === 'string' ? parsed.from : candidate,
                servedModel,
                reason,
              )
              continue
            }
            if (parsed.type === 'tool_call') {
              const tool: ToolInvocation = {
                name: parsed.tool?.name || '',
                args: parsed.tool?.args || {},
                result: parsed.tool?.result,
                status: parsed.tool?.status === 'error' ? 'error' : 'done',
              }
              toolEvents.push(tool)
              opts.onTool(tool, toolEvents)
              continue
            }
            if (parsed.type === 'sources') {
              const list = parsed.sources
              if (Array.isArray(list)) {
                sourceEvents.length = 0
                for (const s of list) {
                  if (!s || typeof s.kind !== 'string' || typeof s.id !== 'string') continue
                  sourceEvents.push({
                    kind: ['memory', 'note', 'vault', 'message'].includes(s.kind)
                      ? s.kind
                      : 'message',
                    id: s.id,
                    title: typeof s.title === 'string' ? s.title : undefined,
                    snippet: typeof s.snippet === 'string' ? s.snippet : undefined,
                    score: typeof s.score === 'number' ? s.score : 0,
                    source: typeof s.source === 'string' ? s.source : undefined,
                  })
                }
                opts.onSources?.(sourceEvents)
              }
              continue
            }
            if (parsed.content) {
              accumulated += parsed.content
              opts.onContent(accumulated)
            }
          } catch {
            /* chunk malformado: se ignora */
          }
        }
      }
    }

    return {
      content: accumulated,
      tools: toolEvents,
      sources: sourceEvents,
      model: servedModel,
      switchedFrom: servedModel !== opts.model ? opts.model : undefined,
    }
  }

  throw lastError ?? new Error('Ningún modelo pudo responder. Inténtalo de nuevo en un momento.')
}
