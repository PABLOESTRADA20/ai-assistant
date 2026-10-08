import { describe, expect, it } from 'vitest'
import { LEXICAL_SMOOTHING, lexicalSim, normalizeLexical, orFuse } from '@/app/lib/brain'

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

describe('normalizeLexical', () => {
  it('rank 0 o inválido devuelve 0', () => {
    expect(normalizeLexical(0)).toBe(0)
    expect(normalizeLexical(-3)).toBe(0)
    expect(normalizeLexical(NaN)).toBe(0)
    expect(normalizeLexical(Infinity)).toBe(0)
  })

  it('es monótono y acotado a [0,1)', () => {
    const values = [0.01, 0.05, 0.1, 0.2, 0.5, 1, 5].map((r) => normalizeLexical(r))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
    expect(values[0]).toBeGreaterThan(0)
    expect(normalizeLexical(1e9)).toBeLessThan(1)
    expect(normalizeLexical(1e9)).toBeGreaterThan(0.99)
  })

  it('un match típico (ts_rank_cd ≈ 0.05–0.1) supera el umbral de contexto 0.4', () => {
    expect(normalizeLexical(0.05)).toBeGreaterThan(0.4)
    expect(normalizeLexical(0.1)).toBeGreaterThan(0.4)
  })

  it('el acuerdo vectorial+léxico pesa más que solo vectorial (arregla la fusión)', () => {
    expect(orFuse([0.5, normalizeLexical(0.1)])).toBeGreaterThan(orFuse([0.5]))
  })

  it('la constante por defecto es un suavizado positivo', () => {
    expect(LEXICAL_SMOOTHING).toBeGreaterThan(0)
  })
})