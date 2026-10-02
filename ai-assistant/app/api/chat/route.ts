import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { callGroqWithTools, groqFetch } from '@/app/lib/tools'
import { providerForModel, isWorkersAiModel, GROQ, type Provider } from '@/app/lib/providers'
import { workersAiChatStream } from '@/app/lib/workers-ai'
import { requireAuth } from '@/app/lib/auth'
import { rateLimit } from '@/app/lib/rate-limit'
import { registerBackground } from '@/app/lib/background'
import {
  MODEL_CONFIG,
  MAX_VISIBLE_MESSAGES,
  CHEAP_MODEL,
  DEFAULT_MODEL,
  wantsWebSearch,
  generateSummary,
  buildAriaContext,
  rememberTurn,
} from '@/app/lib/aria-core'

/**
 * Traduce un error de Groq a algo que el usuario pueda entender.
 *
 * Antes devolvia el JSON crudo de Groq con su status. Medido en produccion: al
 * agotarse la cuota diaria devolvia HTTP 500 con el `error_id` de Groq dentro, que
 * es un problema doble:
 *
 *   - El status era incorrecto. Un rate limit es 429, no un fallo del servidor. Con
 *     500 el cliente lo trata como error irrecuperable y no reintenta, cuando lo
 *     correcto es esperar y volver a intentarlo.
 *   - El mensaje era inaccionable. Decir "Rate limit reached for model
 *     openai/gpt-oss-120b ... Limit 200000, Used 198478" no le dice al usuario nada
 *     de lo que pueda hacer, y encima filtra nombres de modelo y de organizacion.
 *
 * Los dos limites del free tier que se toparon en produccion, ambos reales:
 *   - 8.000 TPM (por minuto)
 *   - 200.000 TPD (por dia), que es el que mas duele: se agota en unas horas de uso
 *     real y no se recupera hasta el dia siguiente.
 */
