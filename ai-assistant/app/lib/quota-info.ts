import type { QuotaInfo } from '@/app/types'

/**
 * Helpers puros para el badge de saldo de cuota del día (FASE 3.3).
 * Sin red, sin BD y sin dependencias de React: testables en unit.
 */

/** 6100 -> "6.1k", 999 -> "999", 12000 -> "12k". */
export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1000) {
    const k = n / 1000
    const rounded = k < 100 ? (Math.round(k * 10) / 10).toString() : String(Math.round(k))
    return `${rounded.replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

/** Neurons restantes de la reserva de Workers AI, compactas y nunca negativas. */
export function formatNeuronsRemaining(quota: QuotaInfo): string {
  return formatCompactNumber(Math.max(0, quota.neurons.remaining))
}

/**
 * Etiqueta corta del estado global de Groq: "Groq 3/4" si hay modelos con
 * cuota, "Groq agotado" si todos están sin cuota.
 */
export function groqStatusLabel(groq: QuotaInfo['groq']): string {
  if (groq.available > 0) return `Groq ${groq.available}/${groq.total}`
  return 'Groq agotado'
}

/** ISO -> "HH:mm" UTC para el countdown de recuperación. Vacío si el ISO no vale. */
export function formatHourMinute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Tooltip completo del badge. */
export function quotaTooltip(quota: QuotaInfo): string {
  const neurons = [
    `Workers AI: ${formatNeuronsRemaining(quota)} neuronas hoy`,
    `de ${formatCompactNumber(quota.neurons.budget)} (compartidas chat + embeddings)`,
  ].join(' ')
  const until = quota.groq.until ? formatHourMinute(quota.groq.until) : ''
  const groq = quota.groq.available > 0
    ? groqStatusLabel(quota.groq)
    : `Groq sin cuota${until ? ` · vuelve ${until} UTC` : ''}`
  return `${neurons} · ${groq}`
}