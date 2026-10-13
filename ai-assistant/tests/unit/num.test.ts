import { describe, expect, it } from 'vitest'
import { clamp01, round3, round01 } from '@/app/lib/num'

describe('num — helpers compartidos', () => {
  it('clamp01 recorta a [0,1] sin redondear', () => {
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(1.4)).toBe(1)
    expect(clamp01(0.123456)).toBe(0.123456)
  })

  it('round3 redondea a 3 decimales y anula los no finitos', () => {
    expect(round3(0.12345)).toBe(0.123)
    expect(round3(1 / 3)).toBe(0.333)
    expect(round3(5)).toBe(5)
    expect(round3(Number.NaN)).toBe(0)
    expect(round3(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('round01 recorta Y redondea (score normalizado)', () => {
    expect(round01(0.12345)).toBe(0.123)
    expect(round01(-1)).toBe(0)
    expect(round01(2)).toBe(1)
    expect(round01(Number.NaN)).toBe(0)
  })
})