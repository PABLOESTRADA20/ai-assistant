// app/components/InstallButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Share, Plus } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Platform = 'ios' | 'android' | 'desktop'

/** Lee el evento capturado por el script temprano del layout. */
function readCaptured(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { __ariaBIP?: BeforeInstallPromptEvent }).__ariaBIP ?? null
}

function detectPlatform(): Platform {
  const ua = window.navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPadOS moderno se declara como Mac; se detecta por el táctil.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

/**
 * Botón "Instalar" del header.
 *
 * A diferencia de la versión anterior, ya no depende de `beforeinstallprompt`:
 * ese evento solo existe en navegadores Chromium, así que en Firefox u otros
 * el botón no aparecía. Ahora:
 *
 *   - Si hay evento nativo (Chrome/Edge/Samsung) se lanza el diálogo del sistema.
 *   - Si no, se muestran instrucciones acordes a la plataforma.
 *
 * El layout registra un script temprano que guarda el evento antes de que React
 * hidrate, para no perderlo si el navegador lo dispara muy pronto.
 */
export default function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return

    setPlatform(detectPlatform())
    const captured = readCaptured()
    if (captured) setDeferred(captured)
    setVisible(true)

    const onBip = () => {
      const e = readCaptured()
      if (e) setDeferred(e)
      setVisible(true)
    }
    const onInstalled = () => setVisible(false)

    window.addEventListener('aria:bip', onBip)
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('aria:bip', onBip)
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
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
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') setVisible(false)
      setDeferred(null)
      ;(window as unknown as { __ariaBIP?: BeforeInstallPromptEvent }).__ariaBIP = undefined
      return
    }
    setOpen((o) => !o)
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

      {open && (
        <div
          className="absolute top-full mt-2 right-0 w-64 rounded-2xl p-3 z-[70] animate-fade-in"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}
        >
          <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
            Instalar ARIA en el celular
          </p>

          {platform === 'ios' ? (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              1. Tocá <Share size={11} className="inline" style={{ color: 'var(--accent)' }} /> Compartir
              en Safari.
              <br />
              2. Elegí{' '}
              <span className="inline-flex items-center gap-0.5">
                <Plus size={11} style={{ color: 'var(--accent)' }} /> Añadir a pantalla de inicio
              </span>
              .
            </p>
          ) : platform === 'android' ? (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Abrí el menú <span style={{ color: 'var(--accent)' }}>⋮</span> del navegador y elegí{' '}
              <b style={{ color: 'var(--text-primary)' }}>Instalar app</b> o{' '}
              <b style={{ color: 'var(--text-primary)' }}>Añadir a pantalla de inicio</b>.
            </p>
          ) : (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              En la barra de direcciones tocá el ícono de instalar, o en el menú del navegador elegí{' '}
              <b style={{ color: 'var(--text-primary)' }}>Instalar ARIA</b>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
