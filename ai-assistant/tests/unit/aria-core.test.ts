import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildContextMessages,
  compactConversation,
  composeMemoryBlock,
  DEFAULT_MODEL,
  CHEAP_MODEL,
  MAX_VISIBLE_MESSAGES,
  MEMORY_BLOCK_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_MAX_LINES,
  MIN_COMPACT_MESSAGES,
  MODEL_CONFIG,
  planCompaction,
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

describe('planCompaction', () => {
  const msgs = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }))

  it('no resume nada si el historial cabe en la ventana visible', () => {
    expect(planCompaction(msgs(MAX_VISIBLE_MESSAGES), 0)).toEqual({
      toSummarize: [],
      newSummarizedCount: 0,
    })
  })

  it('pliega solo lo antiguo que no está cubierto', () => {
    const plan = planCompaction(msgs(12), 0)
    expect(plan.toSummarize).toHaveLength(4) // 12 - 8
    expect(plan.toSummarize[0].content).toBe('m0')
    expect(plan.newSummarizedCount).toBe(4)
  })

  it('es incremental: respeta summarizedCount y solo añade lo nuevo', () => {
    const plan = planCompaction(msgs(14), 4)
    expect(plan.toSummarize.map((m) => m.content)).toEqual(['m4', 'm5'])
    expect(plan.newSummarizedCount).toBe(6)
  })

  it('no repite trabajo cuando ya está todo cubierto', () => {
    expect(planCompaction(msgs(10), 2)).toEqual({ toSummarize: [], newSummarizedCount: 2 })
  })

  it('tolera summarizedCount fuera de rango', () => {
    expect(planCompaction(msgs(10), 99)).toEqual({ toSummarize: [], newSummarizedCount: 10 })
    expect(planCompaction(msgs(10), -5).newSummarizedCount).toBe(2)
  })
})

describe('compactConversation', () => {
  afterEach(() => vi.unstubAllGlobals())

  const msgs = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ role: 'user', content: `m${i}` }))

  it('devuelve null y no llama al modelo si no hay nada nuevo', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await compactConversation('k', msgs(MAX_VISIBLE_MESSAGES), null, 0)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no gasta una llamada por un único mensaje nuevo', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // 9 mensajes => 1 fuera de la ventana, por debajo del mínimo.
    expect(await compactConversation('k', msgs(MAX_VISIBLE_MESSAGES + 1), null, 0)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(MIN_COMPACT_MESSAGES).toBeGreaterThan(1)
  })

  it('fusiona el resumen previo y avanza summarizedCount', async () => {
    let body: { messages: { role: string; content: string }[] } = { messages: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'resumen nuevo' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await compactConversation('k', msgs(12), 'resumen viejo', 0)
    expect(result).toEqual({ summary: 'resumen nuevo', summarizedCount: 4 })
    // El prompt incluye el resumen previo para fusionarlo en vez de resumir todo.
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('resumen viejo')
  })

  it('devuelve null si el modelo no responde un resumen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await compactConversation('k', msgs(12), null, 0)).toBeNull()
  })
})
