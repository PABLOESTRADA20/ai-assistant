// app/components/SourceChips.tsx
'use client'

import { useState } from 'react'
import { Brain, FileText, FolderOpen, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'
import type { SourceRef } from '@/app/types'
import clsx from 'clsx'

const KIND_META: Record<
  SourceRef['kind'],
  { icon: typeof Brain; label: string; color: string }
> = {
  memory: { icon: Brain, label: 'Memoria', color: '#ff2e4d' },
  note: { icon: FileText, label: 'Nota', color: '#38bdf8' },
  vault: { icon: FolderOpen, label: 'Vault', color: '#a78bfa' },
  message: { icon: MessageSquare, label: 'Mensaje', color: '#4ade80' },
}

/** Formatea el score fusionado [0,1] como porcentaje entero (recortado). */
function formatScore(score: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100)
  return `${pct}%`
}

function SourceChip({ source }: { source: SourceRef }) {
  const [open, setOpen] = useState(false)
  const meta = KIND_META[source.kind] ?? KIND_META.memory
  const Icon = meta.icon
  const hasSnippet = Boolean(source.snippet)

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors',
          hasSnippet && open && 'rounded-b-none',
        )}
        style={{
          background: 'var(--surface-3)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
        title={hasSnippet ? (open ? 'Ocultar detalle' : 'Ver detalle') : source.snippet}
      >
        <Icon size={11} style={{ color: meta.color }} />
        <span className="truncate max-w-[140px]">{source.title ?? meta.label}</span>
        <span style={{ color: meta.color, fontWeight: 600 }}>{formatScore(source.score)}</span>
        {hasSnippet && (open ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </button>
      {hasSnippet && open && (
        <div
          className="text-xs leading-relaxed rounded-b-lg px-2.5 py-2 max-w-[220px]"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderTop: 'none' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>{source.snippet}</span>
        </div>
      )}
    </div>
  )
}

/** Fila de chips con las fuentes del cerebro que ARIA usó en la respuesta. */
export default function SourceChips({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sources.map((s, i) => (
        <SourceChip key={`${s.kind}-${s.id}-${i}`} source={s} />
      ))}
    </div>
  )
}