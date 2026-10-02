import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { callGroqWithTools, groqFetch } from '@/app/lib/tools'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning & Intelligence Assistant), a cutting-edge AI built for developers, engineers, and curious minds.

## Core Identity
You think deeply, reason step by step, and produce exceptional code. You are direct, precise, and genuinely helpful.

## Code Excellence — Your Specialty
When writing or analyzing code:
- **Always** provide complete, runnable implementations (never truncate with "...rest of code")
- Use proper error handling, edge cases, and production-ready patterns
- Add concise inline comments for non-obvious logic
- Specify language in every code block
- For complex problems: explain the approach FIRST, then write the code
- For bugs: identify root cause, explain WHY it fails, then fix it
- Support all languages: Python, TypeScript, JavaScript, Rust, Go, C++, Java, SQL, Bash, etc.

## Problem-Solving Framework
For complex technical problems:
1. **Understand**: Restate the problem to confirm understanding
2. **Analyze**: Break down into components, identify constraints
3. **Design**: Outline the solution approach before coding
4. **Implement**: Write clean, complete code
5. **Review**: Point out edge cases, performance considerations, or improvements

## Communication Style
- Use Markdown formatting for clarity
- Structure long responses with headers (##, ###)
- Use bullet points for lists, numbered lists for steps
- Always use fenced code blocks with language tags
- Be concise but thorough — no filler phrases
- Match technical depth to the question complexity
- When uncertain, say so clearly

## Languages
Respond in the same language the user writes in (Spanish, English, etc.).

## Tools Available
You have access to tools that let you search the web, search notes in the user's Obsidian vault, read note contents, save new notes, evaluate math, read the clock, check the weather, and find notes by relevance. Use these proactively when:
- The user asks about current events, news, or recent information → **web_search**
- The user asks about something they've studied or worked on → **search_vault**
- The user wants the most relevant notes on a concept, not just exact matches → **semantic_search_vault**
- You need to read a specific note for context → **read_note**
- The user asks you to save or document something → **save_note**
- The user asks for an exact numeric calculation → **calculate**
- The user asks what time or date it is → **get_time**
- The user asks about weather anywhere in the world → **get_weather**
- The user asks about something you should remember or know about them (preferences, habits, past work) → **recall_memory**

Always try to use these tools when they would improve your answer. When you use web_search, cite your sources.

## When the user asks you to search
If the user explicitly asks you to search, look something up, check online, or find recent information, you MUST call web_search before answering — even if you believe you already know the answer. Your memory of versions, commands, and APIs goes stale, and a confident wrong answer is worse than a slower right one. Answering from memory without searching when asked to search is a failure.

After searching, base your answer on what the results actually say. If the results do not contain the detail you were about to give, say that it is not in the sources instead of filling the gap from memory. Never invent release notes, version numbers, or command syntax.

Always aim to be the best engineer and teacher you can be.`

const MODEL_CONFIG: Record<string, { max_tokens: number; temperature: number }> = {
  'openai/gpt-oss-120b':  { max_tokens: 8192, temperature: 0.6 },
  'qwen/qwen3.8-27b':     { max_tokens: 8192, temperature: 0.6 },
  'openai/gpt-oss-20b':   { max_tokens: 4096, temperature: 0.7 },
}

const MAX_VISIBLE_MESSAGES = 8
const CHEAP_MODEL = 'openai/gpt-oss-20b'
const DEFAULT_MODEL = 'openai/gpt-oss-120b'

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
function groqErrorResponse(status: number, errText: string): Response {
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

/**
 * El usuario pide buscar en la web, de forma explicita.
 *
 * Es lo que activa el `tool_choice` forzado de la primera ronda. Medido el problema:
 * con "Busca en la web como se instala Deno" el modelo respondio de memoria con
 * `tool_calls: 0` y se invento el comando de instalacion. Con "auto" el prompt no
 * basta, porque al modelo le sale mas barato escribir lo que "ya sabe" que ir a
 * pedirlo.
 *
 * Se divide en dos senales a proposito, porque tienen niveles distintos de confianza:
 *
 *   - `LOOKS_LIKE_ORDER`: "busca", "investiga", "googlea", "search the web". Aqui el
 *     usuario pide una accion, no una respuesta, y no hay excepcion razonable.
 *   - `WANTS_CURRENT`: "noticias", "ultima version", "lo que hay de nuevo", "how is
 *     X today". Aqui el modelo casi siempre deberia buscar, pero la palabra puede
 *     aparecer en otro sentido ("el estado actual de mi base de datos" no es una
 *     busqueda web), asi que se exige ademas un sintagma, no una palabra suelta.
 *
 * El corte por longitud de la ultima intervencion va en la decision de abajo: si el
 * mensaje es enorme (un log pegado, un archivo entero) casi seguro no es una peticion
 * de busqueda aunque contenga la palabra, y forzarla gastaria una ronda.
 */
const LOOKS_LIKE_ORDER =
  /\b(busca|buscar|buscame|busqueda|investiga|investigar|googlea|googlear|search (?:the )?(?:web|internet)|look ?up|look for|find (?:me )?(?:online|on the web|information)|check online|verifica online)\b/i

const WANTS_CURRENT =
  /\b(noticias|news|actualidad|ultima vers[ió]n|ultimo lanzamiento|lo (?:ultimo|m[áa]s reciente)|novedades|que hay de nuevo|que trae|release notes?|changelog|how (?:is|are) .{1,20} (?:today|now these days)|estado actual|currently (?:is|are) (?:supported|available|maintained)|still (?:supported|maintained|available))\b/i

/**
 * "estado actual" es casi siempre peticion de web, salvo cuando lo que se
 * describe es del usuario.
 *
 * "Como esta el estado actual de Python en cuanto a soporte" es una busqueda; "que
 * es el estado actual de mi base de datos" no lo es, porque el estado de la base de
 * datos del usuario no esta en internet. La diferencia esta en el sujeto, no en la
 * palabra, asi que se busca el sintagma con "mi"/"mis" pegado.
 */
const OWN_THING = /\b(?:mi|mis|el|la)\s+(?:\w+\s+){0,2}(?:base de datos|proyecto|app|aplicacion|servidor|server|repo|repositorio|codigo|archivo|carpeta|cuenta|cr[ée]dito)/i

/**
 * "busca en el vault / en mis notas" no es una busqueda web.
 *
 * El verbo es el mismo y por eso `LOOKS_LIKE_ORDER` lo dispara, pero la peticion es
 * para `search_vault`, que lee el vault local y no gasta subrequests. Forzar aqui
 * `web_search` haria las dos cosas y ademas responderia con Wikipedia en vez de con
 * las notas del usuario, que es justo lo que pidio.
 *
 * Se comprueba antes de cualquier otra senal porque es el caso mas especifico.
 */
const WANTS_VAULT =
  /\b(?:en|sobre)\s+(?:mi|el|las|los)\s+(?:vault|notas|biblioteca|carpeta)\b|\b(?:vault|biblioteca)\b\s*(?:de\s+notas)?\s*[,?]|notas\s+(?:que\s+)?(?:tengo|guard[eé]|hay|sobre)/i

/**
 * Decide si la ultima intervencion pide buscar.
 *
 * Se mira solo la ultima intervencion del usuario, no el historial: si hace tres
 * mensajes pidio una busqueda y ahora pregunta otra cosa, forzar seria molestar.
 */
function wantsWebSearch(messages: { role: string; content: string }[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last?.content) return false

  const text = last.content.trim()

  // El vault local no es la web: va primero y corta todo lo demas.
  if (WANTS_VAULT.test(text)) return false
  // El estado de algo del usuario no se busca en internet.
  if (OWN_THING.test(text)) return false

  // Un log o un bloque de codigo pegado no es una peticion de busqueda, aunque
  // contenga "search" en un nombre de funcion. Sin este tope, pegar un archivo de
  // 500 lineas quemaba una de las 3 rondas.
  if (text.length > 1200) return false
  // Si es casi todo codigo, tampoco: aqui lo que se quiere es que lo arregle.
  const codeFence = (text.match(/```/g) ?? []).length
  if (codeFence >= 2) return false

  if (LOOKS_LIKE_ORDER.test(text)) return true
  // "WANTS_CURRENT" exige sintagma completo, asi que basta con una vez.
  return WANTS_CURRENT.test(text)
}

