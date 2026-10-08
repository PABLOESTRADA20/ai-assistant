import { describe, expect, it } from 'vitest'
import { EMBEDDING_CACHE_TTL_MS, hashEmbedText } from '@/app/lib/llm-embed'

/**
 * Clave de la caché de embeddings: pura y sin I/O.
 *
 * Suficiente para unit-testear porque el hash es la única lógica de la caché
 * que no toca la BD (el resto se cubre en la integración con TEST_DATABASE_URL).
 */
describe('hashEmbedText (clave de caché de embeddings)', () => {
  it('es determinista para el mismo texto', () => {
    const text = 'query: cómo indexo el vault de observabilidad'
    expect(hashEmbedText(text)).toBe(hashEmbedText(text))
  })

  it('distingue queries de pasajes y mayúsculas', () => {
    expect(hashEmbedText('query: café')).not.toBe(hashEmbedText('passage: café'))
    expect(hashEmbedText('café')).not.toBe(hashEmbedText('Café'))
  })

  it('devuelve 8 dígitos hexadecimales', () => {
    expect(hashEmbedText('cualquier texto')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('no colisiona en un puñado de textos reales', () => {
    const texts = [
      'query: cuál es la ip del server',
      'query: cuál es la IP del server',
      'passage: la ip del server es 10.0.0.5',
      'passage: el deploy se hace los viernes',
    ]
    const hashes = new Set(texts.map(hashEmbedText))
    expect(hashes.size).toBe(texts.length)
  })

  it('el TTL de la caché es positivo y acotado', () => {
    expect(EMBEDDING_CACHE_TTL_MS).toBeGreaterThan(0)
    expect(EMBEDDING_CACHE_TTL_MS).toBeLessThanOrEqual(90 * 86_400_000)
  })
})