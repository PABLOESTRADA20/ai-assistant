/**
 * Formateo del indicador de contexto del turno (FASE 3.2).
 *
 * Puro y sin dependencias de runtime: convierte el `ContextInfo` que llega por
 * el SSE en porcentaje de uso del presupuesto y en la etiqueta corta que se
 * muestra bajo el mensaje. Nunca llama a un modelo ni a la red.
 */
import type { ContextInfo } from '@/app/types'
import { formatCompactNumber } from './format'

// Alias de `formatCompactNumber` para no romper imports existentes.
export { formatCompactNumber as formatCompactTokens }

/** Porcentaje de presupuesto ocupado por el prompt estimado, recortado a [0,1]. */
export function contextUsagePercent(ctx: ContextInfo): number {
  if (!ctx.budget || ctx.budget <= 0) return 0
  return Math.min(1, Math.max(0, ctx.promptTokens / ctx.budget))
}

/** Etiqueta corta: `ctx ~3.4k/5k tokens · 68%`. */
export function formatContextUsage(ctx: ContextInfo): string {
  const pct = Math.round(contextUsagePercent(ctx) * 100)
  return `ctx ~${formatCompactNumber(ctx.promptTokens)}/${formatCompactNumber(ctx.budget)} tokens · ${pct}%`
}