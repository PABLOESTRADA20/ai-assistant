import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { deleteNote, getNote, updateNote } from '@/app/lib/notes'

/** Operaciones sobre una nota concreta de la "Carpeta ARIA". */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  const note = await getNote(id)
  if (!note) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
  return NextResponse.json({ note })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  let body: { title?: unknown; content?: unknown; tags?: unknown; pinned?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const note = await updateNote(id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    tags: body.tags,
    pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
  })
  if (!note) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
  // Cerebro: refresca el espejo en Memoria con el contenido nuevo (best-effort).
  const { mirrorNoteToMemory } = await import('@/app/lib/brain')
  await mirrorNoteToMemory(note).catch(() => {})
  return NextResponse.json({ note })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  const ok = await deleteNote(id)
  if (!ok) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
  // Cerebro: retira el espejo en Memoria (best-effort).
  const { removeMirroredNote } = await import('@/app/lib/brain')
  await removeMirroredNote(id).catch(() => {})
  return NextResponse.json({ ok: true })
}
