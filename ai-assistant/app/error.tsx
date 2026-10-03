'use client'

import { useEffect } from 'react'

async function clearAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* recargamos igual */
  }
  window.location.reload()
}

/**
 * Pantalla de error del segmento. Evita el peor escenario —una app congelada
 * sin explicación— mostrando un mensaje y salidas accionables.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('ARIA error:', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        textAlign: 'center',
        background: 'var(--app-bg, #08080b)',
        color: 'var(--text-primary, #f7eef0)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 18 }}>Algo se rompió al cargar</h1>
      <p style={{ margin: 0, maxWidth: 360, fontSize: 14, color: 'var(--text-muted, #b9a7ac)' }}>
        Probá reintentar. Si sigue igual, limpiá los datos del sitio.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => reset()}
          style={{
            padding: '10px 16px',
            borderRadius: 12,
            border: 'none',
            background: '#ff2e4d',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
        <button
          onClick={clearAndReload}
          style={{
            padding: '10px 16px',
            borderRadius: 12,
            border: '1px solid #ff2e4d',
            background: 'transparent',
            color: '#ff2e4d',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Limpiar caché
        </button>
      </div>
    </div>
  )
}
