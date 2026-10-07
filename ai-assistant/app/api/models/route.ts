import { catalogWithAvailability } from '@/app/lib/providers'
import { getQuotaMap } from '@/app/lib/quota'

/**
 * Catalogo publico de modelos.
 *
 * La app (web y celular) lo consulta al arrancar para mostrar solo los modelos
 * que de verdad pueden responder: los que no necesitan clave siempre estan, y
 * los que dependen de una API key aparecen recien cuando esa clave esta
 * configurada en el Worker. No revela nada sensible (ni las claves ni su valor).
 *
 * Ademas, los modelos de Groq cuya cuota diaria esta agotada salen con
 * `available: false` y su `until`, para que el selector los muestre apagados
 * con la cuenta regresiva en vez de mandar al usuario a un 429.
 */
export async function GET() {
  const quota = await getQuotaMap().catch(() => ({}))
  return Response.json(
    { models: catalogWithAvailability(quota) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
