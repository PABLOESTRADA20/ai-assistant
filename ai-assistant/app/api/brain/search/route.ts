import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

/**
 * Búsqueda unificada del cerebro: memoria a largo plazo + notas de la carpeta
 * de ARIA + vault de Obsidian + mensajes de la conversación indicada.
 *
 *  POST /api/brain/search
 *  { query: string, limit?: number, minScore?: number, conversationId?: string }
 *
 * Devuelve `{ hits: BrainHit[] }`, cada uno con `kind` ('memory' | 'note' |
 * 'vault' | 'message'), `content`, `snippet`, `score` (0..1) y origen.
 */
export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  try {
    const body = (await req.json()) as {
      query?: unknown
      limit?: unknown
      minScore?: unknown
      conversationId?: unknown
    }
    if (typeof body.query !== 'string' || !body.query.trim()) {
      return NextResponse.json({ error: 'query es requerido' }, { status: 400 })
    }

    const { searchBrain } = await import('@/app/lib/brain')
    const hits = await searchBrain(body.query, {
      limit: Number(body.limit) || 8,
      minScore: typeof body.minScore === 'number' ? body.minScore : 0,
      conversationId:
        typeof body.conversationId === 'string' && body.conversationId
          ? body.conversationId
          : null,
    })
    return NextResponse.json({ hits })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}