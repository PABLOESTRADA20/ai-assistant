import { NextResponse } from 'next/server'
import { withAuth, jsonError } from '@/app/lib/api'

export const PATCH = withAuth(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
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
    return jsonError(err, 400)
  }
})

export const DELETE = withAuth(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  try {
    const { deleteMemory } = await import('@/app/lib/memory')
    await deleteMemory(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return jsonError(err, 404)
  }
})