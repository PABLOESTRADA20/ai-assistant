/**
 * Control de acceso de ARIA.
 *
 * Hasta ahora la URL de produccion era publica: cualquiera que la conociera
 * podia gastar la cuota diaria de Groq (200.000 tokens) y leer o escribir
 * conversaciones y memorias en la base de datos. No habia ni login ni limite.
 *
 * El freno minimo y suficiente para ese riesgo es un token compartido. Si el
 * secret `ARIA_ACCESS_TOKEN` esta definido, todas las rutas `/api/*` (salvo
 * `/api/auth`) exigen `Authorization: Bearer <token>`. El cliente lo guarda en
 * `localStorage` y lo envia en cada peticion.
 *
 * Si el secret NO esta definido, la app sigue abierta. Es a proposito:
 *  - permite `next dev` y los scripts locales sin configurar nada;
 *  - evita romper un despliegue existente al actualizar el codigo.
 * La proteccion se activa en cuanto se define el secret.
 */

/** Token configurado, o null si la app esta abierta. */
export function getAccessToken(): string | null {
  const token = process.env.ARIA_ACCESS_TOKEN?.trim()
  return token ? token : null
}

/** True si hay un token configurado (y por tanto hay que autenticarse). */
export function isAuthRequired(): boolean {
  return getAccessToken() !== null
}

/**
 * Comparacion en tiempo constante.
 *
 * Un `===` normal corta en el primer byte distinto, asi que el tiempo de
 * respuesta filtra cuantos caracteres iniciales del token acerto quien prueba.
 * Con suficientes intentos eso permite descubrir el token caracter a caracter.
 * El XOR acumulado recorre siempre la misma longitud.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Token de la peticion: cabecera Bearer o cookie `aria_token` de respaldo. */
function extractToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null
  }
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)aria_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

/** True si la peticion puede pasar. Sin token configurado, siempre. */
export function isAuthorized(req: Request): boolean {
  const token = getAccessToken()
  if (!token) return true
  const provided = extractToken(req)
  return provided !== null && safeEqual(provided, token)
}

/**
 * Devuelve la respuesta 401 si la peticion no esta autorizada, o null si lo
 * esta. Se usa al principio de cada handler:
 *
 *   const denied = requireAuth(req)
 *   if (denied) return denied
 */
export function requireAuth(req: Request): Response | null {
  if (isAuthorized(req)) return null
  return Response.json(
    {
      error: 'Acceso no autorizado. Introduce la clave de ARIA para continuar.',
      code: 'unauthorized',
    },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  )
}
