/**
 * Puente entre el binding `AI` de Cloudflare Workers AI y el resto de ARIA.
 *
 * El binding devuelve SSE con su propio formato (`{ response: "..." }`),
 * mientras que la ruta de chat ya sabe parsear SSE estilo OpenAI
 * (`{ choices: [{ delta: { content } }] }`). En vez de bifurcar el parser, aquí
 * se normaliza el stream a formato OpenAI para reutilizar el mismo camino que
 * Groq. Se usa el binding (no el endpoint REST) porque no exige ningún token
 * extra: el `AI` ya está configurado en `wrangler.jsonc`.
 *
 * Extra: los modelos de razonamiento (DeepSeek R1) mandan su cadena de
 * pensamiento dentro de `response`, envuelta entre una etiqueta de apertura y
 * otra de cierre. Al usuario solo debe llegarle la respuesta final, así que se
 * filtra ese bloque aunque llegue troceado entre chunks.
 */

type AiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>
}

const encoder = new TextEncoder()

function sseChunk(content: string): Uint8Array {
  return encoder.encode(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
  )
}

/**
 * Las etiquetas se construyen con `fromCharCode` a propósito: incrustar los
 * signos angulares literales en el archivo fuente confunde a algunos entornos,
 * que los interpretan como un bloque de razonamiento y los eliminan, dejando el
 * filtro sin efecto.
 */
const LT = String.fromCharCode(60)
const GT = String.fromCharCode(62)
const OPEN_TAGS = ['think', 'reasoning'].map((t) => `${LT}${t}${GT}`)
const CLOSE_TAGS = ['/think', '/reasoning'].map((t) => `${LT}${t}${GT}`)
const MAX_TAG = Math.max(...[...OPEN_TAGS, ...CLOSE_TAGS].map((t) => t.length))

/**
 * Descarta el bloque de razonamiento de un stream de texto. Mantiene un buffer
 * para detectar etiquetas partidas entre chunks y solo emite el texto visible.
 */
class ThinkFilter {
  private pending = ''
  private inThink = false
  private started = false

  constructor(private readonly emit: (text: string) => void) {}

  push(text: string) {
    this.pending += text
    this.process(false)
  }

  end() {
    this.process(true)
  }

  private indexOfAny(tags: string[]): number {
    let best = -1
    for (const tag of tags) {
      const i = this.pending.indexOf(tag)
      if (i >= 0 && (best < 0 || i < best)) best = i
    }
    return best
  }

  private flushVisible(text: string) {
    if (!text) return
    if (!this.started) {
      text = text.replace(/^\s+/, '')
      if (!text) return
      this.started = true
    }
    this.emit(text)
  }

  private process(end: boolean) {
    for (;;) {
      if (this.inThink) {
        const idx = this.indexOfAny(CLOSE_TAGS)
        if (idx < 0) {
          if (end) {
            this.pending = ''
            return
          }
          // Conserva solo la cola que podría ser una etiqueta de cierre parcial.
          this.pending = this.pending.slice(-(MAX_TAG - 1))
          return
        }
        const tag = CLOSE_TAGS.find((t) => this.pending.startsWith(t, idx))!
        this.pending = this.pending.slice(idx + tag.length)
        this.inThink = false
        continue
      }

      const idx = this.indexOfAny(OPEN_TAGS)
      if (idx < 0) {
        if (end) {
          this.flushVisible(this.pending)
          this.pending = ''
          return
        }
        if (this.pending.length <= MAX_TAG - 1) return
        this.flushVisible(this.pending.slice(0, this.pending.length - (MAX_TAG - 1)))
        this.pending = this.pending.slice(-(MAX_TAG - 1))
        return
      }

      const tag = OPEN_TAGS.find((t) => this.pending.startsWith(t, idx))!
      this.flushVisible(this.pending.slice(0, idx))
      this.pending = this.pending.slice(idx + tag.length)
      this.inThink = true
    }
  }
}

export function normalizeToOpenAiSse(raw: unknown): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const source = raw as ReadableStream<Uint8Array>

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader()
      const filter = new ThinkFilter((text) => controller.enqueue(sseChunk(text)))
      let buffer = ''

      const handleLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) return
        if (/^(event|id|retry):/.test(trimmed)) return
        let payload = trimmed
        if (trimmed.startsWith('data:')) payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') return
        try {
          const parsed = JSON.parse(payload)
          // Workers AI -> { response }; OpenAI -> { choices[..].delta.content }
          const cf = typeof parsed.response === 'string' ? parsed.response : ''
          const oa = parsed.choices?.[0]?.delta?.content
          const text = cf || (typeof oa === 'string' ? oa : '')
          if (text) filter.push(text)
        } catch {
          // No era JSON: texto plano emitido tal cual (algunos modelos no usan SSE).
          filter.push(payload)
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) handleLine(line)
        }
        if (buffer) handleLine(buffer)
        filter.end()
      } catch (err) {
        console.error('Workers AI stream error:', err)
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
}

/**
 * Lanza un chat por Workers AI y devuelve un stream ya normalizado a SSE de
 * OpenAI, listo para el mismo drenado que usa Groq.
 */
export async function workersAiChatStream(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number,
): Promise<ReadableStream<Uint8Array>> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const ctx = await getCloudflareContext({ async: true })
  const ai = (ctx.env as { AI?: AiBinding }).AI
  if (!ai) throw new Error('binding AI no disponible')

  const raw = await ai.run(model, {
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
  })
  return normalizeToOpenAiSse(raw)
}
