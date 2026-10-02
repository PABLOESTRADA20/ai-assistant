import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { listMyRepos } from '@/app/lib/github'

/**
 * Lista los repositorios del usuario autenticado en GitHub para que pueda
 * elegir cuáles agregar sin escribir `owner/repo` a mano.
 *
 * Requiere `GITHUB_TOKEN` (fine-grained, solo lectura). Sin token responde con
 * `tokenConfigured: false` y un mensaje explicando cómo configurarlo.
 */
export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  const q = new URL(req.url).searchParams.get('q') ?? ''
  const result = await listMyRepos(q)
  return NextResponse.json(result)
}
