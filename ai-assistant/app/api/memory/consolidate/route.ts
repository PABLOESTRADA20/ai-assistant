import { NextResponse } from 'next/server'
import { withAuth, jsonError } from '@/app/lib/api'

/**
 * Ejecuta consolidación y olvido a demanda (botón del inspector de memoria).
 * El mismo trabajo se lanza de fondo, de forma perezosa, desde el chat.
 */
export const POST = withAuth(async () => {
  try {
    const { consolidateMemories, getMemoryStats } = await import('@/app/lib/memory')
    const result = await consolidateMemories()
    const stats = await getMemoryStats()
    return NextResponse.json({ ...result, stats })
  } catch (err) {
    return jsonError(err)
  }
})