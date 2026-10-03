// app/components/ServiceWorkerRegister.tsx
'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker (`/sw.js`). Se hace en el cliente y tras la carga
 * para no competir con el primer render. En desarrollo se omite: cachear el HMR
 * de Next solo trae dolores de cabeza.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* sin SW la app funciona igual */
      })
    }

    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
