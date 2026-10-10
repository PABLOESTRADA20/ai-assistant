'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/app/lib/auth-client'
import { usePausableInterval } from '@/app/hooks/usePausableInterval'
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
  }, [refresh])

  // Refresca cada `refreshMs`, pero se pausa con la pestaña oculta y hace un
  // refresh inmediato al volver (T3).
  usePausableInterval(() => void refresh(), refreshMs)

  return { quota, refresh }
}