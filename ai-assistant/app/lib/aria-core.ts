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
import type { BrainHit } from '@/app/lib/brain'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

export const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning & Intelligence Assistant), an AI for developers, engineers and curious minds. You think step by step, reason carefully and write production-ready code. You are direct, precise and honest.

## Code
- Always give complete, runnable code; never truncate with "...rest of code".
- Handle errors and edge cases. Tag the language in every code block.
- For bugs: identify the root cause, explain WHY it fails, then fix it.
- For complex problems: outline the approach first, then write the code.
- Use Markdown and headers for long answers; comment non-obvious logic briefly.

## Pensamiento crítico (comportamiento por defecto)
Cuando el usuario proponga una idea, plan, arquitectura, compra o decisión:
- Evalúala con honestidad. No la valides por cortesía ni empieces con "¡buena idea!". Si tiene un problema de fondo, dilo primero y explica por qué.
- Señala supuestos ocultos, riesgos, costos, dependencias y casos borde.
- Ofrece 1-3 alternativas concretas o mejoras accionables, con su ventaja y su costo.
- Distingue hechos verificables de tu opinión; si no estás seguro, dilo en vez de inventar.
- Si falta información, haz 1-3 preguntas de aclaración antes de opinar.
Sé crítico pero constructivo: el objetivo es que la idea salga mejor, no demolerla.

## Languages
Respond in the same language the user writes in (Spanish, English, etc.).

## When the user asks you to search
If the user asks you to search, look something up or find recent information, you MUST call web_search before answering, even if you think you already know the answer. Your memory of versions, commands and APIs goes stale, and a confident wrong answer is worse than a slower right one.
After searching, base the answer on what the sources actually say. If they lack the detail, say it is not in the sources; never invent release notes, version numbers or command syntax.

## GitHub
You can read repositories, files and issues. Ground every suggestion in what you actually read (cite file paths); never guess at file contents you did not fetch. If the user explicitly asks you to implement or modify code, you may use github_create_pull_request only after reading every affected file. That tool creates an isolated branch and a PR: never claim the change is merged, never use it without an explicit modification request, and never try to bypass its path or size protections. If configured repositories are listed in context, use them when the user says "my repo", but confirm which one if it is ambiguous.

## Cloud notes
The ARIA cloud folder is the user's persistent notes store, exportable to Obsidian. Save a note when the user explicitly asks you to save, note down or remember something as a note; ordinary preferences and facts are handled automatically by memory. Write clean Markdown with a short title, and list or read notes before assuming what is stored.

