/**
 * Núcleo compartido del cerebro de ARIA.
 *
 * Hasta ahora toda la construcción del prompt (system prompt, memoria del
 * usuario, memoria de trabajo, resumen de la conversación) vivía dentro de
 * `app/api/chat/route.ts`, atada al streaming HTTP. Al abrir ARIA a otros
 * canales (WhatsApp, correo) que necesitan la misma inteligencia pero SIN SSE,
 * esa lógica se extrae aquí para no duplicarla ni bifurcar el comportamiento.
 *
 * Lo que queda en `chat/route.ts` es solo la capa HTTP: parsear la petición,
 * emitir el stream SSE y traducir errores.
 */
import { prisma } from '@/app/lib/prisma'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

export const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning & Intelligence Assistant), a cutting-edge AI built for developers, engineers, and curious minds.

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
- Cierra las respuestas sustantivas con una sección breve de **Sugerencias** o **Próximos pasos** cuando aporte valor real

## Pensamiento crítico y sugerencias (comportamiento por defecto)
Cuando el usuario proponga una idea, plan, arquitectura, compra o decisión:
- Evalúala con honestidad. No la valides por cortesía ni empieces con "¡buena idea!". Si tiene un problema de fondo, dilo primero y explica por qué.
- Señala supuestos ocultos, riesgos, costos, dependencias y casos borde que el usuario no haya considerado.
- Ofrece siempre 1-3 alternativas concretas o mejoras accionables, con su ventaja y su costo.
- Distingue hechos verificables de tu opinión o estimación; si no estás seguro, dilo en vez de inventar.
- Si falta información para juzgar bien, haz 1-3 preguntas de aclaración antes de opinar.
- Cuando des una recomendación, cierra con próximos pasos concretos.
Sé crítico pero constructivo: el objetivo es que la idea salga mejor, no demolerla. Nada de crítica sin una salida mejor.

## Languages
Respond in the same language the user writes in (Spanish, English, etc.).

## Tools Available
You have access to tools that let you search the web, search notes in the user's Obsidian vault, read note contents, save new notes, evaluate math, read the clock, check the weather, find notes by relevance, open applications on the user's device, and send email. Use these proactively when:
- The user asks about current events, news, or recent information → **web_search**
- The user asks about something they've studied or worked on → **search_vault**
- The user wants the most relevant notes on a concept, not just exact matches → **semantic_search_vault**
- You need to read a specific note for context → **read_note**
- The user asks you to save or document something → **save_note**
- The user asks for an exact numeric calculation → **calculate**
- The user asks what time or date it is → **get_time**
- The user asks about weather anywhere in the world → **get_weather**
- The user asks about something you should remember or know about them (preferences, habits, past work) → **recall_memory**
- The user asks you to open an app, program or file on their computer → **open_app** (di que lo estás intentando; no confirmes que se abrió hasta que el usuario lo vea)
- The user asks you to send, write or reply to an email → **send_email**
- The user asks you to review a repository, look at its issues or suggest how to fix it → **github_repo_overview** first, then **github_list_files**, **github_read_file** and **github_list_issues** as needed

The GitHub tools are read-only: you can read repositories, files and issues, but you can never create, edit, close or delete anything on GitHub. When you review a repo, ground every suggestion in what you actually read (cite the file paths and, if relevant, line context); never guess at file contents you did not fetch. If the user configured repositories, a list appears in your context — use it when they say "my repo" or "the repo I added", but still confirm which one if it is ambiguous.

The cloud ARIA folder (**save_cloud_note**, **list_cloud_notes**, **read_cloud_note**) is the user's persistent notes store, exportable to Obsidian. Use **save_cloud_note** when the user explicitly asks you to save, note down or remember something as a note; do not use it for every fact (ordinary preferences and facts are handled automatically by memory). Write notes as clean Markdown with a short descriptive title, and list or read notes before assuming what is stored.

Always try to use these tools when they would improve your answer. When you use web_search, cite your sources.

## When the user asks you to search
If the user explicitly asks you to search, look something up, check online, or find recent information, you MUST call web_search before answering — even if you believe you already know the answer. Your memory of versions, commands, and APIs goes stale, and a confident wrong answer is worse than a slower right one. Answering from memory without searching when asked to search is a failure.

