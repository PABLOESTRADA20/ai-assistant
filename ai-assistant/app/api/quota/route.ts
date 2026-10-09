import { MODEL_CATALOG, isModelAvailable } from '@/app/lib/providers'
import {
  FALLBACK_NEURON_BUDGET,
  getFallbackBudget,
  getQuotaMap,
  latestGroqQuotaUntil,
  type QuotaMap,
} from '@/app/lib/quota'

/**
 * Saldo de cuota del día para el badge del header (FASE 3.3).
 *
 * Es público como /api/models (no revela nada sensible: solo contadores) y
 * barato: cada valor sale de una lectura de `SessionContext`, nunca de una
 * llamada a un proveedor. Refleja lo que ARIA ya sabe de verdad:
 *
 *   - neuronas de la reserva de Workers AI gastadas hoy (contador propio,
 *     compartido por el chat y los embeddings desde la FASE 2.4);
 *   - qué modelos de Groq están con la cuota diaria agotada y hasta cuándo
 *     (Groq no expone "tokens restantes" sin una llamada: no se inventa).
 */
export async function GET() {
  const [fallback, quota] = await Promise.all([
    getFallbackBudget().catch(() => ({ day: '', neurons: 0 })),
    getQuotaMap().catch(() => ({}) as QuotaMap),
  ])

  const now = Date.now()
  const groqModels = MODEL_CATALOG.filter((m) => m.provider.id === 'groq')
  const exhausted = groqModels
    .filter((m) => {
      const until = quota[m.id]
      return Boolean(until) && Date.parse(until as string) > now
    })
    .map((m) => m.id)
  const available = groqModels.filter(
    (m) => isModelAvailable(m.id) && !exhausted.includes(m.id),
  ).length
  const until = exhausted.length > 0 ? await latestGroqQuotaUntil().catch(() => null) : null

  return Response.json(
    {
      neurons: {
        used: fallback.neurons,
        budget: FALLBACK_NEURON_BUDGET,
        remaining: Math.max(0, FALLBACK_NEURON_BUDGET - fallback.neurons),
      },
      groq: {
        total: groqModels.length,
        available,
        exhausted,
        until,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}