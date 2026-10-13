import { NextResponse } from 'next/server'
import { withAuth, jsonInvalid, readJson } from '@/app/lib/api'
import { deleteNote, getNote, updateNote } from '@/app/lib/notes'

/** Operaciones sobre una nota concreta de la "Carpeta ARIA". */

export const GET = withAuth(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const note = await getNote(id)
  if (!note) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
  return NextResponse.json({ note })
})

export const PUT = withAuth(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await readJson<{ title?: unknown; content?: unknown; tags?: unknown; pinned?: unknown }>(req)
  if (!body) return jsonInvalid()

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
})

export const DELETE = withAuth(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const ok = await deleteNote(id)
  if (!ok) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
  // Cerebro: retira el espejo en Memoria (best-effort).
  const { removeMirroredNote } = await import('@/app/lib/brain')
  await removeMirroredNote(id).catch(() => {})
  return NextResponse.json({ ok: true })
})