After searching, base your answer on what the results actually say. If the results do not contain the detail you were about to give, say that it is not in the sources instead of filling the gap from memory. Never invent release notes, version numbers, or command syntax.

Always aim to be the best engineer and teacher you can be.`

export interface GroqModelConfig {
  max_tokens: number
  temperature: number
}

export const MODEL_CONFIG: Record<string, GroqModelConfig> = {
  'openai/gpt-oss-120b': { max_tokens: 8192, temperature: 0.6 },
  'qwen/qwen3.8-27b': { max_tokens: 8192, temperature: 0.6 },
  'openai/gpt-oss-20b': { max_tokens: 4096, temperature: 0.7 },
  // DeepSeek R1 distilado por Cloudflare Workers AI (gratis dentro de las
  // 10.000 neuronas/día). Es de razonamiento: gasta tokens pensando antes de
  // responder, por eso se le deja un margen amplio.
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { max_tokens: 8192, temperature: 0.6 },
}

export const MAX_VISIBLE_MESSAGES = 8
export const CHEAP_MODEL = 'openai/gpt-oss-20b'
export const DEFAULT_MODEL = 'openai/gpt-oss-120b'

export interface ChatMessage {
  role: string
  content: string
}

/* ------------------------------------------------------------------ *
 * Detección de "busca en la web" (portado tal cual desde la ruta)     *
 * ------------------------------------------------------------------ */

const LOOKS_LIKE_ORDER =
  /\b(busca|buscar|buscame|busqueda|investiga|investigar|googlea|googlear|search (?:the )?(?:web|internet)|look ?up|look for|find (?:me )?(?:online|on the web|information)|check online|verifica online)\b/i

const WANTS_CURRENT =
  /\b(noticias|news|actualidad|ultima vers[ió]n|ultimo lanzamiento|lo (?:ultimo|m[áa]s reciente)|novedades|que hay de nuevo|que trae|release notes?|changelog|how (?:is|are) .{1,20} (?:today|now these days)|estado actual|currently (?:is|are) (?:supported|available|maintained)|still (?:supported|maintained|available))\b/i

const OWN_THING =
  /\b(?:mi|mis|el|la)\s+(?:\w+\s+){0,2}(?:base de datos|proyecto|app|aplicacion|servidor|server|repo|repositorio|codigo|archivo|carpeta|cuenta|cr[ée]dito)/i

const WANTS_VAULT =
  /\b(?:en|sobre)\s+(?:mi|el|las|los)\s+(?:vault|notas|biblioteca|carpeta)\b|\b(?:vault|biblioteca)\b\s*(?:de\s+notas)?\s*[,?]|notas\s+(?:que\s+)?(?:tengo|guard[eé]|hay|sobre)/i

/**
 * Decide si la última intervención pide buscar en la web.
 *
 * Se mira solo el último mensaje del usuario, no el historial: si hace tres
 * mensajes pidió una búsqueda y ahora pregunta otra cosa, forzar sería molestar.
 */
export function wantsWebSearch(messages: ChatMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last?.content) return false

  const text = last.content.trim()

  if (WANTS_VAULT.test(text)) return false
  if (OWN_THING.test(text)) return false
  if (text.length > 1200) return false
  const codeFence = (text.match(/```/g) ?? []).length
  if (codeFence >= 2) return false

  if (LOOKS_LIKE_ORDER.test(text)) return true
  return WANTS_CURRENT.test(text)
}

/* ------------------------------------------------------------------ *
 * Contexto: resumen, memoria del usuario y memoria de trabajo         *
 * ------------------------------------------------------------------ */

export async function generateSummary(apiKey: string, messages: ChatMessage[]): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHEAP_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Resume la siguiente conversación técnica. Sé conciso (máx 200 palabras). Conserva decisiones técnicas, problemas, soluciones y contexto importante.',
        },
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

export function buildContextMessages(
  messages: ChatMessage[],
  summary: string | null,
): ChatMessage[] {
  if (!summary || messages.length <= MAX_VISIBLE_MESSAGES) return messages
  const recent = messages.slice(-MAX_VISIBLE_MESSAGES)
  return [
    { role: 'system', content: `[Resumen de la conversación anterior: ${summary}]` },
    ...recent,
  ]
}