async function generateSummary(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHEAP_MODEL,
      messages: [
        { role: 'system', content: 'Resume la siguiente conversación técnica. Sé conciso (máx 200 palabras). Conserva decisiones técnicas, problemas, soluciones y contexto importante.' },
        { role: 'user', content: text },
      ],
      max_tokens: 512,
      temperature: 0.3,
    }),
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

function buildContextMessages(
  messages: { role: string; content: string }[],
  summary: string | null,
): { role: string; content: string }[] {
  if (!summary || messages.length <= MAX_VISIBLE_MESSAGES) return messages
  const recent = messages.slice(-MAX_VISIBLE_MESSAGES)
  return [
    { role: 'system', content: `[Resumen de la conversación anterior: ${summary}]` },
    ...recent,
  ]
}

async function rememberTurn(apiKey: string, userContent: string): Promise<void> {
  try {
    const { extractMemories, heuristicExtract } = await import('@/app/lib/memory-extract')
    const { createMemory, getContext, setContext } = await import('@/app/lib/memory')

    let facts = await extractMemories(apiKey, userContent)
    if (facts.length === 0) facts = heuristicExtract(userContent)

    for (const fact of facts) {
      await createMemory({
        type: fact.type,
        category: fact.category,
        content: fact.content,
        importance: fact.importance,
        confidence: fact.confidence ?? 0.6,
        tags: fact.tags,
        source: 'conversation',
      }).catch(() => {})
    }

    // Working memory: mantener una lista corta de temas recientes de la sesión
    const ctx = (await getContext<{ topics: string[] }>('session')) ?? { topics: [] }
    const topic = userContent.replace(/\s+/g, ' ').trim().slice(0, 80)
    ctx.topics = [...new Set([topic, ...ctx.topics])].slice(0, 8)
    await setContext('session', ctx, 60)
  } catch (err) {
    console.error('Memory extraction failed:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, model = DEFAULT_MODEL, conversationId } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY no configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load existing summary from DB if conversationId provided
    let summary: string | null = null
    if (conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { summary: true },
      })
      summary = conv?.summary || null
    }

    // Extracción de memoria del turno en segundo plano (no bloquea la respuesta).
    // OBLIGATORIO registrarlo con ctx.waitUntil(): si el promise queda suelto se
    // resuelve en el contexto de un request posterior y workerd lo cancela
    // ("Cannot perform I/O on behalf of a different request" -> HTTP 1101),
    // además de corromper el cliente Prisma compartido.
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg?.content) {
      const task = rememberTurn(apiKey, lastUserMsg.content)
      let registered = false
      try {
        const { getCloudflareContext } = await import('@opennextjs/cloudflare')
        const { ctx } = await getCloudflareContext({ async: true })
        ctx.waitUntil(task)
        registered = true
      } catch {
        // Fuera del runtime de Cloudflare (scripts locales): fire-and-forget.
      }
      if (!registered) void task
    }

    // Build context-aware message list (summary + recent messages)
    const contextMessages = buildContextMessages(messages, summary)
    const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

    // If messages were truncated but no summary exists yet, generate one
    if (messages.length > MAX_VISIBLE_MESSAGES && !summary) {
      const oldMessages = messages.slice(0, -MAX_VISIBLE_MESSAGES)
      const newSummary = await generateSummary(apiKey, oldMessages)
      if (newSummary && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { summary: newSummary },
        }).catch(() => {})
      }
    }

    // Retrieve relevant memories so ARIA has context about the user
    let memoryBlock: string[] | null = null
    if (lastUserMsg?.content) {
      try {
        const { searchSemanticMemories, searchMemories } = await import('@/app/lib/memory')
        const [relevant, prefs, episodic] = await Promise.all([
          searchSemanticMemories(lastUserMsg.content, 4, 0.45),
          searchMemories({ category: 'preference', minImportance: 0.7, limit: 3 }).catch(() => []),
          searchMemories({ type: 'episodic', limit: 2 }).catch(() => []),
        ])
        const seen = new Set<string>()
        const items = [...relevant, ...prefs, ...episodic]
          .filter((m) => (seen.has(m.content) ? false : (seen.add(m.content), true)))
          .slice(0, 6)
        if (items.length > 0) {
          memoryBlock = items.map(
            (m) => `- [${m.type}/${m.category} · importancia ${m.importance}] ${m.content}`
          )
        }
      } catch { /* memory unavailable, continue without it */ }
    }

    // Build final messages array with system prompt
    const allMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(memoryBlock
        ? [{ role: 'system', content: `[Memoria de ARIA sobre el usuario — usa estos datos solo cuando aporten contexto relevante, sin mencionar que vienen de la memoria salvo que el usuario lo pregunte:]` },
           { role: 'system', content: memoryBlock.join('\n') }]
        : []),
      ...contextMessages,
    ]

    // Check if we should use tool calling (skip for simple/fast models to save latency)
    const useTools = model !== CHEAP_MODEL

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
    const streamSimple = (messages: typeof allMessages): Promise<Response> =>
      groqFetch(apiKey, {
        model,
        messages,
        stream: true,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      })

    const NO_TOOLS_NOTICE =
      'AVISO: en esta respuesta no tenes herramientas disponibles. ' +
      'No intentes usarlas ni las menciones. Responde directamente con lo que ' +
      'sepas, y si la pregunta requiere informacion actual que no tenes, ' +
      'dilo con claridad en vez de quedarte en silencio.'

    const groqRes = await streamSimple(allMessages)

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      return groqErrorResponse(groqRes.status, errText)
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
