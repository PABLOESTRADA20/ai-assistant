/**
 * Bloques SSE que el chat repite en sus dos caminos (con herramientas y simple).
 *
 * Se generan aquí para que el formato sea exactamente el mismo en ambos sitios:
 * el cliente no debe notar por qué camino salió la respuesta. Cada función
 * devuelve el bloque completo (incluido `data: ` y la línea en blanco) o null si
 * no hay nada que enviar.
 */

export type ModelSwitchReason = 'quota' | 'no_tools'

export interface ModelSwitchParams {
  from: string
  to: string
  reason: ModelSwitchReason
  /** Solo se incluye si tiene valor (cuenta regresiva de cuota). */
  until?: string | null
}

export interface ContextParams {
  budget: number
  promptTokens: number
  summarizedCount: number
  hasSummary: boolean
}

/** Evento de auto-cambio de modelo. Solo si el modelo realmente cambió. */
export function modelSwitchEvent({ from, to, reason, until }: ModelSwitchParams): string | null {
  if (!from || !to || from === to) return null

  return `data: ${JSON.stringify({
    type: 'model_switch',
    from,
    to,
    reason,
    ...(until ? { until } : {}),
  })}\n\n`
}

/** Indicador de contexto del turno (presupuesto, prompt estimado y resumen). */
export function contextEvent({
  budget,
  promptTokens,
  summarizedCount,
  hasSummary,
}: ContextParams): string {
  return `data: ${JSON.stringify({
    type: 'context',
    context: { budget, promptTokens, summarizedCount, hasSummary },
  })}\n\n`
}

/** Chips de fuentes del cerebro. Solo si hay fuentes. */
export function sourcesEvent(sources: readonly unknown[] | null | undefined): string | null {
  if (!sources || sources.length === 0) return null
  return `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`
}
