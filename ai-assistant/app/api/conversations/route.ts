import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

const DEFAULT_MODEL = 'openai/gpt-oss-120b'

export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    return NextResponse.json(conversations)
  } catch {
    return NextResponse.json({ error: 'Error al obtener conversaciones' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
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
}
