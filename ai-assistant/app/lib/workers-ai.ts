/**
 * Puente entre el binding `AI` de Cloudflare Workers AI y el resto de ARIA.
 *
 * El binding devuelve SSE con su propio formato (`{ response: "..." }`),
 * mientras que la ruta de chat ya sabe parsear SSE estilo OpenAI
 * (`{ choices: [{ delta: { content } }] }`). En vez de bifurcar el parser, aquí
 * se normaliza el stream a formato OpenAI para reutilizar el mismo camino que
 * Groq. Se usa el binding (no el endpoint REST) porque no exige ningún token
 * extra: el `AI` ya está configurado en `wrangler.jsonc`.
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

export function normalizeToOpenAiSse(raw: unknown): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const source = raw as ReadableStream<Uint8Array>

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader()
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
          if (text) controller.enqueue(sseChunk(text))
        } catch {
          // No era JSON: texto plano emitido tal cual (algunos modelos no usan SSE).
          controller.enqueue(sseChunk(payload))
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
