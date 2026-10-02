/**
 * Respuesta de ARIA sin streaming, para canales de texto (WhatsApp, correo).
 *
 * El chat web necesita SSE porque el usuario ve la respuesta escribirse. WhatsApp
 * y el correo, en cambio, necesitan un único bloque de texto final. En vez de
 * duplicar la lógica del cerebro, esta función reutiliza `buildAriaContext` (el
 * mismo prompt + memoria que el chat) y `callGroqWithTools` (el mismo bucle de
 * herramientas), y se limita a drenar el stream a un string.
 */
import { callGroqWithTools, groqFetch, type ToolCallRecord } from '@/app/lib/tools'
import {
  buildAriaContext,
  rememberTurn,
  DEFAULT_MODEL,
  MODEL_CONFIG,
  type ChatMessage,
} from '@/app/lib/aria-core'

export interface TextReplyOptions {
  apiKey: string
  messages: ChatMessage[]
  model?: string
  conversationId?: string | null
  /** Herramientas permitidas en este canal. Sin especificar, todas. */
  allowedTools?: string[]
  forceSearch?: boolean
}

export interface TextReplyResult {
  text: string
  toolCalls: ToolCallRecord[]
  error?: string
}

async function drainToText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content || ''
        if (content) text += content
      } catch {
        /* fragmento malformado */
      }
    }
  }

  return text.trim()
}

export async function generateTextReply(opts: TextReplyOptions): Promise<TextReplyResult> {
  const { apiKey, messages, model = DEFAULT_MODEL, conversationId, allowedTools } = opts
  const { allMessages, injectedMemoryIds, lastUserMsg } = await buildAriaContext(
    messages,
    conversationId,
  )

  const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

  // Memoria del turno y refuerzo, igual que en el chat web.
  const { registerBackground } = await import('@/app/lib/background')
  if (lastUserMsg?.content) {
    await registerBackground(rememberTurn(apiKey, lastUserMsg.content, conversationId))
  }
  if (injectedMemoryIds.length > 0) {
    const { reinforceMemories } = await import('@/app/lib/memory')
    await registerBackground(reinforceMemories(injectedMemoryIds))
  }

  try {
    const { stream, toolCalls } = await callGroqWithTools(
      apiKey,
      allMessages,
      model,
      config.max_tokens,
      config.temperature,
      opts.forceSearch ?? false,
      allowedTools,
    )

    let text = await drainToText(stream)

    // Mismo problema medido en el chat web: el modelo consume las rondas de
    // herramientas y cierra el stream sin texto. Se le repregunta con lo reunido.
    if (!text && toolCalls.length > 0) {
      const digest = toolCalls
        .map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)}): ${tc.result}`)
        .join('\n')
      const retry = await groqFetch(apiKey, {
        model,
        messages: [
          ...allMessages,
          {
            role: 'user',
            content:
              'AVISO: las herramientas ya se usaron. No pidas mas. Responde ahora ' +
              `en texto plano al usuario con lo que tengas.\n\nResultados:\n${digest}`,
          },
        ],
        stream: true,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      })
      if (retry.ok && retry.body) text = await drainToText(retry.body)
    }

    return { text, toolCalls }
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err)
    // Un rate limit no se arregla reintentando sin herramientas.
    if (/rate limit|rate_limit_exceeded|429/i.test(detail)) {
      return { text: '', toolCalls: [], error: detail }
    }

    // Fallback sin herramientas (p. ej. el modelo no admite tool calling).
    try {
      const res = await groqFetch(apiKey, {
        model,
        messages: allMessages,
        stream: true,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      })
      if (!res.ok || !res.body) {
        return { text: '', toolCalls: [], error: `Groq ${res.status}` }
      }
      return { text: await drainToText(res.body), toolCalls: [] }
    } catch (err2) {
      return { text: '', toolCalls: [], error: String(err2) }
    }
  }
}
