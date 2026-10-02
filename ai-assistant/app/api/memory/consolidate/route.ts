import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

/**
 * Ejecuta consolidación y olvido a demanda (botón del inspector de memoria).
 * El mismo trabajo se lanza de fondo, de forma perezosa, desde el chat.
 */
export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  try {
    const { consolidateMemories, getMemoryStats } = await import('@/app/lib/memory')
    const result = await consolidateMemories()
    const stats = await getMemoryStats()
    return NextResponse.json({ ...result, stats })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
