import { describe, expect, it } from 'vitest'
import { needsReindex } from '@/app/lib/embeddings'

/**
 * Reindexado incremental del vault: qué notas gastan cuota de vectores.
 * Puro, sin disco ni base de datos.
 */
describe('needsReindex', () => {
  it('indexa una nota que todavía no existe', () => {
    expect(needsReindex(undefined, 'contenido')).toBe(true)
  })

  it('indexa una nota que existe pero no tiene vector', () => {
    expect(needsReindex({ content: 'igual', hasEmbedding: false }, 'igual')).toBe(true)
  })

  it('omite una nota con el mismo contenido y vector', () => {
    expect(needsReindex({ content: 'igual', hasEmbedding: true }, 'igual')).toBe(false)
  })

  it('reindexa cuando el contenido cambió', () => {
    expect(needsReindex({ content: 'viejo', hasEmbedding: true }, 'nuevo')).toBe(true)
  })

  it('con force reindexa aunque no haya cambiado', () => {
    expect(needsReindex({ content: 'igual', hasEmbedding: true }, 'igual', true)).toBe(true)
  })
})
