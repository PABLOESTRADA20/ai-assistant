import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { callGroqWithTools, groqFetch } from '@/app/lib/tools'
import {
  providerForModel,
  isWorkersAiModel,
  groqChatModels,
  GROQ,
  WORKERS_AI,
  RESERVE_MODEL,
  type Provider,
} from '@/app/lib/providers'
import {
  chargeFallback,
  fallbackBudgetLeft,
  firstAvailableGroqModel,
  latestGroqQuotaUntil,
  modelQuotaUntil,
  nextMidnightUtc,
} from '@/app/lib/quota'
import { workersAiChatStream } from '@/app/lib/workers-ai'
import { requireAuth } from '@/app/lib/auth'
import { getRepos } from '@/app/lib/github'
import { rateLimit } from '@/app/lib/rate-limit'
import { registerBackground } from '@/app/lib/background'
import { toSourceRefs } from '@/app/lib/sources'
import {
  MODEL_CONFIG,
  CHEAP_MODEL,
  DEFAULT_MODEL,
  wantsWebSearch,
  selectTools,
  compactConversation,
  buildAriaContext,
  rememberTurn,
  type ChatMessage,
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
 *
 * Cuando `code` es `quota_daily` se agrega `until` (ISO): es lo que el cliente
 * usa para mostrar la cuenta regresiva del banner de cuota.
 */
async function groqErrorResponse(status: number, errText: string, provider: Provider = GROQ): Promise<Response> {
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
        ...(neurons ? { until: nextMidnightUtc().toISOString() } : {}),
      },
      { status: neurons ? 429 : 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Proveedores con free tier (Gemini, Mistral, OpenRouter, Z AI):
  // no comparten los codigos de Groq, asi que se responde generico con su nombre.
  if (provider.id !== 'groq') {
    const rateLimited = status === 429 || /rate limit|quota|exceeded|too many|limit/i.test(errText)
    console.error(`${provider.label} ${status}: ${errText.slice(0, 400)}`)
    return Response.json(
      {
        error: rateLimited
          ? `${provider.label} alcanzo su limite gratuito. Proba con otro modelo mientras se recupera.`
          : `${provider.label} no pudo responder ahora mismo. Proba de nuevo o cambia de modelo.`,
        code: rateLimited ? 'quota_daily' : 'upstream_error',
      },
      { status: rateLimited ? 429 : 502, headers: { 'Content-Type': 'application/json' } },
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
              ' Se recupera a medianoche. Mientras tanto sigo respondiendo en modo reserva.'
          : 'Se alcanzo el limite de peticiones de ARIA por minuto. Vuelve a intentarlo en un momento.',
        code: perDay ? 'quota_daily' : 'rate_limit',
        ...(perDay
          ? { until: (await latestGroqQuotaUntil()) ?? nextMidnightUtc().toISOString() }
          : {}),
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

  // Proveedor del modelo pedido. Se inicializa a Groq para que el catch exterior
  // pueda traducir errores de cuota aunque el body falle antes de resolverse.
  let provider: Provider = GROQ

  try {
    const body = await req.json()
    let { messages, model = DEFAULT_MODEL, conversationId } = body
    const requestedModel = model

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    provider = providerForModel(model)

    const rawLastUser =
      [...messages].reverse().find((m: ChatMessage) => m?.role === 'user') ?? null

    // ¿Hay repos de GitHub configurados? Solo decide si ofrecer las `github_*`
    // (sin repos no tienen a qué apuntar por defecto). Es una lectura por clave
    // primaria, barata frente a los tokens que ahorra.
    const hasRepos = await getRepos()
      .then((repos) => repos.length > 0)
      .catch(() => false)

    // Herramientas que se ofrecen ESTE turno, decididas con palabras clave
    // locales (app/lib/aria-core.ts). En charla normal la lista es vacía: no se
    // manda ningún schema y no se gasta ese contexto del free tier. Se decide por
    // el mensaje del usuario, no por lo que crea el modelo, y aplica a TODOS los
    // modelos (no solo al barato). Sirve además para que un modelo sin function
    // calling (DeepSeek/Workers AI) se cambie a Groq cuando el pedido las pide.
    const selectedTools = selectTools(rawLastUser, hasRepos)
    const requestNeedsTools = selectedTools.length > 0

    // --- Modo reserva: la cuota diaria de Groq ya está marcada -------------
    //
    // Se resuelve ANTES de tocar Groq. En vez de gastar un request para recibir
    // el mismo 429 (y encadenar 4 intentos como antes), la ruta responde de una
    // vez con el primer modelo de Groq que sí tenga cuota, o —si no queda
    // ninguno— con Workers AI (DeepSeek, gratis) en ESTE mismo request. El
    // cliente se entera por el evento `model_switch` con `reason: 'quota'`,
    // que además trae `until` para el banner con cuenta regresiva.
    let switchedForQuota = false
    let reserveMode = false
    let quotaUntil: string | null = null
    if (provider.id === 'groq') {
      quotaUntil = await modelQuotaUntil(model)
      if (quotaUntil) {
        const available = await firstAvailableGroqModel(groqChatModels())
        if (available) {
          console.warn(`[chat] ${model} sin cuota diaria; respondo con ${available}`)
          model = available
          provider = providerForModel(available)
          switchedForQuota = true
        } else if (await fallbackBudgetLeft()) {
          console.warn('[chat] Groq completo: modo reserva con Workers AI (DeepSeek)')
          model = RESERVE_MODEL
          provider = WORKERS_AI
          reserveMode = true
          switchedForQuota = true
        } else {
          // Sin Groq y sin reserva para hoy: se contesta con la cuenta regresiva.
          return Response.json(
            {
              error:
                'Se agotó la cuota diaria de Groq y la reserva gratuita de Workers AI. Se recupera a medianoche UTC.',
              code: 'quota_daily',
              until: quotaUntil,
            },
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }
    }

    let switchedForTools = false
    if (!provider.supportsTools && requestNeedsTools && !reserveMode) {
      // Si el modelo barato de Groq está sin cuota, cambiar a él solo para
      // recibir el mismo 429 no ayuda: se responde sin herramientas y el
      // NO_TOOLS_NOTICE le pide al modelo que lo diga con claridad.
      const cheapAvailable = !(await modelQuotaUntil(CHEAP_MODEL))
      if (cheapAvailable) {
        console.warn(`[chat] ${model} no soporta herramientas; se responde con ${CHEAP_MODEL}`)
        switchedForTools = true
        model = CHEAP_MODEL
        provider = GROQ
      } else {
        console.warn('[chat] pedido con herramientas pero Groq sin cuota: se responde sin tools')
      }
    }

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
    const { allMessages, contextMessages, injectedMemoryIds, brainHits, summary, summarizedCount, lastUserMsg } =
      await buildAriaContext(messages, conversationId)

    const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

    // ¿Tiene cuota el modelo de las tareas de fondo? Extracción de memoria y
    // resumen van contra `openai/gpt-oss-20b` aunque el chat esté en reserva;
    // con ese modelo sin cuota solo recibirían 429s. (La consolidación es solo
    // SQL: esa no se salta.)
    const groqQuotaLeft = Boolean(groqKey) && !(await modelQuotaUntil(CHEAP_MODEL))

    // Extracción de memoria del turno en segundo plano (no bloquea la respuesta).
    // `registerBackground` lo registra con ctx.waitUntil() para que workerd no lo
    // cancele al terminar el request (lo que además corrompería el cliente Prisma).
    if (groqKey && groqQuotaLeft && lastUserMsg?.content) {
      await registerBackground(rememberTurn(groqKey, lastUserMsg.content, conversationId))
    }

    // Mantenimiento perezoso: una fracción de los turnos revisa si toca
    // consolidar. El propio guard evita repetirlo más de una vez al día.
    if (Math.random() < 0.05) {
      const { maybeConsolidate } = await import('@/app/lib/memory')
      await registerBackground(maybeConsolidate())
    }

    // Compactación incremental: pliega SOLO los mensajes antiguos que aún no
    // estaban cubiertos por el resumen y lo actualiza, en vez de resumir todo
    // una sola vez (que dejaba el resumen obsoleto y gastaba un prompt enorme).
    // Con el modelo barato sin cuota se salta: recibiría un 429.
    if (groqKey && groqQuotaLeft && conversationId) {
      const compacted = await compactConversation(
        groqKey,
        messages,
        summary,
        summarizedCount,
      )
      if (compacted) {
        // SQL crudo por el mismo motivo: el cliente WASM no conoce summarizedCount.
        await prisma
          .$executeRaw`
            UPDATE "Conversation"
            SET "summary" = ${compacted.summary},
                "summarizedCount" = ${compacted.summarizedCount},
                "updatedAt" = NOW()
            WHERE "id" = ${conversationId}
          `
          .catch(() => {})
      }
    }

    // Refuerza de fondo los recuerdos que acaban de usarse para responder, para
    // que el olvido por antigüedad no se lleve lo que sí resulta útil.
    if (injectedMemoryIds.length > 0) {
      const { reinforceMemories } = await import('@/app/lib/memory')
      await registerBackground(reinforceMemories(injectedMemoryIds))
    }

    // Tool calling solo si el turno trae alguna herramienta seleccionada, para
    // TODOS los modelos: la charla normal ya no paga el contexto de ~18 schemas.
    // Workers AI (DeepSeek) es de razonamiento y no soporta tools: va por simple mode.
    const useTools = provider.supportsTools && requestNeedsTools

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
          selectedTools,
          provider,
        )

        const encoder = new TextEncoder()
        const readable = new ReadableStream({
          async start(controller) {
            let emitted = 0
            let reasoningChars = 0
            let finishReason: string | null = null

            // Aviso de auto-cambio: cuota agotada (modo reserva) u herramientas
            // (DeepSeek -> Groq). `until` permite al cliente mostrar la cuenta
            // regresiva de la cuota.
            if (switchedForTools || switchedForQuota) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'model_switch',
                    from: requestedModel,
                    to: model,
                    reason: switchedForQuota ? 'quota' : 'no_tools',
                    ...(quotaUntil ? { until: quotaUntil } : {}),
                  })}\n\n`,
                ),
              )
            }

            // Chips de fuentes: qué recuerdos/notas del cerebro entraron al
            // contexto de esta respuesta. Fuera de `emit` para no sumar al
            // contador de contenido (mismo camino que los eventos tool_call).
            if (brainHits.length > 0) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'sources', sources: toSourceRefs(brainHits) })}\n\n`,
                ),
              )
            }

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
              ...(perDay ? { until: (await modelQuotaUntil(model)) ?? nextMidnightUtc().toISOString() } : {}),
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
    // Aviso para modelos sin herramientas (DeepSeek/Workers AI): el SYSTEM_PROMPT
    // lista tools que en este modo no existen, así que se lo decimos explícitamente.
    const NO_TOOLS_NOTICE =
      'AVISO: en esta respuesta no tenes herramientas disponibles. ' +
      'No intentes usarlas ni las menciones. Responde directamente con lo que ' +
      'sepas, y si la pregunta requiere informacion actual que no tenes, ' +
      'dilo con claridad en vez de quedarte en silencio.'

    const streamSimple = async (messages: typeof allMessages): Promise<Response> => {
      // DeepSeek gratis (Workers AI) va por el binding, no por fetch. El stream
      // ya viene normalizado a SSE estilo OpenAI, así el drenado de abajo no cambia.
      if (isWorkersAiModel(model)) {
        // Tope de seguridad del modo reserva: si ya se gastaron las neuronas
        // del día, no se llama ni al binding (evita facturar en cuentas Paid
        // y el error crudo del proveedor en las Free).
        if (!(await fallbackBudgetLeft())) {
          return Response.json(
            {
              error:
                'Se agotó la reserva diaria gratuita de Workers AI. Se recupera a medianoche UTC; mientras tanto prueba con un modelo de Groq.',
              code: 'quota_daily',
              until: nextMidnightUtc().toISOString(),
            },
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const notices: string[] = [NO_TOOLS_NOTICE]
        if (reserveMode) {
          notices.push(
            'AVISO 2: estás respondiendo en MODO RESERVA porque Groq se quedó ' +
              'sin cuota diaria. No hay herramientas disponibles en este modo. ' +
              'Si la pregunta requiere buscar en internet, leer notas o abrir ' +
              'algo, dilo con claridad en vez de inventar que lo hiciste.',
          )
        }
        const withNotice = notices.every((n) => messages.some((m) => m.content === n))
          ? messages
          : [...messages, ...notices.map((n) => ({ role: 'system' as const, content: n }))]
        try {
          const stream = await workersAiChatStream(
            model,
            withNotice,
            config.max_tokens,
            config.temperature,
          )
          return new Response(stream, { status: 200 })
        } catch (err) {
          const detail = String(err instanceof Error ? err.message : err)
          console.error('Workers AI error:', detail)
          return groqErrorResponse(502, detail, WORKERS_AI)
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

    const groqRes = await streamSimple(allMessages)

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      return groqErrorResponse(groqRes.status, errText, provider)
    }

    const encoder = new TextEncoder()
    // Neuronas consumidas por el turno de reserva: se cobran al terminar, con
    // los caracteres realmente emitidos (ver app/lib/quota.ts).
    const reserveInputChars = isWorkersAiModel(model) ? JSON.stringify(allMessages).length : 0
    const readable = new ReadableStream({
      async start(controller) {
        let emitted = 0
        let contentChars = 0
        let reasoningChars = 0

        // Aviso de auto-cambio por cuota (modo reserva) o por herramientas.
        if (switchedForQuota || switchedForTools) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'model_switch',
                from: requestedModel,
                to: model,
                reason: switchedForQuota ? 'quota' : 'no_tools',
                ...(quotaUntil ? { until: quotaUntil } : {}),
              })}\n\n`,
            ),
          )
        }

        // Chips de fuentes (simple mode): mismas fuentes, mismo formato SSE.
        if (brainHits.length > 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'sources', sources: toSourceRefs(brainHits) })}\n\n`,
            ),
          )
        }

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
                  contentChars += content.length
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
          // Cierre del turno de reserva: se contabiliza lo emitido para que el
          // tope diario de neuronas refleje el uso real (o su cota superior).
          if (reserveInputChars > 0) {
            await chargeFallback(reserveInputChars, contentChars)
          }
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
    /**
     * Cuota agotada que se escapó del camino simple.
     *
     * `groqFetch` lanza (no devuelve respuesta) cuando detecta límite diario. En
     * el camino con herramientas eso ya se traduce a 429 más arriba, pero en el
     * camino simple el throw llegaba hasta aquí y salía como 500, con lo que el
     * cliente no podía hacer el auto-cambio de modelo. Se traduce a 429 con su
     * código para que el fallback funcione.
     */
    if (/rate limit|rate_limit_exceeded|tokens per day|TPD|free-models-per-day|neurons|quota/i.test(message)) {
      return groqErrorResponse(429, message, provider)
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
