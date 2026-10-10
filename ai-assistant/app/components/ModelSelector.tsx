// app/components/ModelSelector.tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { AVAILABLE_MODELS, AIModel } from '@/app/types'
import { usePausableInterval } from '@/app/hooks/usePausableInterval'

interface Props {
  value: string
  onChange: (model: string) => void
}

export default function ModelSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<AIModel[]>(AVAILABLE_MODELS)
  const ref = useRef<HTMLDivElement>(null)

  const current = models.find((m) => m.id === value) || models[0]

  // El servidor dice qué modelos pueden responder (los gratis sin clave y los
  // que ya tienen clave configurada). Si no responde, se usa la lista local.
  // La lista no se filtra: un modelo sin cuota queda visible pero apagado, y se
  // refresca cada 2 min —pausado con la pestaña oculta (T3)— + al reenfocar,
  // para que reaparezca al volver su cuota diaria.
  const load = useCallback(() => {
    fetch('/api/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.models)) return
        const available: AIModel[] = data.models.map((m: AIModel) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          badge: m.badge,
          available: m.available !== false,
          quotaUntil: typeof m.quotaUntil === 'string' ? m.quotaUntil : undefined,
        }))
        if (available.length) setModels(available)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  usePausableInterval(load, 120_000)

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
          {models.map((model: AIModel) => {
            const outOfQuota = model.available === false && model.id !== value
            return (
              <button
                key={model.id}
                disabled={outOfQuota}
                onClick={() => { onChange(model.id); setOpen(false) }}
                className="w-full px-4 py-3 flex flex-col gap-0.5 text-left transition-all duration-150 hover:opacity-80"
                style={{
                  background: model.id === value ? 'var(--accent-muted)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  opacity: outOfQuota ? 0.55 : 1,
                  cursor: outOfQuota ? 'not-allowed' : 'pointer',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: model.id === value ? 'var(--accent)' : 'var(--text-primary)' }}
                  >
                    {model.name}
                  </span>
                  {model.id === value && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      Activo
                    </span>
                  )}
                  {outOfQuota && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(255,107,107,0.15)', color: '#ff6b6b' }}
                    >
                      {model.quotaUntil && Date.parse(model.quotaUntil) > Date.now()
                        ? 'Sin cuota'
                        : 'Vuelve en breve'}
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {model.description}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
