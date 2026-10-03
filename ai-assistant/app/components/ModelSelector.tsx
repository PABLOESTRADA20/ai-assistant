// app/components/ModelSelector.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { AVAILABLE_MODELS, AIModel } from '@/app/types'

interface Props {
  value: string
  onChange: (model: string) => void
}

export default function ModelSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<AIModel[]>(AVAILABLE_MODELS)
  const ref = useRef<HTMLDivElement>(null)

  const current = models.find((m) => m.id === value) || models[0]

  // El servidor dice que modelos pueden responder (los gratis sin clave y los
  // que ya tienen clave configurada). Si no responde, se usa la lista local.
  useEffect(() => {
    let alive = true
    fetch('/api/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data || !Array.isArray(data.models)) return
        const available: AIModel[] = data.models
          .filter((m: { available?: boolean }) => m.available !== false)
          .map((m: AIModel) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            badge: m.badge,
          }))
        if (available.length) setModels(available)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm transition-all duration-200 hover:opacity-80"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        <Cpu size={13} style={{ color: 'var(--accent)' }} />
        <span className="font-medium text-xs hidden sm:inline">{current.name}</span>
        <ChevronDown
          size={12}
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 right-0 w-64 max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden z-50 animate-fade-in"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
          }}
        >
          {models.map((model: AIModel) => (
            <button
              key={model.id}
              onClick={() => { onChange(model.id); setOpen(false) }}
              className="w-full px-4 py-3 flex flex-col gap-0.5 text-left transition-all duration-150 hover:opacity-80"
              style={{
                background: model.id === value ? 'var(--accent-muted)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-sm font-medium"
                  style={{ color: model.id === value ? 'var(--accent)' : 'var(--text-primary)' }}
                >
                  {model.name}
                </span>
                {model.id === value && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    Activo
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {model.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
