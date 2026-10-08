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
