import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { withAuth } from '@/app/lib/api'
import { hydrateMessages, persistMessages } from '@/app/lib/persist-messages'

export const GET = withAuth(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
})

export const PUT = withAuth(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
})

export const DELETE = withAuth(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    await prisma.conversation.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar conversación' }, { status: 500 })
  }
})