function groqErrorResponse(status: number, errText: string, provider: Provider = GROQ): Response {
  // Workers AI (DeepSeek gratis) no comparte los códigos de Groq: el fallo más
  // común es quedarse sin las 10.000 neuronas/día del plan Free.
  if (provider.id === 'workers-ai') {
    const neurons = /neuron/i.test(errText)
    console.error(`Workers AI ${status}: ${errText.slice(0, 400)}`)
    return Response.json(
      {
        error: neurons
          ? 'Se agotó la cuota diaria gratuita de Workers AI (10.000 neuronas/día). Se recupera a medianoche UTC; mientras tanto prueba con un modelo de Groq.'
          : 'DeepSeek (Workers AI) no pudo responder ahora mismo. Prueba de nuevo o cambia a un modelo de Groq.',
        code: neurons ? 'quota_daily' : 'upstream_error',
      },
      { status: neurons ? 429 : 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const isRateLimit = status === 429 || /rate limit|rate_limit_exceeded/i.test(errText)

  if (isRateLimit) {
    const perDay = /tokens per day|TPD/i.test(errText)
    // Groq incluye "Please try again in Xs" cuando sabe cuanto hay que esperar.
    const wait = errText.match(/try again in ([\d.]+)\s*m?([smh])?/i)
    let espera = ''
    if (wait) {
      const n = Number(wait[1])
      const unit = wait[2]?.toLowerCase() ?? 's'
      if (Number.isFinite(n)) {
        const mins = unit === 'm' ? n : unit === 'h' ? n * 60 : n / 60
        espera = ` Groq indica esperar unos ${mins < 1 ? Math.ceil(n) + ' s' : Math.ceil(mins) + ' min'}.`
      }
    }

    return Response.json(
      {
        error: perDay
          ? 'Se agoto la cuota diaria de ARIA (limite gratuito de Groq: 200.000 tokens al dia).' +
              espera +
              ' Se recupera a medianoche. Mientras tanto no puedo responder.'
          : 'Se alcanzo el limite de peticiones de ARIA por minuto. Vuelve a intentarlo en un momento.',
        code: perDay ? 'quota_daily' : 'rate_limit',
      },
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }

  console.error(`Groq ${status}: ${errText.slice(0, 400)}`)
  return Response.json(
    { error: 'ARIA no pudo completar la peticion. Intentalo de nuevo en un momento.', code: 'upstream_error' },
    { status: 502, headers: { 'Content-Type': 'application/json' } },
  )
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const limited = await rateLimit(req, 'CHAT_RATE_LIMITER')
  if (limited) return limited

  try {
    const body = await req.json()
    const { messages, model = DEFAULT_MODEL, conversationId } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const provider = providerForModel(model)
    // Clave del proveedor que responde el chat. Workers AI va por binding (sin clave).
    const apiKey = (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : '') ?? ''
    if (provider.apiKeyEnv && !apiKey) {
      return new Response(JSON.stringify({ error: `${provider.apiKeyEnv} no configurada` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Groq sigue siendo el cerebro auxiliar (extracción de memoria y resumen).
    // Si no está configurado, esas tareas best-effort simplemente se saltan.
    const groqKey = process.env.GROQ_API_KEY

    // Contexto compartido (resumen + memoria del usuario + memoria de trabajo).
    // Es el mismo cerebro que usan WhatsApp y el correo.
    const { allMessages, contextMessages, injectedMemoryIds, summary, lastUserMsg } =
      await buildAriaContext(messages, conversationId)

    const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

    // Extracción de memoria del turno en segundo plano (no bloquea la respuesta).
    // `registerBackground` lo registra con ctx.waitUntil() para que workerd no lo
    // cancele al terminar el request (lo que además corrompería el cliente Prisma).
    if (groqKey && lastUserMsg?.content) {
      await registerBackground(rememberTurn(groqKey, lastUserMsg.content, conversationId))
    }

    // Mantenimiento perezoso: una fracción de los turnos revisa si toca
    // consolidar. El propio guard evita repetirlo más de una vez al día.
    if (Math.random() < 0.05) {
      const { maybeConsolidate } = await import('@/app/lib/memory')
      await registerBackground(maybeConsolidate())
    }

    // If messages were truncated but no summary exists yet, generate one
    if (groqKey && messages.length > MAX_VISIBLE_MESSAGES && !summary) {
      const oldMessages = messages.slice(0, -MAX_VISIBLE_MESSAGES)
      const newSummary = await generateSummary(groqKey, oldMessages)
      if (newSummary && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { summary: newSummary },
        }).catch(() => {})
      }
    }

    // Refuerza de fondo los recuerdos que acaban de usarse para responder, para
    // que el olvido por antigüedad no se lleve lo que sí resulta útil.
    if (injectedMemoryIds.length > 0) {
      const { reinforceMemories } = await import('@/app/lib/memory')
      await registerBackground(reinforceMemories(injectedMemoryIds))
    }

    // Check if we should use tool calling (skip for simple/fast models to save latency)
    // Workers AI (DeepSeek) es de razonamiento y no soporta tools: va por simple mode.
    const useTools = provider.supportsTools && model !== CHEAP_MODEL

    if (useTools) {
      try {
        const forceSearch = wantsWebSearch(contextMessages)
        if (forceSearch) {
          console.log('Busqueda web forzada: el usuario la pide explicitamente')
        }
        const { stream, toolCalls, hitRoundLimit } = await callGroqWithTools(
          apiKey,
          allMessages,
          model,
          config.max_tokens,
          config.temperature,
          forceSearch,
          undefined,
          provider,
        )

        const encoder = new TextEncoder()
        const readable = new ReadableStream({
          async start(controller) {
            let emitted = 0
            let reasoningChars = 0
            let finishReason: string | null = null

            const emit = (content: string) => {
              emitted++
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
            }

            try {
              // Emit tool-call events first so the UI can render them
              for (const tc of toolCalls) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'tool_call', tool: { name: tc.name, args: tc.args, result: tc.result, status: tc.status } })}\n\n`
                  )
                )
              }

              const reader = stream.getReader()
              const decoder = new TextDecoder()
              let buffer = ''

              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6)
                    if (data === '[DONE]') continue
                    try {
                      const parsed = JSON.parse(data)
                      const delta = parsed.choices?.[0]?.delta ?? {}
                      if (typeof delta.reasoning === 'string') {
                        reasoningChars += delta.reasoning.length
                      }
                      const fr = parsed.choices?.[0]?.finish_reason
                      if (fr) finishReason = fr
                      const content = delta.content || ''
                      if (content) emit(content)
                    } catch { /* skip parse errors */ }
                  }
                }
              }

              // Ultimo recurso: el modelo consumio las rondas de herramientas y
              // cerro el stream solo con `reasoning` (sin una sola palabra de
              // respuesta). Se le repregunta con los resultados ya reunidos.
              //
              // Los resultados van como un unico mensaje `user`, no como mensajes
              // `role: 'tool'`: reutilizarlos exigiria reconstruir tambien los
              // `tool_call_id` delHistorial y un `tool` sin id hace que Groq
              // rechace el request entero ("'messages.2' : for 'role:tool' the
              // following must be satisfied"), dejando al usuario sin respuesta.
              if (emitted === 0) {
                console.warn(
                  `Stream post-herramientas vacio (${reasoningChars} chars de reasoning, ` +
                  `finish_reason=${finishReason}, tools=${toolCalls.length}` +
                  `${hitRoundLimit ? ', limite de rondas alcanzado' : ''}), reintentando`
                )
                const digest = toolCalls
                  .map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)}): ${tc.result}`)
                  .join('\n')
                const NO_MORE_TOOLS =
                  'AVISO: las herramientas ya se usaron y no hay mas resultados. ' +
                  'Responde ahora al usuario en texto plano, sin pedir herramientas.\n\n' +
                  `Resultados obtenidos:\n${digest}`
                const retry = await groqFetch(apiKey, {
                  model,
                  messages: [...allMessages, { role: 'user', content: NO_MORE_TOOLS }],
                  stream: true,
                  max_tokens: config.max_tokens,
                  temperature: config.temperature,
                })

                if (retry.ok) {
                  const reader2 = retry.body!.getReader()
                  const decoder2 = new TextDecoder()
                  let buffer2 = ''
                  while (true) {
                    const { done: d2, value: v2 } = await reader2.read()
                    if (d2) break
                    buffer2 += decoder2.decode(v2, { stream: true })
                    const lines2 = buffer2.split('\n')
                    buffer2 = lines2.pop() || ''
                    for (const line2 of lines2) {
                      if (!line2.startsWith('data: ')) continue
                      const d2text = line2.slice(6)
                      if (d2text === '[DONE]') continue
                      try {
                        const p2 = JSON.parse(d2text)
                        const c2 = p2.choices?.[0]?.delta?.content || ''
                        if (c2) emit(c2)
                      } catch { /* skip */ }
                    }
                  }
                } else {
                  await retry.text().catch(() => '')
                  emit('\n\n_No pude generar una respuesta en este intento. Reintenta._')
                }
              }
            } catch (err) {
              console.error('Stream error:', err)
            } finally {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            }
          },
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        })
      } catch (err) {
        /**
         * Un rate limit no se arregla cayendo a simple mode.
         *
         * El fallback existe para cuando el tool-calling falla pero una peticion
         * simple si puede salir. Con la cuota agotada no es el caso: simple mode
         * haria exactamente la misma llamada y receberia el mismo 429. Medido: la
         * respuesta tardaba 62 s en devolver el error, porque cada uno de los dos
         * caminos iba hacia 3 reintentos con backoff contra un limite que no se iba
         * a recuperar.
         *
         * Ademas, el usuario recibia el error sin ninguna informacion util, porque
         * el mensaje de Groq se perdia en el `console.error`. Ahora se responde de
         * inmediato con el motivo y cuando se recupera.
         */
        const detail = String(err instanceof Error ? err.message : err)
        if (/rate limit|rate_limit_exceeded|429/i.test(detail)) {
          console.error('Rate limit durante tool calling:', detail.slice(0, 300))
          const perDay = /tokens per day|TPD/i.test(detail)
          return Response.json(
            {
              error: perDay
                ? 'Se agoto la cuota diaria de ARIA (limite gratuito de Groq: 200.000 tokens al dia). Se recupera a medianoche.'
                : 'Se alcanzo el limite de peticiones de ARIA por minuto. Intentalo en unos segundos.',
              code: perDay ? 'quota_daily' : 'rate_limit',
            },
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          )
        }
        console.error('Tool calling error, falling back to simple mode:', err)
        // Fall through to simple mode below
      }
    }

    // Simple mode (no tools or fallback from tool error).
    //
    // `gpt-oss-*` razona en el canal `reasoning` del stream. Cuando decide que
    // necesita una herramienta pero este modo no se la ofrece, se queda solo con
    // el razonamiento y devuelve content vacio -> el usuario ve un stream sin
    // texto. Por eso, si no llega nada de contenido, se reintentaIndicandole que
    // las herramientas no estan disponibles y que responda con lo que sepa.
    const streamSimple = async (messages: typeof allMessages): Promise<Response> => {
      // DeepSeek gratis (Workers AI) va por el binding, no por fetch. El stream
      // ya viene normalizado a SSE estilo OpenAI, así el drenado de abajo no cambia.
      if (isWorkersAiModel(model)) {
        try {
          const stream = await workersAiChatStream(
            model,
            messages,
            config.max_tokens,
            config.temperature,
          )
          return new Response(stream, { status: 200 })
        } catch (err) {
          const detail = String(err instanceof Error ? err.message : err)
          console.error('Workers AI error:', detail)
          return Response.json({ error: detail }, { status: 502 })
        }
      }
      return groqFetch(apiKey, {
        model,
        messages,
        stream: true,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      }, 3, provider)
    }

    const NO_TOOLS_NOTICE =
      'AVISO: en esta respuesta no tenes herramientas disponibles. ' +
      'No intentes usarlas ni las menciones. Responde directamente con lo que ' +
      'sepas, y si la pregunta requiere informacion actual que no tenes, ' +
      'dilo con claridad en vez de quedarte en silencio.'

    const groqRes = await streamSimple(allMessages)

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      return groqErrorResponse(groqRes.status, errText, provider)
    }

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        let emitted = 0
        let reasoningChars = 0

        const drain = async (res: Response): Promise<number> => {
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

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
                const delta = parsed.choices?.[0]?.delta ?? {}
                if (typeof delta.reasoning === 'string') {
                  reasoningChars += delta.reasoning.length
                }
                const content = delta.content || ''
                if (content) {
                  emitted++
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                  )
                }
              } catch { /* skip parse errors */ }
            }
          }
          return emitted
        }

        try {
          emitted = await drain(groqRes)

          // Content vacio tras razonar: unico reintento con el aviso explicito.
          if (emitted === 0) {
            console.warn(
              `Simple mode devolvio solo reasoning (${reasoningChars} chars) sin content, reintentando sin tools`
            )
            const retry = await streamSimple([
              ...allMessages,
              { role: 'system', content: NO_TOOLS_NOTICE },
            ])
            if (retry.ok) {
              await drain(retry)
            } else {
              console.error(`Reintento simple mode fallo: ${retry.status}`)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    content:
                      '\n\n_No pude generar una respuesta en este intento. Reintenta._',
                  })}\n\n`
                )
              )
            }
          }
        } catch (err) {
          console.error('Stream error:', err)
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
