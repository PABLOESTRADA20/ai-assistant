import { NextRequest } from 'next/server'
import {
  buildAuthorizeUrl,
  getOAuthConfig,
  newOAuthState,
  parseProvider,
  serializeStateCookie,
} from '@/app/lib/oauth'

/**
 * Inicia el flujo OAuth. El `state` viaja en una cookie HttpOnly y en la URL de
 * autorización: el callback exige que coincidan para evitar CSRF. La cookie no
 * autoriza nada; solo guarda ese nonce durante 10 minutos.
 */
export async function GET(req: NextRequest) {
  const provider = parseProvider(req.nextUrl.searchParams.get('provider'))
  if (!provider) {
    return Response.json(
      { error: 'Proveedor OAuth no válido. Usa github o google.' },
      { status: 400 },
    )
  }
  if (!getOAuthConfig(provider)) {
    return Response.json(
      { error: `OAuth no está configurado para ${provider}.` },
      { status: 503 },
    )
  }

  const state = newOAuthState(provider)
  const url = buildAuthorizeUrl(provider, state, process.env, req.nextUrl.origin)
  // `Response.redirect` devuelve cabeceras inmutables; construimos la respuesta
  // directamente para poder añadir la cookie anti-CSRF.
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': serializeStateCookie(state, process.env.NODE_ENV === 'production'),
      'Cache-Control': 'no-store',
    },
  })
}
