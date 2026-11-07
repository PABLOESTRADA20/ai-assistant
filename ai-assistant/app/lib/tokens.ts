/**
 * Estimación de tokens 100% local (sin red ni API).
 *
 * Groq y la mayoría de los tokenizers rondan ~3.5 caracteres por token en
 * texto mixto español/inglés. Es una aproximación para PRESUPUESTAR el contexto
 * y recortar antes de enviar, no para facturar. Nunca hace fetch: cada número
 * que sale de aquí es dinero/tokens que NO se gastan, así que siempre es
 * preferible a una llamada a un modelo.
 *
 * El overhead por mensaje cubre el `role`, los separadores del chat template y
 * el token de cierre; es fijo y barato de sumar.
 */

/** Caracteres por token (aproximación conservadora para español/inglés). */
export const CHARS_PER_TOKEN = 3.5

/** Overhead fijo por mensaje del chat template (role + separadores + cierre). */
export const MESSAGE_OVERHEAD_TOKENS = 4

/**
 * Presupuesto de entrada por defecto cuando el modelo no lo define en
 * `MODEL_CONFIG`. 5000 es el listón de Groq free (~8000 TPM compartidos), que
 * es el cuello de botella real de ARIA.
 */
export const DEFAULT_CONTEXT_BUDGET = 5000

/**
 * TPM del free tier de Groq. Es un límite compartido por TODOS sus modelos y
 * se cuenta por minuto, sumando la entrada y la salida de cada request del
 * turno (incluidas las rondas de herramientas).
 */
export const GROQ_FREE_TPM = 8000

/** Margen conservador para no rozar el límite por error de estimación. */
export const TOKEN_BUDGET_MARGIN = 256

/** Cualquier mensaje estimable: solo necesitamos su contenido. */
export interface EstimatableMessage {
  role?: string
  content?: string
}

/** Tokens estimados de un texto. Vacío o ausente → 0. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Tokens estimados de una lista de mensajes: contenido + overhead fijo por
 * mensaje. Los mensajes sin contenido (p. ej. tool calls vacías) cuentan solo
 * su overhead, que es lo que realmente ocupa en el prompt.
 */
export function estimateMessagesTokens(
  messages: readonly EstimatableMessage[] | null | undefined,
): number {
  if (!messages || messages.length === 0) return 0
  let total = 0
  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS + estimateTokens(message?.content)
  }
  return total
}

/**
 * Tokens que ocupan los esquemas de herramientas en el prompt. A diferencia de
 * los mensajes, no pasan por `estimateMessagesTokens`; sin contarlos, el
 * presupuesto de entrada se queda corto justo en los turnos con tool calling.
 */
export function estimateToolDefinitionsTokens(
  definitions: readonly unknown[] | null | undefined,
): number {
  if (!definitions || definitions.length === 0) return 0
  return estimateTokens(JSON.stringify(definitions))
}

/**
 * Recorta un contexto al presupuesto de ENTRADA conservando lo irrenunciable:
 *
 * - los mensajes `system` iniciales (prompt, memoria, repos),
 * - el último mensaje (normalmente el turno del usuario que hay que responder),
 * - y, desde el final hacia atrás, los mensajes recientes que aún quepan.
 *
 * Se usa solo ANTES de empezar el bucle de herramientas, cuando el historial
 * todavía no contiene mensajes `assistant` con `tool_calls` ni resultados
 * `tool`; así nunca se rompe un par llamada/resultado. Si ni siquiera caben el
 * sistema y el último mensaje, se devuelven igual: es preferible pasarse un
 * poco a quedarse sin la pregunta actual.
 */
export function trimMessagesToBudget<T extends EstimatableMessage>(
  messages: readonly T[] | null | undefined,
  maxTokens: number,
): T[] {
  if (!messages || messages.length === 0) return []

  const budget = Math.max(0, Math.floor(maxTokens) || 0)
  if (estimateMessagesTokens(messages) <= budget) return [...messages]

  let systemEnd = 0
  while (systemEnd < messages.length && messages[systemEnd]?.role === 'system') {
    systemEnd++
  }

  const fixed = messages.slice(0, systemEnd)
  const tail = messages.slice(systemEnd)
  if (tail.length === 0) return [...fixed]

  const last = tail[tail.length - 1]
  const kept: T[] = [last]
  let used =
    estimateMessagesTokens(fixed) +
    MESSAGE_OVERHEAD_TOKENS +
    estimateTokens(last.content)

  for (let i = tail.length - 2; i >= 0; i--) {
    const message = tail[i]
    const cost = MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content)
    if (used + cost > budget) break
    kept.unshift(message)
    used += cost
  }

  return [...fixed, ...kept]
}

export interface OutputBudgetOptions {
  /** Tokens estimados del prompt que se va a enviar (mensajes + herramientas). */
  promptTokens: number
  /** Tope deseado por el llamador (p. ej. `MODEL_CONFIG[model].max_tokens`). */
  desired: number
  /** Tokens ya consumidos en este turno (rondas anteriores de herramientas). */
  usedTokens?: number
  /** Límite total del proveedor; por defecto, el TPM free de Groq. */
  limit?: number
  /** Suelo para no pedir una salida vacía. */
  min?: number
  /** Margen de seguridad sobre el límite. */
  margin?: number
}

/**
 * Calcula cuántos tokens de salida se pueden pedir sin pasarse del TPM.
 *
 * El límite se comparte entre todas las peticiones del turno, así que hay que
 * descontar tanto el prompt actual como lo ya gastado. Nunca devuelve menos
 * que `min` (el llamador decide si aun así vale la pena llamar): es mejor una
 * respuesta corta que un 429.
 */
export function fitOutputTokens(options: OutputBudgetOptions): number {
  const desired = Math.max(1, Math.floor(options.desired) || 1)
  const min = Math.min(desired, Math.max(1, Math.floor(options.min ?? 1) || 1))
  const limit = Math.max(1, Math.floor(options.limit ?? GROQ_FREE_TPM) || 1)
  const used = Math.max(0, Math.floor(options.usedTokens ?? 0) || 0)
  const prompt = Math.max(0, Math.floor(options.promptTokens) || 0)
  const margin = Math.max(0, Math.floor(options.margin ?? TOKEN_BUDGET_MARGIN) || 0)

  const available = limit - used - prompt - margin
  if (available <= min) return min
  return Math.min(desired, available)
}
