import { NextResponse } from 'next/server'
import { withAuth, jsonError } from '@/app/lib/api'

export const GET = withAuth(async (req) => {
  try {
    const { getVaultIndex } = await import('@/app/lib/vault-index')
    const index = getVaultIndex(true)
    if (!index) {
      return NextResponse.json({ error: 'VAULT_PATH no configurada' }, { status: 400 })
    }

    // `?force=1` reindexa aunque el contenido no haya cambiado; sin él, la
    // pasada es incremental y solo gasta cuota en las notas nuevas o cambiadas.
    const force = new URL(req.url).searchParams.get('force') === '1'

    let embeddings: {
      ok: boolean
      indexed?: number
      failed?: number
      skipped?: number
      unchanged?: number
      model?: string
      error?: string
    }
    try {
      const { reindexVaultEmbeddings } = await import('@/app/lib/embeddings')
      embeddings = await reindexVaultEmbeddings({ force })
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
    return jsonError(err)
  }
})