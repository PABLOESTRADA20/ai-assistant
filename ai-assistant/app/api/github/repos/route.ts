import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { addRepo, getRepos, hasGithubToken, removeRepo } from '@/app/lib/github'

/**
 * Lista de repositorios de GitHub que ARIA puede leer.
 *
 * Se guarda en la base de datos (tabla `SessionContext` con TTL largo) para que
 * la lista sea la misma desde el PC y desde el móvil, sin migraciones nuevas.
 */

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  const repos = await getRepos()
  return NextResponse.json({ repos, tokenConfigured: hasGithubToken() })
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  let body: { repo?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const repo = typeof body.repo === 'string' ? body.repo : ''
  if (!repo.trim()) {
    return NextResponse.json({ error: 'Falta el repositorio' }, { status: 400 })
  }

  const result = await addRepo(repo, body.note)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ repos: result.repos, tokenConfigured: hasGithubToken() })
}

export async function DELETE(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  let repo = ''
  try {
    const body = await req.json()
    repo = typeof body.repo === 'string' ? body.repo : ''
  } catch {
    /* body vacío: se interpreta como "no borrar nada" */
  }
  if (!repo.trim()) {
    return NextResponse.json({ error: 'Falta el repositorio a eliminar' }, { status: 400 })
  }

  const repos = await removeRepo(repo)
  return NextResponse.json({ repos, tokenConfigured: hasGithubToken() })
}
