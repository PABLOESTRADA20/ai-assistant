'use client'

import { Zap } from 'lucide-react'
import type { QuotaInfo } from '@/app/types'
import {
  formatHourMinute,
  formatNeuronsRemaining,
  groqStatusLabel,
  quotaTooltip,
} from '@/app/lib/quota-info'

/**
 * Badge compacto del saldo de cuota del día (FASE 3.3).
 *
 * Muestra las neuronas restantes de Workers AI (compartidas chat +
 * embeddings) y el estado global de Groq. En pantallas chicas se colapsa a
 * un destello con tooltip para que el header no se amontone.
 */
export default function QuotaBadge({ quota }: { quota: QuotaInfo | null }) {
  if (!quota) return null

  const neuronsLeft = Math.max(0, quota.neurons.remaining) > 0
  const neuronsLow = quota.neurons.remaining <= quota.neurons.budget * 0.2
  const groqOk = quota.groq.available > 0
  const until = quota.groq.until ? formatHourMinute(quota.groq.until) : ''

  return (
    <button
      type="button"
      title={quotaTooltip(quota)}
      aria-label={quotaTooltip(quota)}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-xs transition hover:opacity-70 cursor-help flex-shrink-0"
      style={{
        color: 'var(--text-muted)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      <Zap
        size={12}
        strokeWidth={2.5}
        style={{ color: neuronsLeft ? (neuronsLow ? '#eab308' : 'var(--accent)') : '#f43f5e' }}
      />
      <span className="hidden sm:inline">
        {neuronsLeft ? `${formatNeuronsRemaining(quota)} neuronas` : 'sin reserva'}
      </span>
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: groqOk ? '#22c55e' : '#f59e0b' }}
        aria-hidden="true"
      />
      <span className="hidden md:inline text-[11px]">
        {groqOk ? groqStatusLabel(quota.groq) : `Groq ${until || 'agotado'}`}
      </span>
    </button>
  )
}