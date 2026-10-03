import { catalogWithAvailability } from '@/app/lib/providers'

/**
 * Catalogo publico de modelos.
 *
 * La app (web y celular) lo consulta al arrancar para mostrar solo los modelos
 * que de verdad pueden responder: los que no necesitan clave siempre estan, y
 * los que dependen de una API key aparecen recien cuando esa clave esta
 * configurada en el Worker. No revela nada sensible (ni las claves ni su valor).
 */
export async function GET() {
  return Response.json(
    { models: catalogWithAvailability() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
