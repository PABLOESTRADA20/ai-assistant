import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { query, limit = 8, minSimilarity = 0 } = body
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query es requerido' }, { status: 400 })
    }

    const { searchSemanticMemories } = await import('@/app/lib/memory')
    const memories = await searchSemanticMemories(
      query,
      Number(limit) || 8,
      Number(minSimilarity) || 0
    )
    return NextResponse.json({ memories })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}