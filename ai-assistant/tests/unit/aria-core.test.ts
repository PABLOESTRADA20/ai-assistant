import { describe, expect, it } from 'vitest'
import {
  buildContextMessages,
  composeMemoryBlock,
  DEFAULT_MODEL,
  CHEAP_MODEL,
  MAX_VISIBLE_MESSAGES,
  MEMORY_BLOCK_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_MAX_LINES,
  MODEL_CONFIG,
  SYSTEM_PROMPT,
  trimMemoryLine,
  wantsWebSearch,
  type ChatMessage,
  type MemoryLine,
} from '@/app/lib/aria-core'
import { estimateTokens } from '@/app/lib/tokens'

const user = (content: string): ChatMessage => ({ role: 'user', content })

describe('wantsWebSearch', () => {
  it('detecta órdenes explícitas de búsqueda', () => {
    expect(wantsWebSearch([user('busca información sobre el nuevo Rust 2026')])).toBe(true)
    expect(wantsWebSearch([user('investiga cómo funciona pgvector')])).toBe(true)
  })

  it('detecta peticiones de novedades/actualidad', () => {
    expect(wantsWebSearch([user('¿qué hay de nuevo en Next.js?')])).toBe(true)
    expect(wantsWebSearch([user('¿qué noticias hay sobre OpenAI?')])).toBe(true)
  })

  it('no fuerza si el último mensaje de usuario es otra cosa', () => {
    expect(
      wantsWebSearch([
        user('busca info de Cloudflare'),
        { role: 'assistant', content: 'Busco...' },
        user('gracias, ¿qué hora es?'),
      ]),
    ).toBe(false)
  })

  it('ignora temas propios: "mi base de datos", "mi repo"...', () => {
    expect(wantsWebSearch([user('busca el error en mi base de datos')])).toBe(false)
    expect(wantsWebSearch([user('revisa los issues de mi repo')])).toBe(false)
  })

  it('ignora consultas al vault/notas', () => {
    expect(wantsWebSearch([user('¿qué notas tengo sobre Postgres?')])).toBe(false)
  })

  it('ignora mensajes con bloques de código', () => {
    expect(wantsWebSearch([user('```\nnpm run build\n```\nbúscalo en la web')])).toBe(false)
  })

  it('ignora mensajes muy largos', () => {
    expect(wantsWebSearch([user(`busca ${'x'.repeat(1300)}`)])).toBe(false)
  })

  it('devuelve false sin mensajes de usuario', () => {
    expect(wantsWebSearch([])).toBe(false)
    expect(wantsWebSearch([{ role: 'assistant', content: 'hola' }])).toBe(false)
  })
})

describe('buildContextMessages', () => {
  it('devuelve el historial tal cual sin resumen', () => {
    const msgs = [user('hola'), { role: 'assistant', content: '¿qué tal?' }]
    expect(buildContextMessages(msgs, null)).toBe(msgs)
  })

  it('devuelve el historial tal cual si cabe entero', () => {
    const msgs = Array.from({ length: MAX_VISIBLE_MESSAGES }, (_, i) =>
      user(`msg ${i}`),
    )
    expect(buildContextMessages(msgs, 'resumen previo')).toBe(msgs)
  })

  it('con resumen y historial largo deja resumen + últimos 8', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }))
    const out = buildContextMessages(msgs, 'resumen previo')

    expect(out).toHaveLength(MAX_VISIBLE_MESSAGES + 1)
    expect(out[0].role).toBe('system')
    expect(out[0].content).toContain('resumen previo')
    expect(out.slice(1)).toEqual(msgs.slice(-MAX_VISIBLE_MESSAGES))
  })
})

describe('configuración de modelos', () => {
  it('el modelo por defecto y el barato están en MODEL_CONFIG', () => {
    expect(MODEL_CONFIG[DEFAULT_MODEL]).toBeDefined()
    expect(MODEL_CONFIG[CHEAP_MODEL]).toBeDefined()
    expect(MODEL_CONFIG[DEFAULT_MODEL].max_tokens).toBeGreaterThan(0)
  })

  it('todo modelo tiene max_tokens y temperatura válidos', () => {
    for (const [name, cfg] of Object.entries(MODEL_CONFIG)) {
      expect(cfg.max_tokens, name).toBeGreaterThan(0)
      expect(cfg.temperature, name).toBeGreaterThan(0)
      expect(cfg.temperature, name).toBeLessThanOrEqual(2)
    }
  })

  it('el system prompt describe a ARIA y sus herramientas', () => {
    expect(SYSTEM_PROMPT).toContain('ARIA')
    expect(SYSTEM_PROMPT).toContain('web_search')
  })

  it('el system prompt es compacto y no duplica los schemas', () => {
    // Las herramientas ya se ofrecen vía selectTools + TOOL_DEFINITIONS;
    // listarlas aquí era duplicación que se pagaba en cada turno.
    expect(SYSTEM_PROMPT).not.toContain('## Tools Available')
    expect(estimateTokens(SYSTEM_PROMPT)).toBeLessThanOrEqual(900)
  })
})

describe('trimMemoryLine', () => {
  it('aplana espacios y saltos de línea', () => {
    expect(trimMemoryLine('  hola \n  mundo  ')).toBe('hola mundo')
  })

  it('recorta al tope por línea con puntos suspensivos', () => {
    const out = trimMemoryLine(`- ${'x'.repeat(500)}`)
    expect(out.length).toBe(MEMORY_LINE_MAX_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })

  it('no toca las líneas que caben', () => {
    expect(trimMemoryLine('- corta')).toBe('- corta')
  })
})

describe('composeMemoryBlock', () => {
  const candidate = (
    key: string,
    memoryId?: string,
    relevant = false,
  ): MemoryLine => ({ key, line: `- ${key}`, memoryId, relevant })

  it('deduplica por clave conservando el primero', () => {
    const out = composeMemoryBlock([
      candidate('a', 'm1', true),
      candidate('a', 'm2', true),
      candidate('b'),
    ])
    expect(out.lines).toEqual(['- a', '- b'])
    expect(out.injectedMemoryIds).toEqual(['m1'])
  })

  it('solo refuerza lo relevante (el relleno no realimenta el ruido)', () => {
    const out = composeMemoryBlock([
      candidate('brain', 'mem-1', true),
      candidate('pref', 'mem-2', false),
    ])
    expect(out.injectedMemoryIds).toEqual(['mem-1'])
  })

  it('respeta el tope de líneas', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate(`l${i}`, `m${i}`, true))
    const out = composeMemoryBlock(many)
    expect(out.lines).toHaveLength(MEMORY_MAX_LINES)
    expect(out.injectedMemoryIds).toHaveLength(MEMORY_MAX_LINES)
  })

  it('respeta el presupuesto de caracteres', () => {
    const long = (key: string): MemoryLine => ({ key, line: `- ${'x'.repeat(400)}` })
    const out = composeMemoryBlock(Array.from({ length: 10 }, (_, i) => long(`l${i}`)))
    // Cada línea se recorta a 240; 4 líneas = 240 + 3*(240+1) = 963; la 5.ª
    // (1204) ya no cabe en 1200.
    expect(out.lines).toHaveLength(4)
    expect(out.lines.join('\n').length).toBeLessThanOrEqual(MEMORY_BLOCK_MAX_CHARS)
  })

  it('nunca deja el bloque vacío si hay algo que inyectar', () => {
    const out = composeMemoryBlock([{ key: 'x', line: `- ${'x'.repeat(5000)}` }])
    expect(out.lines).toHaveLength(1)
  })
})
