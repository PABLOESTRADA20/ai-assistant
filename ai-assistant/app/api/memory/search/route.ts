import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

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