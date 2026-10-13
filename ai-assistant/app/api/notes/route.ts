import { NextResponse } from 'next/server'
import { withAuth, jsonError, jsonInvalid, readJson } from '@/app/lib/api'
import { listNotes, saveNote } from '@/app/lib/notes'

/**
 * "Carpeta ARIA": notas en la nube, listas para exportar a Obsidian.
 *
 * GET  /api/notes?q=...  → lista (búsqueda opcional por título/contenido)
 * POST /api/notes         → guarda o actualiza por título
 */

export const GET = withAuth(async (req: Request) => {
  try {
    const q = new URL(req.url).searchParams.get('q') ?? undefined
    const notes = await listNotes(q)
    return NextResponse.json({ notes })
  } catch (err) {
    return jsonError(err)
  }
})

export const POST = withAuth(async (req: Request) => {
  const body = await readJson<{ title?: unknown; content?: unknown; tags?: unknown }>(req)
  if (!body) return jsonInvalid()

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'Falta el título de la nota' }, { status: 400 })
  }

  try {
    const note = await saveNote({
      title: body.title,
      content: typeof body.content === 'string' ? body.content : '',
      tags: body.tags,
      source: 'web',
    })
    // Cerebro: indexa la nota como memoria para que la búsqueda unificada y el
    // contexto la encuentren (best-effort, no debe frenar el guardado).
    const { mirrorNoteToMemory } = await import('@/app/lib/brain')
    await mirrorNoteToMemory(note).catch(() => {})
    return NextResponse.json({ note })
  } catch (err) {
    return jsonError(err)
  }
})