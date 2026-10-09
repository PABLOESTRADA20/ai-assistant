/**
 * Formateo del indicador de contexto del turno (FASE 3.2).
 *
 * Puro y sin dependencias de runtime: convierte el `ContextInfo` que llega por
 * el SSE en porcentaje de uso del presupuesto y en la etiqueta corta que se
 * muestra bajo el mensaje. Nunca llama a un modelo ni a la red.
 */
import type { ContextInfo } from '@/app/types'

/** Porcentaje de presupuesto ocupado por el prompt estimado, recortado a [0,1]. */
export function contextUsagePercent(ctx: ContextInfo): number {
  if (!ctx.budget || ctx.budget <= 0) return 0
  return Math.min(1, Math.max(0, ctx.promptTokens / ctx.budget))
}

/** 1.234 → "1.2k"; 10.000 → "10k"; 12.500 → "12.5k"; 850 → "850". */
export function formatCompactTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    const s = k < 100 ? k.toFixed(1) : String(Math.round(k))
    return `${s.endsWith('.0') ? s.slice(0, -2) : s}k`
  }
  return String(Math.round(n))
}

/** Etiqueta corta: `ctx ~3.4k/5k tokens · 68%`. */
export function formatContextUsage(ctx: ContextInfo): string {
  const pct = Math.round(contextUsagePercent(ctx) * 100)
  return `ctx ~${formatCompactTokens(ctx.promptTokens)}/${formatCompactTokens(ctx.budget)} tokens · ${pct}%`
}