When a tool is offered and it would improve your answer, use it. Cite your sources when you use web_search. Always aim to be the best engineer and teacher you can be.`

export interface GroqModelConfig {
  max_tokens: number
  temperature: number
  /**
   * Presupuesto de tokens de ENTRADA (system + memoria + historial) antes de
   * recortar/compactar. Groq free es el cuello de botella real (~8000 TPM
   * compartidos por TODOS sus modelos), así que ahí se queda corto; Workers AI
   * y los proveedores de ventana grande admiten más.
   *
   * Es opcional para no romper los fallbacks
   * `MODEL_CONFIG[x] || { max_tokens, temperature }` de chat/route.ts y
   * aria-reply.ts; quien lo consuma usa `contextBudget ?? DEFAULT_CONTEXT_BUDGET`
   * (app/lib/tokens.ts).
   */
  contextBudget?: number
}

// Presupuestos de entrada por familia:
//   - Groq free: 5000 (límite ~8000 TPM es el recurso escaso).
//   - Workers AI y proveedores free de ventana grande: 12000.
//   - Gemini: 14000 (ventana muy amplia).
export const MODEL_CONFIG: Record<string, GroqModelConfig> = {
  'openai/gpt-oss-120b': { max_tokens: 8192, temperature: 0.6, contextBudget: 5000 },
  'qwen/qwen3.8-27b': { max_tokens: 8192, temperature: 0.6, contextBudget: 5000 },
  'openai/gpt-oss-20b': { max_tokens: 4096, temperature: 0.7, contextBudget: 5000 },
  // Workers AI (gratis, sin clave). Comparten las 10.000 neuronas/dia.
  '@cf/openai/gpt-oss-120b': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  '@cf/google/gemma-4-26b-a4b-it': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  // DeepSeek R1 distilado por Cloudflare Workers AI (gratis dentro de las
  // 10.000 neuronas/día). Es de razonamiento: gasta tokens pensando antes de
  // responder, por eso se le deja un margen amplio.
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  // Proveedores con free tier (requieren clave).
  'gemini-3.5-flash': { max_tokens: 8192, temperature: 0.6, contextBudget: 14000 },
  'gemini-3.5-flash-lite': { max_tokens: 8192, temperature: 0.6, contextBudget: 14000 },
  'mistral-small-4': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  'openai/gpt-oss-20b:free': { max_tokens: 4096, temperature: 0.7, contextBudget: 12000 },
  'nvidia/nemotron-3-super-120b-a12b:free': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
  'glm-4.7-flash': { max_tokens: 8192, temperature: 0.6, contextBudget: 12000 },
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
  /\b(noticias|news|actualidad|ultima vers[ió]n|ultimo lanzamiento|lo (?:ultimo|m[áa]s reciente)|novedades|qu[eé] hay de nuevo|que trae|release notes?|changelog|how (?:is|are) .{1,20} (?:today|now these days)|estado actual|currently (?:is|are) (?:supported|available|maintained)|still (?:supported|maintained|available))\b/i

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
 * Selección de herramientas por palabras clave (100% local, $0)       *
 * ------------------------------------------------------------------ */

/**
 * Grupos de herramientas que `selectTools` puede ofrecer. Los nombres deben
 * coincidir EXACTAMENTE con `TOOL_DEFINITIONS` (app/lib/tools.ts); hay un test
 * que lo verifica para detectar desincronizaciones.
 */
export const TOOL_GROUPS = {
  web: ['web_search'],
  vault: ['search_vault', 'semantic_search_vault', 'read_note', 'save_note'],
  cloudNotes: ['list_cloud_notes', 'read_cloud_note', 'save_cloud_note'],
  github: [
    'github_repo_overview',
    'github_list_files',
    'github_read_file',
    'github_list_issues',
  ],
  githubWrite: ['github_create_pull_request'],
  memory: ['recall_memory'],
  time: ['get_time'],
  math: ['calculate'],
  weather: ['get_weather'],
  apps: ['open_app'],
  email: ['send_email'],
} as const

const RX_GITHUB =
  /\b(github|repositorio|\brepos?\b|\brama\b|\bbranch\b|\bissues?\b|c[oó]digo fuente|pull request)\b/i
const RX_GITHUB_URL = /github\.com\/[\w.-]+\/[\w.-]+/i
const RX_GITHUB_WRITE =
  /\b(modifica|modificar|edita|editar|cambia|cambiar|implementa|implementar|corrige|corregir|arregla|arreglar|crea(?:r)?|actualiza|actualizar|haz(?:me)? (?:el )?cambio)\b/i
const RX_VAULT = /\b(vault|obsidian|\bnotas?\b|\bapuntes?\b|biblioteca)\b/i
const RX_CLOUD_NOTES =
  /\b(nube|cloud|notas? de (?:aria|la nube)|guarda(?:me)? (?:una )?nota|mis notas)\b/i
const RX_MEMORY =
  /\b(recuerd[ao]s?|te acord[aá]s|qu[eé] sabes de m[ií]|mis? preferencias?|preferencia sobre|acordate de)/i
const RX_TIME =
  /\b(qu[eé] hora|hora es|la hora|fecha de hoy|qu[eé] d[ií]a|d[ií]a es hoy|zona horaria|horario)\b/i
const RX_MATH =
  /\b(c[aá]lcul[oa]|calculadora|cu[aá]nto (?:es|son|da|vale|queda)|resultado de|suma(?:r|me)?|resta(?:r|me)?|multiplica(?:r|me)?|divide|dividir|porcentaje|promedio|ra[ií]z cuadrada)\b|\d\s*[+\-*/^]\s*\d|\d+\s*%\s*de\b/i
const RX_WEATHER =
  /\b(clima|tiempo atmosf[eé]rico|temperatura|llueve|va a llover|pron[oó]stico|nieve|soleado|nublado|hace fr[ií]o|hace calor)\b/i
const RX_APPS =
  /\b([aá]bre|abrir|abr[ií]me|[aá]breme|ejecuta|lanza)\b[^.]{0,40}\b(app|aplicaci[oó]n|spotify|vscode|vs ?code|carpeta|navegador|programa)/i
const RX_EMAIL =
  /\b(env[ií]a(?:me|le|les)?|mand[aá](?:me|le|les)?|escr[ií]b)\b[^.]{0,40}\b(correo|mail|e-?mail)\b/i

/**
 * Decide QUÉ herramientas se ofrecen en un turno, por palabras clave locales.
 *
 * Regla de oro: en charla normal no se manda NINGUNA herramienta. Cada schema
 * cuesta tokens del free tier y su mera presencia empuja al modelo a querer
 * usarla. Solo se ofrecen las que el mensaje pide de forma detectable; jamás se
 * consulta a un modelo para decidirlo (coste cero).
 *
 * `hasRepos` gatea `github_*`: sin repos configurados no hay a qué apuntar por
 * defecto. Si el mensaje trae un repo explícito (github.com/owner/repo) se
 * ofrecen igualmente.
 */
export function selectTools(
  lastUserMsg: ChatMessage | null | undefined,
  hasRepos = false,
): string[] {
  const text = (lastUserMsg?.content ?? '').trim()
  if (!text) return []

  const tools = new Set<string>()
  const add = (group: readonly string[]) => group.forEach((name) => tools.add(name))

  // Búsqueda web: reutiliza la heurística que ya forzaba la herramienta.
  if (wantsWebSearch([{ role: 'user', content: text }])) add(TOOL_GROUPS.web)

  if (RX_GITHUB.test(text) && (hasRepos || RX_GITHUB_URL.test(text))) {
    add(TOOL_GROUPS.github)
    if (RX_GITHUB_WRITE.test(text)) add(TOOL_GROUPS.githubWrite)
  }
  if (RX_VAULT.test(text)) add(TOOL_GROUPS.vault)
  if (RX_CLOUD_NOTES.test(text)) add(TOOL_GROUPS.cloudNotes)
  if (RX_MEMORY.test(text)) add(TOOL_GROUPS.memory)
  if (RX_TIME.test(text)) add(TOOL_GROUPS.time)
  if (RX_MATH.test(text)) add(TOOL_GROUPS.math)
  if (RX_WEATHER.test(text)) add(TOOL_GROUPS.weather)
  if (RX_APPS.test(text)) add(TOOL_GROUPS.apps)
  if (RX_EMAIL.test(text)) add(TOOL_GROUPS.email)

  return [...tools]
}

/* ------------------------------------------------------------------ *
 * Contexto: resumen, memoria del usuario y memoria de trabajo         *
 * ------------------------------------------------------------------ */

export async function generateSummary(
  apiKey: string,
  messages: ChatMessage[],
  previousSummary?: string | null,
): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  const system = previousSummary
    ? 'Actualiza el resumen de una conversación técnica fusionando el resumen previo con los mensajes nuevos. Sé conciso (máx 200 palabras). Conserva decisiones técnicas, problemas, soluciones y contexto importante, sin repetir lo que ya estaba.\n\nResumen previo:\n' +
      previousSummary
    : 'Resume la siguiente conversación técnica. Sé conciso (máx 200 palabras). Conserva decisiones técnicas, problemas, soluciones y contexto importante.'
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHEAP_MODEL,
      messages: [
        { role: 'system', content: system },
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

/* ------------------------------------------------------------------ *
 * Compactación incremental del historial                              *
 * ------------------------------------------------------------------ */

/** Mínimo de mensajes nuevos que ameritan otra llamada al modelo barato. */
export const MIN_COMPACT_MESSAGES = 2

export interface CompactionPlan {
  /** Mensajes antiguos que hay que plegar ahora (aún fuera del resumen). */
  toSummarize: ChatMessage[]
  /** Nº de mensajes que quedarán cubiertos por el resumen tras plegarlos. */
  newSummarizedCount: number
}

/**
 * Decide qué mensajes nuevos hay que plegar en el resumen. La ventana visible
 * (últimos `MAX_VISIBLE_MESSAGES`) NUNCA se resume; de lo anterior sólo lo que
 * aún no estaba cubierto. Si no hay nada nuevo, `toSummarize` va vacío y no se
 * llama al modelo (coste cero).
 */
export function planCompaction(
  messages: ChatMessage[],
  summarizedCount: number,
): CompactionPlan {
  const covered = Math.max(0, Math.min(summarizedCount, messages.length))
  const boundary = Math.max(0, messages.length - MAX_VISIBLE_MESSAGES)
  if (boundary <= covered) return { toSummarize: [], newSummarizedCount: covered }
  return {
    toSummarize: messages.slice(covered, boundary),
    newSummarizedCount: boundary,
  }
}

export interface CompactionResult {
  summary: string
  summarizedCount: number
}

/**
 * Compacta de forma incremental: resume SOLO los mensajes antiguos que aún no
 * estaban cubiertos y los fusiona con el resumen previo. Devuelve `null` si no
 * hay nada que plegar o si el modelo no devolvió resumen. No persiste: el
 * llamador decide cuándo guardar.
 */
export async function compactConversation(
  apiKey: string,
  messages: ChatMessage[],
  previousSummary: string | null,
  summarizedCount: number,
): Promise<CompactionResult | null> {
  const plan = planCompaction(messages, summarizedCount)
  if (plan.toSummarize.length < MIN_COMPACT_MESSAGES) return null
  const summary = await generateSummary(apiKey, plan.toSummarize, previousSummary)
  if (!summary) return null
  return { summary, summarizedCount: plan.newSummarizedCount }
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

/* ------------------------------------------------------------------ *
 * Ruido de memoria: topes y composición del bloque inyectado          *
 * ------------------------------------------------------------------ */

/** Máximo de líneas de memoria inyectadas por turno. */
export const MEMORY_MAX_LINES = 6
/** Presupuesto total (caracteres) del bloque de memoria. */
export const MEMORY_BLOCK_MAX_CHARS = 1200
/** Tope por línea; los recuerdos largos se recortan con puntos suspensivos. */
export const MEMORY_LINE_MAX_CHARS = 240

/** Clave de deduplicación: contenido sin espacios redundantes ni mayúsculas. */
function memoryKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Candidato a inyectar en el bloque de memoria. */
export interface MemoryLine {
  /** Clave de deduplicación (contenido normalizado). */
  key: string
  /** Texto final de la línea. */
  line: string
  /** Id de la memoria, para reforzarla si se inyecta. */
  memoryId?: string
  /**
   * true si viene de la recuperación relevante (`searchBrain`). Solo estas se
   * refuerzan: las de relleno (preferencias/episódicas top por importancia) no
   * deben realimentar el ruido turno tras turno.
   */
  relevant?: boolean
}

export interface MemoryBlock {
  lines: string[]
  injectedMemoryIds: string[]
}

/** Aplana y recorta una línea de memoria al tope por línea. */
export function trimMemoryLine(line: string, max = MEMORY_LINE_MAX_CHARS): string {
  const flat = line.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Compone el bloque de memoria: deduplica, recorta líneas y respeta el
 * presupuesto de líneas y caracteres. El orden de entrada manda (lo relevante
 * primero); solo los candidatos `relevant` aportan ids a reforzar.
 */
export function composeMemoryBlock(
  candidates: MemoryLine[],
  options: { maxLines?: number; maxChars?: number } = {},
): MemoryBlock {
  const maxLines = options.maxLines ?? MEMORY_MAX_LINES
  const maxChars = options.maxChars ?? MEMORY_BLOCK_MAX_CHARS
  const seen = new Set<string>()
  const lines: string[] = []
  const injectedMemoryIds: string[] = []
  let used = 0

  for (const candidate of candidates) {
    if (lines.length >= maxLines) break
    if (seen.has(candidate.key)) continue
    seen.add(candidate.key)

    const line = trimMemoryLine(candidate.line)
    const cost = line.length + (lines.length > 0 ? 1 : 0)
    // La primera línea entra siempre; el resto solo si cabe en el presupuesto.
    if (lines.length > 0 && used + cost > maxChars) break

    lines.push(line)
    used += cost
    if (candidate.relevant && candidate.memoryId) injectedMemoryIds.push(candidate.memoryId)
  }

  return { lines, injectedMemoryIds: [...new Set(injectedMemoryIds)] }
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
  /**
   * Hits del cerebro que entraron al bloque de memoria de este turno, para
   * mostrarlos como chips de fuentes en la UI. Sin contenido completo: cada
   * uno se acota con `toSourceRefs` antes de salir por el SSE.
   */
  brainHits: BrainHit[]
  /** Resumen persistido que existía antes de este turno. */
  summary: string | null
  /** Nº de mensajes ya plegados en ese resumen (compactación incremental). */
  summarizedCount: number
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

  // Resumen persistido de la conversación (si existe) y cuántos mensajes cubre.
  // Se lee con SQL crudo: el cliente WASM versionado en el repo no conoce
  // `summarizedCount` (las columnas nuevas van por raw en este repo).
  let summary: string | null = null
  let summarizedCount = 0
  if (conversationId) {
    const rows = await prisma
      .$queryRaw<{ summary: string | null; summarizedCount: number }[]>`
        SELECT "summary", "summarizedCount" FROM "Conversation" WHERE "id" = ${conversationId} LIMIT 1
      `
      .catch(() => [])
    summary = rows[0]?.summary || null
    summarizedCount = rows[0]?.summarizedCount ?? 0
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

  // Recupera recuerdos relevantes para dar contexto sobre el usuario: memoria
  // a largo plazo + notas (carpeta de ARIA y vault de Obsidian) + mensajes
  // viejos de ESTA conversación. Eso lo decide el cerebro unificado
  // (app/lib/brain.ts); las preferencias y episodios vuelven igual que antes.
  let memoryBlock: string[] | null = null
  let injectedMemoryIds: string[] = []
  let brainHits: BrainHit[] = []
  if (lastUserMsg?.content) {
    try {
      const { searchBrain, labelHit } = await import('@/app/lib/brain')
      const { searchMemories } = await import('@/app/lib/memory')
      const [brain, prefs, episodic] = await Promise.all([
        searchBrain(lastUserMsg.content, {
          limit: 4,
          minScore: 0.4,
          conversationId: conversationId ?? null,
        }).catch(() => []),
        searchMemories({ category: 'preference', minImportance: 0.7, limit: 3 }).catch(() => []),
        searchMemories({ type: 'episodic', limit: 2 }).catch(() => []),
      ])
      brainHits = brain
      const candidates: MemoryLine[] = []
      for (const hit of brain) {
        candidates.push({
          key: memoryKey(hit.content),
          line: `- ${labelHit(hit)} ${hit.snippet}`,
          // Solo la memoria a largo plazo se refuerza; notas/vault/mensajes no.
          memoryId: hit.kind === 'memory' ? hit.id : undefined,
          relevant: true,
        })
      }
      for (const m of [...prefs, ...episodic]) {
        candidates.push({
          key: memoryKey(m.content),
          line: `- [${m.type}/${m.category} · importancia ${m.importance}] ${m.content}`,
          memoryId: m.id,
          // Relleno: se inyecta si sobra sitio, pero NO se refuerza (rompería
          // el bucle de ruido: lo irrelevante subiría de importancia cada turno).
          relevant: false,
        })
      }
      const block = composeMemoryBlock(candidates)
      if (block.lines.length > 0) {
        memoryBlock = block.lines
        injectedMemoryIds = block.injectedMemoryIds
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
            content: `[Memoria y notas de ARIA — usa estos datos solo cuando aporten contexto relevante, sin mencionar su origen salvo que el usuario lo pregunte:]`,
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

  return { allMessages, contextMessages, injectedMemoryIds, brainHits, summary, summarizedCount, lastUserMsg }
}
