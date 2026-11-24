import { isAuthRequired } from '@/app/lib/auth'
import { configuredOAuthProviders } from '@/app/lib/oauth'

/**
 * Endpoint publico que le dice al cliente si la app pide clave y con qué
 * proveedores OAuth puede entrar.
 *
 * No revela el token ni los client_id/secret: solo booleanos y la lista de
 * proveedores configurados. El cliente lo consulta al arrancar para decidir si
 * muestra la pantalla de acceso y qué botones ofrece.
 */
export async function GET() {
  return Response.json({
    required: isAuthRequired(),
    providers: configuredOAuthProviders(),
  })
}
