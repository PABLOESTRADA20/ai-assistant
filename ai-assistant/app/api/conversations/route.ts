import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { withAuth } from '@/app/lib/api'
import { hydrateMessages } from '@/app/lib/persist-messages'

const DEFAULT_MODEL = 'openai/gpt-oss-120b'

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    return NextResponse.json(
      await Promise.all(
        conversations.map(async (conversation) => ({
          ...conversation,
          messages: await hydrateMessages(conversation.messages),
        })),
      ),
    )
  } catch {
    return NextResponse.json({ error: 'Error al obtener conversaciones' }, { status: 500 })
  }
})

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { model = DEFAULT_MODEL } = body
    const conversation = await prisma.conversation.create({
      data: { model },
      include: { messages: true },
    })
    return NextResponse.json(conversation, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Error al crear conversación' }, { status: 500 })
  }
})