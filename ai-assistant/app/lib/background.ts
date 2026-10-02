/**
 * Registra una promesa para que siga viva despues de responder al cliente.
 *
 * En workerd, un promise suelto que resuelve despues de terminar el request se
 * cancela ("Cannot perform I/O on behalf of a different request" -> HTTP 1101)
 * y ademas puede corromper el cliente Prisma compartido. `ctx.waitUntil()` es
 * la forma correcta de decirle al runtime que espere esa tarea.
 *
 * Fuera de Cloudflare (scripts locales, `next dev` en Node) no existe `ctx`, asi
 * que se deja como fire-and-forget. En ambos casos los errores se capturan para
 * no generar un unhandled rejection.
 */
export async function registerBackground(promise: Promise<unknown>): Promise<void> {
  const safe = promise.catch((err) => {
    console.error('Background task failed:', err)
  })

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { ctx } = await getCloudflareContext({ async: true })
    ctx.waitUntil(safe)
  } catch {
    // Fuera del runtime de Cloudflare (scripts locales): fire-and-forget.
  }
}
