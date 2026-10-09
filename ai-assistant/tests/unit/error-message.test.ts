import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGE_PREFIX, isErrorContent } from '@/app/lib/error-message'

describe('isErrorContent', () => {
  it('detecta el prefijo con el que ARIA marca sus errores', () => {
    expect(isErrorContent(`${ERROR_MESSAGE_PREFIX} No se pudo conectar`)).toBe(true)
  })

  it('no confunde respuestas normales', () => {
    expect(isErrorContent('⚠️ Ojo: revisa este detalle')).toBe(false)
    expect(isErrorContent('**Error**: esto es markdown legítimo')).toBe(false)
    expect(isErrorContent('')).toBe(false)
  })

  it('necesita el prefijo exacto al inicio (no a mitad)', () => {
    expect(isErrorContent(`Primero algo, luego ${ERROR_MESSAGE_PREFIX} falla`)).toBe(false)
  })
})