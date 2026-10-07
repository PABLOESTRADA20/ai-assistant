import { describe, expect, it } from 'vitest'
import { lexicalSim, orFuse } from '@/app/lib/brain'

/**
 * Helpers puros del cerebro: no tocan la BD, solo la matemática de fusión.
 */

describe('orFuse', () => {
  it('sin fuentes devuelve 0', () => {
    expect(orFuse([])).toBe(0)
  })

  it('con una sola fuente devuelve esa similitud', () => {
    expect(orFuse([0.6])).toBe(0.6)
  })

  it('combina fuentes como 1 - (1-a)(1-b)', () => {
    // 1 - (1 - 0.6) * (1 - 0.7) = 1 - 0.4*0.3 = 0.88
    expect(orFuse([0.6, 0.7])).toBe(0.88)
  })

  it('coincidir en dos vías puntúa más que en una sola', () => {
    expect(orFuse([0.5, 0.6])).toBeGreaterThan(orFuse([0.5]))
  })

  it('acota a [0,1] y descarta valores no numéricos', () => {
    expect(orFuse([2])).toBe(1)
    expect(orFuse([-1])).toBe(0)
    expect(orFuse([NaN, Infinity, 0.5])).toBe(0.5)
  })

  it('nunca supera 1 por más fuentes que coincidan', () => {
    expect(orFuse([0.9, 0.9, 0.9])).toBeLessThanOrEqual(1)
  })
})

describe('lexicalSim', () => {
  const title = 'Plan de migración'
  const content = 'vamos a pasar la base a postgresql 17 y armar el índice hnsw'

  it('frase exacta da la puntuación más alta', () => {
    expect(lexicalSim(title, content, 'índice hnsw')).toBe(0.95)
  })

  it('todas las palabras coinciden: fuerte', () => {
    expect(lexicalSim(title, content, 'postgresql índice')).toBe(0.85)
  })

  it('solo algunas palabras: moderado', () => {
    expect(lexicalSim(title, content, 'cerebro postgresql')).toBe(0.6)
  })

  it('sin coincidencia devuelve 0', () => {
    expect(lexicalSim(title, content, 'zapato de goma')).toBe(0)
  })

  it('consulta vacía devuelve 0', () => {
    expect(lexicalSim(title, content, '   ')).toBe(0)
  })

  it('no distingue mayúsculas y busca en el título también', () => {
    expect(lexicalSim(title, content, 'PLAN')).toBe(0.95)
  })

  it('tolera contenido indefinido', () => {
    expect(lexicalSim(title, undefined as unknown as string, 'migración')).toBe(0.95)
  })
})