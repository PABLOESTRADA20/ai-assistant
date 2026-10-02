import { NextResponse } from 'next/server'
import { requireAuth } from '@/app/lib/auth'

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  try {
    const { getVaultIndex } = await import('@/app/lib/vault-index')
    const index = getVaultIndex(true)
    if (!index) {
      return NextResponse.json({ error: 'VAULT_PATH no configurada' }, { status: 400 })
    }

    let embeddings: {
      ok: boolean
      indexed?: number
      failed?: number
      skipped?: number
      model?: string
      error?: string
    }
    try {
      const { reindexVaultEmbeddings } = await import('@/app/lib/embeddings')
      embeddings = await reindexVaultEmbeddings()
    } catch (err) {
      embeddings = { ok: false, error: String(err) }
    }

    return NextResponse.json({
      ok: true,
      indexed: index.entries.length,
      builtAt: index.builtAt,
      file: index.file,
      embeddings,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}