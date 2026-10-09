import { describe, expect, it } from 'vitest'
import {
  contextUsagePercent,
  formatCompactTokens,
  formatContextUsage,
} from '@/app/lib/context-info'
import type { ContextInfo } from '@/app/types'

/**
 * Indicador de contexto del turno (FASE 3.2): el servidor estima el prompt con
 * `estimateMessagesTokens` (local, ~3.5 chars/token) y el cliente pinta la
 * barrita. Estas pruebas cubren el formateo puro: porcentaje recortado, etiqueta
 * corta y casos límite — sin red, API ni BD.
 */

const base: ContextInfo = { budget: 5000, promptTokens: 3424, summarizedCount: 0, hasSummary: false }

describe('contextUsagePercent', () => {
  it('calcula el porcentaje de presupuesto ocupado', () => {
    expect(contextUsagePercent(base)).toBeCloseTo(3424 / 5000, 5)
  })

  it('recorta a 1 cuando el prompt supera el presupuesto', () => {
    expect(contextUsagePercent({ ...base, promptTokens: 9000 })).toBe(1)
  })

  it('recorta a 0 con presupuesto ausente o cero', () => {
    expect(contextUsagePercent({ ...base, budget: 0 })).toBe(0)
    expect(contextUsagePercent({ ...base, budget: -1 })).toBe(0)
  })
})

describe('formatCompactTokens', () => {
  it('usa k a partir de 1000', () => {
    expect(formatCompactTokens(1234)).toBe('1.2k')
    expect(formatCompactTokens(3424)).toBe('3.4k')
  })

  it('redondea sin decimales desde 10k', () => {
    expect(formatCompactTokens(10000)).toBe('10k')
    expect(formatCompactTokens(12500)).toBe('12.5k')
  })

  it('deja los números chicos enteros', () => {
    expect(formatCompactTokens(850)).toBe('850')
    expect(formatCompactTokens(0)).toBe('0')
  })
})

describe('formatContextUsage', () => {
  it('arma la etiqueta corta con porcentaje', () => {
    expect(formatContextUsage(base)).toBe('ctx ~3.4k/5k tokens · 68%')
  })

  it('tolera presupuesto ausente (0%)', () => {
    expect(formatContextUsage({ ...base, budget: 0 })).toBe('ctx ~3.4k/0 tokens · 0%')
  })
})