import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

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