import { describe, expect, it, vi } from 'vitest'
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_BUDGET,
  estimateMessagesTokens,
  estimateTokens,
  estimateToolDefinitionsTokens,
  fitOutputTokens,
  GROQ_FREE_TPM,
  MESSAGE_OVERHEAD_TOKENS,
  TOKEN_BUDGET_MARGIN,
  trimMessagesToBudget,
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

describe('estimateToolDefinitionsTokens', () => {
  it('devuelve 0 sin herramientas', () => {
    expect(estimateToolDefinitionsTokens([])).toBe(0)
    expect(estimateToolDefinitionsTokens(null)).toBe(0)
    expect(estimateToolDefinitionsTokens(undefined)).toBe(0)
  })

  it('estima el JSON completo de los esquemas', () => {
    const defs = [{ type: 'function', function: { name: 'x' } }]
    const expected = Math.ceil(JSON.stringify(defs).length / CHARS_PER_TOKEN)
    expect(estimateToolDefinitionsTokens(defs)).toBe(expected)
  })
})

describe('trimMessagesToBudget', () => {
  const msg = (role: string, content: string) => ({ role, content })

  it('no toca un contexto que ya cabe', () => {
    const messages = [msg('system', 's'), msg('user', 'hola')]
    expect(trimMessagesToBudget(messages, 1000)).toEqual(messages)
  })

  it('conserva los system iniciales, el último turno y lo reciente que quepa', () => {
    const system = msg('system', 's'.repeat(35)) // 14 tokens
    const old = msg('user', 'a'.repeat(35)) // 14
    const recent = msg('user', 'b'.repeat(35)) // 14
    const last = msg('user', 'c'.repeat(35)) // 14
    // 35 deja fuera todo el historial intermedio (system + last = 28) y
    // conserva el system inicial y la pregunta actual.
    expect(trimMessagesToBudget([system, old, recent, last], 35)).toEqual([system, last])
  })

  it('conserva el último mensaje aunque el presupuesto sea mínimo', () => {
    const messages = [
      msg('system', 's'.repeat(350)),
      msg('user', 'a'.repeat(350)),
      msg('user', 'pregunta final'),
    ]
    const out = trimMessagesToBudget(messages, 10)
    expect(out.at(-1)).toEqual(messages.at(-1))
  })

  it('sin mensajes devuelve una lista vacía', () => {
    expect(trimMessagesToBudget([], 100)).toEqual([])
  })
})

describe('fitOutputTokens', () => {
  it('descuenta prompt, margen y lo ya gastado del TPM', () => {
    expect(
      fitOutputTokens({ promptTokens: 2000, usedTokens: 0, desired: 8192 }),
    ).toBe(GROQ_FREE_TPM - 2000 - TOKEN_BUDGET_MARGIN)
    expect(
      fitOutputTokens({ promptTokens: 2000, usedTokens: 5000, desired: 8192 }),
    ).toBe(GROQ_FREE_TPM - 5000 - 2000 - TOKEN_BUDGET_MARGIN)
  })

  it('respeta el tope deseado cuando sobra cuota', () => {
    expect(fitOutputTokens({ promptTokens: 1000, desired: 512 })).toBe(512)
  })

  it('nunca baja del mínimo aunque el prompt ya no quepa', () => {
    expect(
      fitOutputTokens({ promptTokens: 7900, usedTokens: 0, desired: 8192, min: 512 }),
    ).toBe(512)
  })

  it('permite otro límite y otro margen (proveedores con más TPM)', () => {
    expect(
      fitOutputTokens({
        promptTokens: 10_000,
        usedTokens: 0,
        desired: 8192,
        limit: 30_000,
        margin: 1000,
      }),
    ).toBe(8192)
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
