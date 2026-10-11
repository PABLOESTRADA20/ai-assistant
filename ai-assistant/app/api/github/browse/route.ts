import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { listMyRepos } from '@/app/lib/github'

/**
 * Lista repositorios para agregar al panel.
 *
 * - Con `GITHUB_TOKEN`: los repos del usuario autenticado (públicos + privados).
 * - Sin token: si llega `?user=<usuario>`, los repos PÚBLICOS de ese usuario
 *   (fallback sin token). Si no llega, responde pidiendo el usuario.
 */
export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  const params = new URL(req.url).searchParams
  const q = params.get('q') ?? ''
  const user = params.get('user') ?? ''
  const result = await listMyRepos(q, 100, user || undefined)
  return NextResponse.json(result)
}
