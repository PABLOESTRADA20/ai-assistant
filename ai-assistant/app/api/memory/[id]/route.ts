import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  try {
    const body = await req.json()
    const { updateMemory } = await import('@/app/lib/memory')
    const memory = await updateMemory(id, {
      ...(typeof body.type === 'string' ? { type: body.type } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...(typeof body.importance === 'number' ? { importance: body.importance } : {}),
      ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
      ...(Array.isArray(body.tags)
        ? { tags: body.tags.filter((t: unknown): t is string => typeof t === 'string') }
        : {}),
    })
    return NextResponse.json({ memory })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  try {
    const { deleteMemory } = await import('@/app/lib/memory')
    await deleteMemory(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 })
  }
}
