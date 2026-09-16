'use client'

import { useState } from 'react'
import { Search, FileText, BookOpen, Wrench, Calculator, Clock, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { ToolInvocation } from '@/app/types'
import clsx from 'clsx'

const TOOL_ICONS: Record<string, { icon: typeof Search; label: string }> = {
  web_search: { icon: Search, label: 'Búsqueda web' },
  search_vault: { icon: BookOpen, label: 'Búsqueda en vault' },
  read_note: { icon: FileText, label: 'Leer nota' },
  save_note: { icon: FileText, label: 'Guardar nota' },
  calculate: { icon: Calculator, label: 'Cálculo' },
  get_time: { icon: Clock, label: 'Hora' },
}

function formatArgs(name: string, args: Record<string, unknown>): string {
  if (name === 'web_search' || name === 'search_vault') {
    return typeof args.query === 'string' ? args.query : JSON.stringify(args)
  }
  if (name === 'read_note' || name === 'save_note') {
    return typeof args.path === 'string' ? args.path.replace(/\.md$/, '') : JSON.stringify(args)
  }
  if (name === 'calculate') {
    return typeof args.expression === 'string' ? args.expression : JSON.stringify(args)
  }
  const str = JSON.stringify(args)
  return !str || str === '{}' ? '...' : str.slice(0, 80) + (str.length > 80 ? '…' : '')
}

function formatResult(result: string | undefined): string {
  if (!result) return 'Ejecutando…'
  try {
    const parsed = JSON.parse(result)
    if (parsed.error) return `Error: ${parsed.error}`
    if (parsed.answer) {
      const answer = parsed.answer as string
      return answer.length > 120 ? answer.slice(0, 120) + '…' : answer
    }
    if (parsed.result !== undefined) return `Resultado: ${parsed.result}`
    if (parsed.success) return `Guardado en vault`
    if (Array.isArray(parsed.files)) {
      return `${parsed.files.length} archivos encontrados`
    }
    if (parsed.path && parsed.content !== undefined) {
      const content = parsed.content as string
      return content.length > 120 ? content.slice(0, 120) + '…' : content
    }
    return result.length > 150 ? result.slice(0, 150) + '…' : result
  } catch {
    return result.length > 150 ? result.slice(0, 150) + '…' : result
  }
}

export default function ToolCard({ tool }: { tool: ToolInvocation }) {
  const [expanded, setExpanded] = useState(false)
  const meta = TOOL_ICONS[tool.name] || { icon: Wrench, label: tool.name }
  const Icon = meta.icon

  return (
    <div
      className="rounded-xl overflow-hidden text-xs transition-all duration-200"
      style={{
        background: 'var(--surface-3)',
        border: '1px solid var(--border)',
        opacity: tool.status === 'running' ? 0.8 : 1,
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80 transition cursor-pointer"
        aria-expanded={expanded}
      >
        <span
          className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent-muted)' }}
        >
          <Icon size={12} style={{ color: 'var(--accent)' }} />
        </span>

        <span className="font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
          {meta.label}
        </span>

        {tool.status === 'running' ? (
          <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />
        ) : tool.status === 'error' ? (
          <XCircle size={12} style={{ color: '#f87171' }} />
        ) : (
          <CheckCircle2 size={12} style={{ color: '#4ade80' }} />
        )}

        {expanded ? (
          <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
        ) : (
          <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
        )}
      </button>

      <div
        className={clsx('flex items-center gap-1.5 px-4 pb-2', expanded && 'hidden')}
        style={{ color: 'var(--text-muted)' }}
      >
        <span className="truncate leading-relaxed">
          {tool.status === 'done' ? formatResult(tool.result) : tool.status === 'error' ? formatResult(tool.result) : `Ejecutando ${meta.label.toLowerCase()}…`}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div>
            <span className="block font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Argumentos
            </span>
            <code
              className="block rounded-lg px-2 py-1.5 whitespace-pre-wrap break-all leading-relaxed"
              style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)', fontSize: '0.68rem' }}
            >
              {formatArgs(tool.name, tool.args)}
            </code>
          </div>
          <div>
            <span className="block font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Resultado
            </span>
            <code
              className="block rounded-lg px-2 py-1.5 whitespace-pre-wrap break-all leading-relaxed"
              style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)', fontSize: '0.68rem' }}
            >
              {tool.result || '—'}
            </code>
          </div>
        </div>
      )}
    </div>
  )
}