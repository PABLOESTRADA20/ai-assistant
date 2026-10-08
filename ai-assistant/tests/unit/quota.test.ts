import { describe, expect, it } from 'vitest'
import {
  estimateEmbeddingNeurons,
  estimateNeurons,
  FALLBACK_NEURON_BUDGET,
  nextMidnightUtc,
  parseResetWindow,
  pruneQuotaMap,
  untilFromError,
  utcDayKey,
} from '@/app/lib/quota'

describe('nextMidnightUtc', () => {
  it('devuelve la medianoche UTC del día siguiente', () => {
    const now = new Date('2026-10-07T15:30:00.000Z')
    const midnight = nextMidnightUtc(now)
    expect(midnight.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('es el mismo día cuando ya es tarde', () => {
    const now = new Date('2026-10-07T23:59:00.000Z')
    expect(nextMidnightUtc(now).toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('untilFromError', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it('usa el "try again in Xs" de Groq cuando lo trae', () => {
    const until = untilFromError('Rate limit reached. Please try again in 45s', now)
    expect(until).toBe('2026-10-07T12:00:45.000Z')
  })

  it('interpreta minutos ("try again in 12m")', () => {
    const until = untilFromError('Retry: try again in 12m', now)
    expect(until).toBe('2026-10-07T12:12:00.000Z')
  })

  it('cae a medianoche UTC sin pista (límite diario)', () => {
    const until = untilFromError('Rate limit reached for model foo: Limit 200000, Used 198478', now)
    expect(until).toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('parseResetWindow', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it('parsea "2m59.56s" (formato real de Groq)', () => {
    const until = parseResetWindow('2m59.56s', now)
    expect(until).toBe(new Date(now.getTime() + 179.56 * 1000).toISOString())
  })

  it('parsea "23h59m59s"', () => {
    const until = parseResetWindow('23h59m59s', now)
    expect(until).toBe(new Date(now.getTime() + 86399 * 1000).toISOString())
  })

  it('acepta segundos planos', () => {
    expect(parseResetWindow('7.66s', now)).toBe(new Date(now.getTime() + 7.66 * 1000).toISOString())
    expect(parseResetWindow('85', now)).toBe(new Date(now.getTime() + 85 * 1000).toISOString())
  })

  it('devuelve null ante valores ininterpretables', () => {
    expect(parseResetWindow('', now)).toBeNull()
    expect(parseResetWindow('garbage', now)).toBeNull()
  })
})

describe('pruneQuotaMap', () => {
  it('descarta entradas vencidas y fechas inválidas', () => {
    const now = new Date('2026-10-07T12:00:00.000Z')
    const map = {
      'openai/gpt-oss-120b': '2026-10-08T00:00:00.000Z', // vigente
      'qwen/qwen3.8-27b': '2026-10-07T11:00:00.000Z', // vencida
      'openai/gpt-oss-20b': 'no-una-fecha', // inválida
    }
    expect(pruneQuotaMap(map, now)).toEqual({ 'openai/gpt-oss-120b': '2026-10-08T00:00:00.000Z' })
  })
})

describe('estimateNeurons', () => {
  it('es 0 sin tráfico', () => {
    expect(estimateNeurons(0, 0)).toBe(0)
  })

  it('crece con la entrada y la salida', () => {
    const small = estimateNeurons(400, 200)
    const big = estimateNeurons(40_000, 20_000)
    expect(big).toBeGreaterThan(small)
    expect(estimateNeurons(0, 40_000)).toBeGreaterThan(estimateNeurons(0, 200))
  })

  it('siempre es positivo para un turno real', () => {
    expect(estimateNeurons(2000, 800)).toBeGreaterThan(0)
  })
})

describe('presupuesto de la reserva', () => {
  it('el tope queda por debajo de las 10.000 neuronas gratis de Workers AI', () => {
    expect(FALLBACK_NEURON_BUDGET).toBeLessThan(10_000)
    expect(FALLBACK_NEURON_BUDGET).toBeGreaterThan(0)
  })

  it('utcDayKey devuelve el día UTC como clave de reinicio', () => {
    const now = new Date('2026-10-07T23:00:00.000Z')
    expect(utcDayKey(now)).toBe('2026-10-07')
    const late = new Date('2026-10-08T00:30:00.000Z')
    expect(utcDayKey(late)).toBe('2026-10-08')
  })
})

describe('estimateEmbeddingNeurons', () => {
  it('cobra solo la entrada (los vectores no generan salida)', () => {
    expect(estimateEmbeddingNeurons('')).toBe(0)
    expect(estimateEmbeddingNeurons('hola')).toBe(1) // 4 chars -> 1 token
    expect(estimateEmbeddingNeurons('x'.repeat(4000))).toBeGreaterThan(
      estimateEmbeddingNeurons('x'.repeat(40)),
    )
  })
})