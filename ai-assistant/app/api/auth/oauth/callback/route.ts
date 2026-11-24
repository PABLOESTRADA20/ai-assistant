import { NextRequest } from 'next/server'
import { TOKEN_KEY } from '@/app/lib/auth-client'
import {
  clearStateCookie,
  createSessionToken,
  exchangeCode,
  fetchIdentity,
  getOAuthConfig,
  isAllowedIdentity,
  providerFromState,
  readStateCookie,
  redirectUriFor,
  safeEqual,
} from '@/app/lib/oauth'

/** Escapa texto antes de meterlo en HTML (los mensajes son fijos, pero por si acaso). */
function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char)
}

/**
 * Página de vuelta del OAuth. El token de sesión se entrega por `localStorage`
 * (nunca en la URL, para que no quede en historiales ni logs) y la sesión
 * viaja después en `Authorization: Bearer`, igual que la clave compartida.
 * La cookie de estado se borra siempre, incluso si el flujo falla.
 */
function oauthPage(title: string, message: string, status: number, session?: string): Response {
  const script = session
    ? `<script>
try {
  localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(session)});
  location.replace('/');
} catch (e) {
  document.getElementById('aria-oauth-error').textContent =
    'El navegador bloqueó el almacenamiento; no se pudo guardar la sesión.';
}
</script>`
    : ''
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · ARIA</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b10;color:#eee">
  <main style="max-width:32rem;padding:2rem;text-align:center">
    <h1>${escapeHtml(title)}</h1>
    <p id="aria-oauth-error">${escapeHtml(message)}</p>
  </main>
  ${script}
</body></html>`

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearStateCookie(process.env.NODE_ENV === 'production'),
    },
  })
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state') ?? ''
  const expected = readStateCookie(req)
  if (!state || !expected || !safeEqual(state, expected)) {
    return oauthPage('Acceso denegado', 'El estado de acceso no coincide. Vuelve a intentarlo.', 400)
  }

  const provider = providerFromState(state)
  if (!provider) {
    return oauthPage('Acceso denegado', 'El estado de acceso no es válido.', 400)
  }

  const code = req.nextUrl.searchParams.get('code') ?? ''
  if (!code) {
    return oauthPage('Acceso denegado', 'Falta el código de autorización.', 400)
  }

  const config = getOAuthConfig(provider)
  if (!config) {
    return oauthPage('Acceso no disponible', `OAuth no está configurado para ${provider}.`, 503)
  }

  let identity
  try {
    const token = await exchangeCode(
      provider,
      code,
      config,
      redirectUriFor(provider, process.env, req.nextUrl.origin),
    )
    identity = await fetchIdentity(provider, token)
  } catch (err) {
    return oauthPage(
      'Acceso no disponible',
      `No pude completar el acceso con ${provider}: ${String(err).slice(0, 200)}`,
      502,
    )
  }

  // Lista blanca de una sola persona: un token válido de Google/GitHub no basta.
  if (!isAllowedIdentity(identity, config)) {
    return oauthPage('Acceso denegado', 'Esta identidad no tiene acceso a ARIA.', 403)
  }

  const session = await createSessionToken(identity)
  if (!session) {
    return oauthPage(
      'Acceso no disponible',
      'Falta ARIA_SESSION_SECRET (o ARIA_ACCESS_TOKEN) para firmar la sesión.',
      503,
    )
  }

  return oauthPage('Acceso concedido', 'Entrando en ARIA…', 200, session)
}
