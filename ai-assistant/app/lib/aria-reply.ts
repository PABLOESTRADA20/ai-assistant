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
  CHEAP_MODEL,
  MODEL_CONFIG,
  type ChatMessage,
} from '@/app/lib/aria-core'
import {
  providerForModel,
  groqChatModels,
  WORKERS_AI,
  RESERVE_MODEL,
  type Provider,
} from '@/app/lib/providers'
import {
  chargeFallback,
  fallbackBudgetLeft,
  firstAvailableGroqModel,
  modelQuotaUntil,
} from '@/app/lib/quota'
import { workersAiChatStream } from '@/app/lib/workers-ai'

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

  // --- Modo reserva (el mismo del chat web, pero sin chain del cliente) -----
  // WhatsApp no tiene el auto-cambio de modelo de la web, así que acá se
  // resuelve la cuota una sola vez: si el modelo pedido está agotado se pasa a
  // otro de Groq con cuota; si no queda ninguno, a Workers AI (DeepSeek, sin
  // herramientas) en este mismo turno.
  let current = model
  let provider: Provider = providerForModel(current)
  let reserveMode = false
  if (provider.id === 'groq') {
    const until = await modelQuotaUntil(current)
    if (until) {
      const alt = await firstAvailableGroqModel(groqChatModels())
      if (alt) {
        console.warn(`[aria-reply] ${current} sin cuota; respondo con ${alt}`)
        current = alt
      } else if (await fallbackBudgetLeft()) {
        console.warn('[aria-reply] Groq completo: modo reserva con Workers AI')
        current = RESERVE_MODEL
        provider = WORKERS_AI
        reserveMode = true
      } else {
        return {
          text: '',
          toolCalls: [],
          error:
            'Se agotó la cuota diaria de Groq y la reserva de Workers AI. Se recupera a medianoche UTC.',
        }
      }
    }
  }

  const config = MODEL_CONFIG[current] || { max_tokens: 8192, temperature: 0.6 }
  const { allMessages, injectedMemoryIds, lastUserMsg } = await buildAriaContext(
    messages,
    conversationId,
  )

  // Memoria del turno y refuerzo, igual que en el chat web. Solo si el modelo
  // auxiliar de Groq (gpt-oss-20b) tiene cuota: en reserva recibiría 429s.
  const { registerBackground } = await import('@/app/lib/background')
  const groqQuotaLeft = Boolean(apiKey) && !(await modelQuotaUntil(CHEAP_MODEL))
  if (groqQuotaLeft && lastUserMsg?.content) {
    await registerBackground(rememberTurn(apiKey, lastUserMsg.content, conversationId))
  }
  if (injectedMemoryIds.length > 0) {
    const { reinforceMemories } = await import('@/app/lib/memory')
    await registerBackground(reinforceMemories(injectedMemoryIds))
  }

  // Reserva: DeepSeek (Workers AI) va por stream directo y sin herramientas.
  if (reserveMode) {
    const NO_TOOLS_NOTICE =
      'AVISO: en esta respuesta no tenes herramientas disponibles y estás en ' +
      'modo reserva porque Groq se quedó sin cuota diaria. Responde con lo que ' +
      'sepas; si la pregunta requiere información actual, dilo con claridad.'
    try {
      const withNotice = allMessages.some((m) => m.content === NO_TOOLS_NOTICE)
        ? allMessages
        : [...allMessages, { role: 'system' as const, content: NO_TOOLS_NOTICE }]
      const stream = await workersAiChatStream(
        current,
        withNotice,
        config.max_tokens,
        config.temperature,
      )
      const text = await drainToText(stream)
      // Contabilizar el turno en el presupuesto de la reserva.
      await chargeFallback(JSON.stringify(allMessages).length, text.length)
      return { text, toolCalls: [] }
    } catch (err) {
      return { text: '', toolCalls: [], error: String(err) }
    }
  }

  try {
    const { stream, toolCalls } = await callGroqWithTools(
      apiKey,
      allMessages,
      current,
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
        model: current,
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
        model: current,
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
