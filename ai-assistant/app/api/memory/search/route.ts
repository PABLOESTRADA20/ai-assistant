import { NextResponse } from 'next/server'
import { withAuth, jsonError } from '@/app/lib/api'

export const POST = withAuth(async (req: Request) => {
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
    return jsonError(err)
  }
})