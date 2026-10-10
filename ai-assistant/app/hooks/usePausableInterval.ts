// app/hooks/usePausableInterval.ts
'use client'

import { useEffect, useRef } from 'react'

/**
 * `setInterval` que se pausa mientras la pestaña está oculta y se reanuda
 * —con un disparo inmediato— al volver a visible (T3 de la fase de rendimiento).
 *
 * Evita pegarle a la red y re-renderizar en segundo plano. Pasar `delayMs: null`
 * desactiva el timer. El `callback` puede cambiar en cada render: se guarda en
 * un ref y el intervalo siempre invoca la última versión.
 */
export function usePausableInterval(callback: () => void, delayMs: number | null) {
  const saved = useRef(callback)

  useEffect(() => {
    saved.current = callback
  }, [callback])

  useEffect(() => {
    if (delayMs === null || typeof document === 'undefined') return

    let id: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (id === null) id = setInterval(() => saved.current(), delayMs)
    }
    const stop = () => {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop()
      } else {
        // Al volver a la pestaña: refrescamos enseguida y reanudamos la cadencia.
        saved.current()
        start()
      }
    }

    if (document.visibilityState === 'hidden') {
      stop()
    } else {
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [delayMs])
}
