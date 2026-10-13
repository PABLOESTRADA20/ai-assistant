/**
 * Ayudantes comunes para los handlers de `/api/*`.
 *
 * Antes cada ruta repetía el mismo preámbulo (`const denied = requireAuth(req);
 * if (denied) return denied`), el mismo `catch` con `{ error: String(err) }` y
 * la misma validación de cuerpo `'JSON inválido'`. Acá quedan centralizados.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

/** Contexto que Next.js pasa a las rutas dinámicas (`params` de `[id]`). */
type RouteContext = { params: Promise<Record<string, string>> }

/**
 * Envuelve un handler de ruta aplicándole `requireAuth` al inicio:
 *
 *   export const GET = withAuth(async (req) => { ... })
 *
 * La petición no autorizada responde 401 antes de ejecutar el cuerpo. El
 * contexto de ruta (`{ params }`) se pasa intacto al handler.
 */
export function withAuth<Ctx = RouteContext, Req extends Request = Request>(
  handler: (req: Req, ctx: Ctx) => Promise<Response> | Response,
): (req: Req, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const denied = requireAuth(req)
    if (denied) return denied
    return handler(req, ctx)
  }
}

/** Respuesta JSON de error `{ error }` con el status indicado (500 por defecto). */
export function jsonError(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: String(error) }, { status })
}

/** 400 estándar cuando el cuerpo de la petición no era JSON válido. */
export function jsonInvalid(): NextResponse {
  return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
}

/** Deserializa el cuerpo JSON; `null` si no era JSON válido. */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}