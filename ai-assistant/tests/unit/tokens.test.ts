import { describe, expect, it, vi } from 'vitest'
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_BUDGET,
  estimateMessagesTokens,
  estimateTokens,
  MESSAGE_OVERHEAD_TOKENS,
} from '@/app/lib/tokens'
import { CHEAP_MODEL, DEFAULT_MODEL, MODEL_CONFIG } from '@/app/lib/aria-core'

describe('estimateTokens', () => {
  it('devuelve 0 para texto vacío o ausente', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
  })

  it('redondea hacia arriba con CHARS_PER_TOKEN=3.5', () => {
    expect(CHARS_PER_TOKEN).toBe(3.5)
    expect(estimateTokens('a')).toBe(1) // 0.28 -> 1
    expect(estimateTokens('a'.repeat(4))).toBe(2) // 1.14 -> 2
    expect(estimateTokens('a'.repeat(7))).toBe(2) // 2.00 -> 2
    expect(estimateTokens('a'.repeat(8))).toBe(3) // 2.28 -> 3
    expect(estimateTokens('a'.repeat(350))).toBe(100) // exacto
  })
})

describe('estimateMessagesTokens', () => {
  it('devuelve 0 sin mensajes', () => {
    expect(estimateMessagesTokens([])).toBe(0)
    expect(estimateMessagesTokens(null)).toBe(0)
    expect(estimateMessagesTokens(undefined)).toBe(0)
  })

  it('suma contenido + overhead por mensaje', () => {
    expect(MESSAGE_OVERHEAD_TOKENS).toBe(4)
    // 'hola' = 4 chars -> 2 tokens; + 4 de overhead = 6
    expect(estimateMessagesTokens([{ role: 'user', content: 'hola' }])).toBe(6)
    // sin contenido, solo el overhead (tool calls vacías etc.)
    expect(estimateMessagesTokens([{ role: 'system' }])).toBe(MESSAGE_OVERHEAD_TOKENS)
    // dos mensajes de 2 tokens cada uno + overhead
    expect(
      estimateMessagesTokens([
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'a'.repeat(7) },
      ]),
    ).toBe(4 + 2 + (4 + 2))
  })

  it('acota un historial de 40 mensajes', () => {
    const messages = Array.from({ length: 40 }, () => ({
      role: 'user',
      content: 'x'.repeat(35), // 10 tokens + 4 de overhead = 14
    }))
    expect(estimateMessagesTokens(messages)).toBe(40 * 14)
  })
})

describe('presupuestos de MODEL_CONFIG', () => {
  it('todo modelo declara un contextBudget positivo', () => {
    for (const [name, cfg] of Object.entries(MODEL_CONFIG)) {
      expect(Number.isFinite(cfg.contextBudget), name).toBe(true)
      expect(cfg.contextBudget, name).toBeGreaterThan(0)
    }
  })

  it('los modelos de Groq free se quedan en 5000', () => {
    expect(MODEL_CONFIG[DEFAULT_MODEL].contextBudget).toBe(5000)
    expect(MODEL_CONFIG[CHEAP_MODEL].contextBudget).toBe(5000)
  })

  it('el presupuesto por defecto no supera los ~8000 TPM de Groq free', () => {
    expect(DEFAULT_CONTEXT_BUDGET).toBeGreaterThan(0)
    expect(DEFAULT_CONTEXT_BUDGET).toBeLessThanOrEqual(8000)
  })
})

describe('costo cero', () => {
  it('la estimación nunca llama a fetch', () => {
    const spy = vi.fn(() => {
      throw new Error('no debe haber red')
    })
    vi.stubGlobal('fetch', spy)
    try {
      expect(() =>
        estimateMessagesTokens([{ role: 'user', content: 'x'.repeat(100) }]),
      ).not.toThrow()
      expect(estimateTokens('x'.repeat(100))).toBeGreaterThan(0)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
