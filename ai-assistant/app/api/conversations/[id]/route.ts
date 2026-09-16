import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })
    }
    return NextResponse.json(conversation)
  } catch {
    return NextResponse.json({ error: 'Error al obtener conversación' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json()
    const { title, messages } = body

    const data: Record<string, unknown> = {}
    if (title) data.title = title

    if (messages && Array.isArray(messages)) {
      await prisma.message.deleteMany({ where: { conversationId: id } })
      for (const msg of messages) {
        await prisma.message.create({
          data: {
            id: msg.id,
            conversationId: id,
            role: msg.role,
            content: msg.content,
            model: msg.model || null,
            createdAt: new Date(msg.createdAt),
          },
        })
      }
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data,
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })

    return NextResponse.json(conversation)
  } catch {
    return NextResponse.json({ error: 'Error al actualizar conversación' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await prisma.conversation.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar conversación' }, { status: 500 })
  }
}
