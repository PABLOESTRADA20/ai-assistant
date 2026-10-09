import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { requireAuth } from '@/app/lib/auth'
import { hydrateMessages, persistMessages } from '@/app/lib/persist-messages'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })
    }
    return NextResponse.json({
      ...conversation,
      messages: await hydrateMessages(conversation.messages),
    })
  } catch {
    return NextResponse.json({ error: 'Error al obtener conversación' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  try {
    const body = await req.json()
    const { title, messages, model } = body

    const data: Record<string, unknown> = {}
    if (title) data.title = title
    if (typeof model === 'string' && model) data.model = model

    if (messages && Array.isArray(messages)) {
      await persistMessages(id, messages)
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data,
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })

    return NextResponse.json({
      ...conversation,
      messages: await hydrateMessages(conversation.messages),
    })
  } catch {
    return NextResponse.json({ error: 'Error al actualizar conversación' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  try {
    await prisma.conversation.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar conversación' }, { status: 500 })
  }
}
