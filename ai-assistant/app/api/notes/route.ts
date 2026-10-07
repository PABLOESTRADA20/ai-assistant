import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { listNotes, saveNote } from '@/app/lib/notes'

/**
 * "Carpeta ARIA": notas en la nube, listas para exportar a Obsidian.
 *
 * GET  /api/notes?q=...  → lista (búsqueda opcional por título/contenido)
 * POST /api/notes         → guarda o actualiza por título
 */

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  try {
    const q = new URL(req.url).searchParams.get('q') ?? undefined
    const notes = await listNotes(q)
    return NextResponse.json({ notes })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  let body: { title?: unknown; content?: unknown; tags?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
