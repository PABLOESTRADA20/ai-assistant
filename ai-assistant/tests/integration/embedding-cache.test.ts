import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/app/lib/prisma'
import {
  EMBEDDING_DIM,
  embeddingCacheGet,
  embeddingCacheSet,
  hashEmbedText,
} from '@/app/lib/llm-embed'

/**
 * Caché de embeddings contra la BD de pruebas.
 *
 * Reglas del harness:
 *  - sin TEST_DATABASE_URL los tests se OMITEN (tests/setup.ts impide que
 *    DATABASE_URL apunte a producción);
 *  - todo lo creado lleva marcador único y se borra en afterAll;
 *  - NO pasa por `embed()` (el provider local la esquiva): se prueban las
 *    funciones de caché directas, que son las que tocan la tabla.
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)

function vec(value: number): string {
  return `[${Array(EMBEDDING_DIM).fill(value).join(',')}]`
}

describe.skipIf(!RUN)('caché de embeddings (integración)', () => {
  const t1 = `cache integracion uno ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const t2 = `cache integracion dos ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const stale = `cache integracion viejo ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const hashes = [t1, t2, stale].map(hashEmbedText)

  afterAll(async () => {
    for (const h of hashes) {
      await prisma.$executeRaw`DELETE FROM "EmbeddingCache" WHERE "hash" = ${h}`
    }
  })

  it('guarda, recupera y sobrescribe por upsert', async () => {
    await embeddingCacheSet(t1, vec(0.25))
    expect(await embeddingCacheGet(t1)).toBe(vec(0.25))

    await embeddingCacheSet(t1, vec(0.75))
    expect(await embeddingCacheGet(t1)).toBe(vec(0.75))

    expect(await embeddingCacheGet(t2)).toBeNull()
  })

  it('barre entradas vencidas al escribir (sin cron)', async () => {
    await prisma.$executeRaw`
      INSERT INTO "EmbeddingCache" ("hash", "embedding", "createdAt", "usedAt")
      VALUES (${hashEmbedText(stale)}, ${vec(0.5)}::vector, NOW() - INTERVAL '40 days', NOW())
    `

    // Escribir cualquier cosa dispara la limpieza de la tabla completa.
    await embeddingCacheSet(t2, vec(0.4))

    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "EmbeddingCache" WHERE "hash" = ${hashEmbedText(stale)}
    `
    expect(Number(rows[0].count)).toBe(0)
  })
})