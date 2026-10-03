// app/components/InstallButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Share, Plus } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Botón "Instalar" para el header.
 *
 * - Android/Chrome: captura `beforeinstallprompt` y lanza el diálogo nativo.
 * - iOS: ese evento no existe, así que abre un popover con los pasos manuales.
 * - Si ya está instalada (standalone) el botón no se muestra.
 */
export default function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [ios, setIos] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return

    const ua = window.navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
    if (isIos) {
      setIos(true)
      setVisible(true)
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt()
      await deferred.userChoice
      setDeferred(null)
      setVisible(false)
      return
    }
    setOpen((p) => !p)
  }

  if (!visible) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleClick}
        title="Instalar ARIA como app"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition hover:opacity-80 cursor-pointer"
        style={{
          background: 'var(--accent-muted)',
          border: '1px solid rgba(255,46,77,0.35)',
          color: 'var(--accent)',
        }}
      >
        <Download size={12} />
        <span className="hidden sm:inline">Instalar</span>
      </button>

      {open && ios && (
        <div
          className="absolute top-full mt-2 right-0 w-60 rounded-2xl p-3 z-50 animate-fade-in"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        >
          <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
            Instalar en iPhone
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            1. Tocá <Share size={11} className="inline" style={{ color: 'var(--accent)' }} /> Compartir en Safari.
            <br />
            2. Elegí{' '}
            <span className="inline-flex items-center gap-0.5">
              <Plus size={11} style={{ color: 'var(--accent)' }} /> Añadir a pantalla de inicio
            </span>
            .
          </p>
        </div>
      )}
    </div>
  )
}
