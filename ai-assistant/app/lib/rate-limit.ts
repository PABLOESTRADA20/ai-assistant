/**
 * Rate limiting nativo de Cloudflare Workers (binding `ratelimits`).
 *
 * Por que: con la clave de acceso ya nadie anonimo puede gastar la cuota, pero
 * si la clave se filtra (una captura, un portapapeles compartido) se puede
 * vaciar la cuota diaria de Groq en minutos. El binding frena eso sin tocar la
 * base de datos: los contadores viven en el propio Cloudflare location y la
 * llamada no es una peticion de red, asi que no añade latencia apreciable.
 *
 * La API es "permissive y eventualmente consistente" a proposito (lo dice la
 * documentacion): no es un sistema de contabilidad exacto, es una barrera.
 * Si el binding no existe (dev local, o el plan no lo soporta), no se bloquea
 * nada: la app sigue funcionando.
 */

type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

/**
 * Aplica el limite indicado. Devuelve una respuesta 429 si se supero, o null
 * si la peticion puede continuar.
 *
 * @param req        peticion actual (para sacar el path como clave)
 * @param bindingName nombre del binding definido en wrangler.jsonc
 */
export async function rateLimit(req: Request, bindingName: string): Promise<Response | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    const binding = (env as unknown as Record<string, RateLimitBinding | undefined>)[bindingName]
    if (!binding) return null

    // Clave por ruta: con un solo usuario basta con separar chat de dictado.
    // Si algun dia hay varias cuentas, aqui iria el id de usuario.
    const key = new URL(req.url).pathname
    const { success } = await binding.limit({ key })
    if (!success) {
      return Response.json(
        {
          error: 'Demasiadas peticiones seguidas. Espera unos segundos e intentalo de nuevo.',
          code: 'rate_limited',
        },
        { status: 429, headers: { 'Retry-After': '10' } },
      )
    }
  } catch (err) {
    // Nunca tumbar una peticion por un fallo del contador.
    console.error('Rate limit error:', err)
  }
  return null
}
