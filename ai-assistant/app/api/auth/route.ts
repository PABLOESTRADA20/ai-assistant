import { isAuthRequired } from '@/app/lib/auth'

/**
 * Endpoint publico que le dice al cliente si la app pide clave.
 *
 * No revela el token ni nada sensible: solo si `ARIA_ACCESS_TOKEN` esta
 * configurado. El cliente lo consulta al arrancar para decidir si muestra la
 * pantalla de acceso o entra directo.
 */
export async function GET() {
  return Response.json({ required: isAuthRequired() })
}