export async function rememberTurn(
  apiKey: string,
  userContent: string,
  conversationId?: string | null,
): Promise<void> {
  try {
    const { extractMemories, heuristicExtract } = await import('@/app/lib/memory-extract')
    const { createMemory, updateWorkingMemory } = await import('@/app/lib/memory')

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

    // Memoria de trabajo: hilo corto de temas recientes, aislado por conversación.
    await updateWorkingMemory(conversationId, userContent)
  } catch (err) {
    console.error('Memory extraction failed:', err)
  }
}

export interface AriaContext {
  /** Lista final lista para enviar a Groq (system prompt + memoria + historial). */
  allMessages: ChatMessage[]
  /** Historial con el resumen aplicado (sin los bloques de memoria). */
  contextMessages: ChatMessage[]
  /** Ids de las memorias inyectadas, para reforzarlas después. */
  injectedMemoryIds: string[]
  /** Resumen persistido que existía antes de este turno. */
  summary: string | null
  /** Último mensaje del usuario, si lo hay. */
  lastUserMsg: ChatMessage | null
}

/**
 * Construye el contexto completo de un turno: resumen + memoria a largo plazo
 * + memoria de trabajo + historial reciente. Es la parte del cerebro que
 * comparten el chat web, WhatsApp y el correo.
 */
export async function buildAriaContext(
  messages: ChatMessage[],
  conversationId?: string | null,
): Promise<AriaContext> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user') ?? null

  // Resumen persistido de la conversación (si existe).
  let summary: string | null = null
  if (conversationId) {
    const conv = await prisma.conversation
      .findUnique({ where: { id: conversationId }, select: { summary: true } })
      .catch(() => null)
    summary = conv?.summary || null
  }

  const contextMessages = buildContextMessages(messages, summary)

  // Memoria de trabajo de esta conversación: hilo reciente de temas.
  let workingBlock: string[] | null = null
  try {
    const { getWorkingMemory } = await import('@/app/lib/memory')
    const wm = await getWorkingMemory(conversationId)
    if (wm && wm.topics.length > 0) workingBlock = wm.topics.slice(0, 5)
  } catch {
    /* memoria de trabajo no disponible */
  }

  // Recupera memorias relevantes para dar contexto sobre el usuario.
  let memoryBlock: string[] | null = null
  let injectedMemoryIds: string[] = []
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
          (m) => `- [${m.type}/${m.category} · importancia ${m.importance}] ${m.content}`,
        )
        injectedMemoryIds = items.map((m) => m.id)
      }
    } catch {
      /* memoria no disponible: seguir sin ella */
    }
  }

  const allMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(memoryBlock
      ? [
          {
            role: 'system',
            content: `[Memoria de ARIA sobre el usuario — usa estos datos solo cuando aporten contexto relevante, sin mencionar que vienen de la memoria salvo que el usuario lo pregunte:]`,
          },
          { role: 'system', content: memoryBlock.join('\n') },
        ]
      : []),
    ...(workingBlock
      ? [
          {
            role: 'system',
            content: `[Memoria de trabajo de esta conversación — hilo reciente. Sirve para mantener continuidad; no lo menciones explícitamente:]`,
          },
          { role: 'system', content: workingBlock.map((t) => `- ${t}`).join('\n') },
        ]
      : []),
    ...contextMessages,
  ]

  // Repos de GitHub configurados por el usuario: se listan para que ARIA sepa a
  // qué apuntar cuando diga "mi repo". La lectura real la hacen las github_*.
  try {
    const { getRepos } = await import('@/app/lib/github')
    const repos = await getRepos()
    if (repos.length > 0) {
      allMessages.push({
        role: 'system',
        content:
          '[Repositorios de GitHub que el usuario agregó — usa github_repo_overview y las demás ' +
          'herramientas github_* para leerlos cuando haga falta. No inventes su contenido:]\n' +
          repos.map((r) => `- ${r.repo}${r.note ? ` — ${r.note}` : ''}`).join('\n'),
      })
    }
  } catch {
    /* GitHub no disponible: seguir sin la lista */
  }

  return { allMessages, contextMessages, injectedMemoryIds, summary, lastUserMsg }
}
