'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/app/lib/auth-client'
import type { QuotaInfo } from '@/app/types'

/**
 * Saldo de cuota del día para el badge del header (FASE 3.3).
 *
 * Refresca al montar, cada `refreshMs` y a demanda (`refresh`) tras cada
 * turno terminado, porque el chat y los embeddings gastan neuronas en el
 * servidor. Best-effort: si el endpoint falla, se queda con los últimos
 * datos o con null (el badge simplemente no se pinta).
 */
export function useQuota(refreshMs = 5 * 60_000) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/quota')
      if (!res.ok) return
      setQuota((await res.json()) as QuotaInfo)
    } catch {
      // Sin cuota visible no se rompe nada.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), refreshMs)
    return () => clearInterval(timer)
  }, [refresh, refreshMs])

  return { quota, refresh }
}