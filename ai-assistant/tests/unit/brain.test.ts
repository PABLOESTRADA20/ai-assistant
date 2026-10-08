import { describe, expect, it } from 'vitest'
import {
  DEDUPE_JACCARD,
  type BrainHit,
  LEXICAL_SMOOTHING,
  RANK_BOOST_MAX,
  dedupeHits,
  lexicalSim,
  normalizeLexical,
  orFuse,
  rankBoost,
} from '@/app/lib/brain'

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

function makeHit(id: string, content: string, score: number, kind: BrainHit['kind'] = 'memory'): BrainHit {
  return {
    kind,
    id,
    content,
    snippet: content,
    tags: [],
    source: 'test',
    createdAt: new Date(0).toISOString(),
    score,
  }
}

function hitAt(id: string, createdAt: string, importance?: number): BrainHit {
  return { ...makeHit(id, 'contenido de prueba', 0), createdAt, importance }
}

describe('dedupeHits', () => {
  it('colapsa duplicados exactos y conserva el primero (mayor score)', () => {
    const out = dedupeHits([
      makeHit('a', 'Usa PostgreSQL 17 para el vault', 0.9),
      makeHit('b', 'usa   postgresql 17 para el vault', 0.6),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('colapsa casi-duplicados por Jaccard de tokens', () => {
    const base = 'prefiere usar vscode y python para los proyectos'
    const out = dedupeHits([makeHit('a', base, 0.8), makeHit('b', `${base} nuevos`, 0.5)])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('colapsa una nota con su espejo en memoria (mismo texto con prefijo)', () => {
    const body = 'el cafe se toma sin azucar y el te con miel por la manana temprano'
    const out = dedupeHits([
      makeHit('m1', `Nota "Cafe": ${body}`, 0.7, 'memory'),
      makeHit('n1', body, 0.6, 'note'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('m1')
  })

  it('no colapsa contenidos que solo comparten tema', () => {
    const out = dedupeHits([
      makeHit('a', 'prefiere vscode para programar', 0.8),
      makeHit('b', 'el deploy se hace los viernes con wrangler', 0.7),
    ])
    expect(out).toHaveLength(2)
  })

  it('preserva el orden de los no duplicados', () => {
    const out = dedupeHits([
      makeHit('a', 'uno dos tres cuatro', 0.9),
      makeHit('b', 'uno dos tres cuatro', 0.8),
      makeHit('c', 'contenido totalmente distinto aqui', 0.7),
    ])
    expect(out.map((h) => h.id)).toEqual(['a', 'c'])
  })

  it('tolera listas vacías y permite ajustar el umbral', () => {
    expect(dedupeHits([])).toEqual([])
    const base = 'prefiere usar vscode y python para los proyectos'
    const near = [makeHit('a', base, 0.9), makeHit('b', `${base} nuevos`, 0.8)]
    expect(dedupeHits(near)).toHaveLength(1) // Jaccard 7/8 ≈ 0.875
    expect(dedupeHits(near, 0.95)).toHaveLength(2) // umbral más estricto
    expect(DEDUPE_JACCARD).toBeGreaterThan(0)
  })
})

describe('rankBoost', () => {
  const now = Date.parse('2026-10-08T00:00:00.000Z')
  const fresh = new Date(now - 86_400_000).toISOString()
  const old = new Date(now - 500 * 86_400_000).toISOString()

  it('sin importancia y muy viejo casi no empuja', () => {
    expect(rankBoost(hitAt('a', old), now)).toBeGreaterThanOrEqual(1)
    expect(rankBoost(hitAt('a', old), now)).toBeLessThan(1.01)
  })

  it('fresco e importante se acerca al tope 1 + RANK_BOOST_MAX', () => {
    expect(rankBoost(hitAt('a', fresh, 10), now)).toBeCloseTo(1 + RANK_BOOST_MAX, 2)
  })

  it('crece con la importancia', () => {
    expect(rankBoost(hitAt('a', fresh, 9), now)).toBeGreaterThan(
      rankBoost(hitAt('a', fresh, 2), now),
    )
  })

  it('decrece con la antigüedad', () => {
    expect(rankBoost(hitAt('a', old, 8), now)).toBeLessThan(
      rankBoost(hitAt('a', fresh, 8), now),
    )
  })

  it('nunca supera 1 + RANK_BOOST_MAX ni baja de 1', () => {
    expect(rankBoost(hitAt('a', fresh, 9999), now)).toBeLessThanOrEqual(1 + RANK_BOOST_MAX)
    expect(rankBoost(hitAt('a', 'no-valida'), now)).toBe(1)
  })

  it('no da vuelta una diferencia de relevancia grande', () => {
    // El boost máximo (1.2) no alcanza a un 0.7: 0.5 * 1.2 = 0.6 < 0.7.
    expect(0.7).toBeGreaterThan(0.5 * (1 + RANK_BOOST_MAX))
  })
})