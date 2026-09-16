import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const type = url.searchParams.get('type') || undefined
  const category = url.searchParams.get('category') || undefined
  const minImportance = url.searchParams.get('minImportance')
    ? Number(url.searchParams.get('minImportance'))
    : undefined
  const limit = Number(url.searchParams.get('limit') || 20)

  try {
    const { searchMemories } = await import('@/app/lib/memory')
    const memories = await searchMemories({ type, category, minImportance, limit })
    return NextResponse.json({ memories, total: memories.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { type, category, content, importance, confidence, tags, source } = body
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content es requerido' }, { status: 400 })
    }

    const { createMemory } = await import('@/app/lib/memory')
    const memory = await createMemory({
      type: typeof type === 'string' ? type : 'factual',
      category: typeof category === 'string' ? category : 'fact',
      content,
      importance: typeof importance === 'number' ? importance : 0.5,
      confidence: typeof confidence === 'number' ? confidence : 0.6,
      tags: Array.isArray(tags) ? tags : [],
      source: typeof source === 'string' ? source : 'manual',
    })
    return NextResponse.json({ memory }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}