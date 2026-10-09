import { describe, expect, it } from 'vitest'
import {
  formatCompactNumber,
  formatHourMinute,
  formatNeuronsRemaining,
  groqStatusLabel,
  quotaTooltip,
} from '@/app/lib/quota-info'
import type { QuotaInfo } from '@/app/types'

const quota = (overrides: Partial<QuotaInfo> = {}): QuotaInfo => ({
  neurons: { used: 1900, budget: 8000, remaining: 6100 },
  groq: { total: 4, available: 3, exhausted: ['modelo-sin-cuota'], until: null },
  ...overrides,
})

describe('quota-info (unit, puro)', () => {
  it('formatCompactNumber comprime miles con un decimal', () => {
    expect(formatCompactNumber(6100)).toBe('6.1k')
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(12000)).toBe('12k')
    expect(formatCompactNumber(1000)).toBe('1k')
    expect(formatCompactNumber(0)).toBe('0')
  })

  it('formatCompactNumber tolera valores raros', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('0')
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatCompactNumber(-5)).toBe('-5')
  })

  it('formatNeuronsRemaining devuelve lo que queda, nunca negativo', () => {
    expect(formatNeuronsRemaining(quota())).toBe('6.1k')
    expect(formatNeuronsRemaining(quota({ neurons: { used: 8000, budget: 8000, remaining: 0 } }))).toBe('0')
    expect(
      formatNeuronsRemaining(quota({ neurons: { used: 9000, budget: 8000, remaining: -1000 } })),
    ).toBe('0')
  })

  it('groqStatusLabel resume modelos con cuota vs agotado', () => {
    expect(groqStatusLabel(quota().groq)).toBe('Groq 3/4')
    expect(groqStatusLabel(quota({ groq: { total: 2, available: 0, exhausted: ['a', 'b'], until: null } }).groq)).toBe(
      'Groq agotado',
    )
  })

  it('formatHourMinute pasa ISO a HH:mm UTC y tolera entradas malas', () => {
    expect(formatHourMinute('2026-10-09T10:30:00.000Z')).toBe('10:30')
    expect(formatHourMinute('2026-10-09T23:05:00.000Z')).toBe('23:05')
    expect(formatHourMinute('no-es-una-fecha')).toBe('')
  })

  it('quotaTooltip arma el mensaje completo del badge', () => {
    const tip = quotaTooltip(quota())
    expect(tip).toContain('6.1k neuronas')
    expect(tip).toContain('8k')
    expect(tip).toContain('Groq 3/4')
  })

  it('quotaTooltip avisa cuando Groq está agotado con hora de vuelta', () => {
    const agotada = quota({
      groq: { total: 2, available: 0, exhausted: ['a', 'b'], until: '2026-10-10T00:00:00.000Z' },
    })
    const tip = quotaTooltip(agotada)
    expect(tip).toContain('Groq sin cuota')
    expect(tip).toContain('00:00 UTC')
  })
})