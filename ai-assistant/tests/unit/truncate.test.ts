import { describe, expect, it } from 'vitest'
import { normalizeOffset, oneLineStub, sliceWindow } from '@/app/lib/truncate'

describe('normalizeOffset', () => {
  it('normaliza a entero >= 0 y tolera basura', () => {
    expect(normalizeOffset(0)).toBe(0)
    expect(normalizeOffset(10)).toBe(10)
    expect(normalizeOffset(10.9)).toBe(10)
    expect(normalizeOffset(-5)).toBe(0)
    expect(normalizeOffset(undefined)).toBe(0)
    expect(normalizeOffset(null)).toBe(0)
    expect(normalizeOffset('20')).toBe(20)
    expect(normalizeOffset('abc')).toBe(0)
    expect(normalizeOffset(Number.NaN)).toBe(0)
  })
})

describe('sliceWindow', () => {
  const text = 'abcdefghij' // 10 chars

  it('devuelve la primera ventana y marca truncado con nextOffset', () => {
    expect(sliceWindow(text, 0, 4)).toEqual({
      offset: 0,
      content: 'abcd',
      truncated: true,
      nextOffset: 4,
    })
  })

  it('continúa desde nextOffset', () => {
    expect(sliceWindow(text, 4, 4)).toEqual({
      offset: 4,
      content: 'efgh',
      truncated: true,
      nextOffset: 8,
    })
  })

  it('la última ventana no queda truncada', () => {
    expect(sliceWindow(text, 8, 4)).toEqual({
      offset: 8,
      content: 'ij',
      truncated: false,
      nextOffset: null,
    })
  })

  it('un offset más allá del final devuelve vacío', () => {
    expect(sliceWindow(text, 100, 4)).toEqual({
      offset: 10,
      content: '',
      truncated: false,
      nextOffset: null,
    })
  })

  it('normaliza offsets raros y texto vacío', () => {
    expect(sliceWindow(text, -3, 4).offset).toBe(0)
    expect(sliceWindow('', 0, 4)).toEqual({
      offset: 0,
      content: '',
      truncated: false,
      nextOffset: null,
    })
  })
})

describe('oneLineStub', () => {
  it('es una sola línea e indica los chars omitidos', () => {
    const stub = oneLineStub('x'.repeat(123))
    expect(stub).not.toContain('\n')
    expect(stub).toContain('123')
  })
})
