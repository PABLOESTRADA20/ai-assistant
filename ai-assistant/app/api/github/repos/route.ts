import { NextResponse } from 'next/server'
import { withAuth, jsonInvalid, readJson } from '@/app/lib/api'
import { addRepo, getRepos, hasGithubToken, removeRepo } from '@/app/lib/github'

/**
 * Lista de repositorios de GitHub que ARIA puede leer.
 *
 * Se guarda en la base de datos (tabla `SessionContext` con TTL largo) para que
 * la lista sea la misma desde el PC y desde el móvil, sin migraciones nuevas.
 */

export const GET = withAuth(async () => {
  const repos = await getRepos()
  return NextResponse.json({ repos, tokenConfigured: hasGithubToken() })
})

export const POST = withAuth(async (req: Request) => {
  const body = await readJson<{ repo?: string; note?: string }>(req)
  if (!body) return jsonInvalid()

  const repo = typeof body.repo === 'string' ? body.repo : ''
  if (!repo.trim()) {
    return NextResponse.json({ error: 'Falta el repositorio' }, { status: 400 })
  }

  const result = await addRepo(repo, body.note)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ repos: result.repos, tokenConfigured: hasGithubToken() })
})

export const DELETE = withAuth(async (req: Request) => {
  const body = await readJson<{ repo?: string }>(req)
  // Body vacío o inválido: se interpreta como "no borrar nada".
  const repo = typeof body?.repo === 'string' ? body.repo : ''
  if (!repo.trim()) {
    return NextResponse.json({ error: 'Falta el repositorio a eliminar' }, { status: 400 })
  }

  const repos = await removeRepo(repo)
  return NextResponse.json({ repos, tokenConfigured: hasGithubToken() })
})