import { describe, expect, it } from 'vitest'
import {
  aJsonl,
  construirEjemplos,
  crearInforme,
  DEFAULT_SYSTEM,
  formatearHerramientas,
  opcionesPorDefecto,
  type ConversacionEntrada,
} from '../../scripts/lora-dataset-lib'
import { SYNTHETIC_EXAMPLES } from '../../scripts/lora-seed'

function conv(messages: ConversacionEntrada['messages'], id = 'c1'): ConversacionEntrada {
  return { id, title: 'prueba', messages }
}

const u = (content: string) => ({ role: 'user', content })
const a = (content: string, tools?: unknown) => ({
  role: 'assistant',
  content,
  ...(tools !== undefined ? { tools } : {}),
})

describe('construirEjemplos', () => {
  it('en modo conversación mantiene una charla = un ejemplo', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [conv([u('hola'), a('buenas'), u('seguimos'), a('dale')])],
      opcionesPorDefecto({ mode: 'conversation' }),
      informe,
    )

    expect(out).toHaveLength(1)
    expect(out[0].messages).toHaveLength(5)
    expect(out[0].messages[0]).toEqual({ role: 'system', content: DEFAULT_SYSTEM })
  })

  it('en modo turno genera un ejemplo por respuesta con su contexto', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [conv([u('uno'), a('respuesta uno'), u('dos'), a('respuesta dos')])],
      opcionesPorDefecto({ mode: 'turn' }),
      informe,
    )

    expect(out).toHaveLength(2)
    expect(out[1].messages.map((m) => m.content)).toEqual([
      DEFAULT_SYSTEM,
      'uno',
      'respuesta uno',
      'dos',
      'respuesta dos',
    ])
    expect(informe.ejemplos).toBe(2)
    // El segundo ejemplo repite el contexto del primero: 2 + 4 turnos.
    expect(informe.mensajes).toBe(6)
  })

  it('limita el contexto previo con maxContextMessages', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [conv([u('uno'), a('respuesta uno'), u('dos'), a('respuesta dos')])],
      opcionesPorDefecto({ mode: 'turn', maxContextMessages: 2 }),
      informe,
    )

    expect(out[1].messages.map((m) => m.content)).toEqual([
      DEFAULT_SYSTEM,
      'dos',
      'respuesta dos',
    ])
  })

  it('descarta respuestas demasiado cortas', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [conv([u('uno'), a('ok'), u('dos'), a('respuesta larga')])],
      opcionesPorDefecto({ mode: 'turn', minAssistantChars: 5 }),
      informe,
    )

    expect(out).toHaveLength(1)
    expect(out[0].messages.at(-1)?.content).toBe('respuesta larga')
  })

  it('descarta conversaciones sin usuario o sin asistente', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [
        conv([a('solo asistente')], 'solo-a'),
        conv([u('solo usuario')], 'solo-u'),
      ],
      opcionesPorDefecto({ mode: 'turn' }),
      informe,
    )

    expect(out).toHaveLength(0)
    expect(informe.descartadas).toBe(2)
  })

  it('deduplica ejemplos idénticos', () => {
    const informe = crearInforme()
    const misma = conv([u('hola'), a('buenas')])
    const out = construirEjemplos(
      [misma, { ...misma, id: 'c2' }],
      opcionesPorDefecto({ mode: 'conversation' }),
      informe,
    )

    expect(out).toHaveLength(1)
    expect(informe.duplicados).toBe(1)
  })

  it('anonimiza el contenido y reporta las redacciones', () => {
    const informe = crearInforme()
    const out = construirEjemplos(
      [conv([u('mi correo es ana@example.com'), a('anotado')])],
      opcionesPorDefecto({ mode: 'conversation' }),
      informe,
    )

    expect(out[0].messages[1].content).toContain('<email>')
    expect(out[0].messages[1].content).not.toContain('ana@example.com')
    expect(informe.redacciones).toBe(1)
    expect(informe.porCategoria.email).toBe(1)
  })

  it('incluye herramientas solo si se piden', () => {
    const tools = [
      {
        name: 'web_search',
        args: { query: 'next 15' },
        result: 'resultado',
        status: 'done',
      },
    ]
    const entrada = conv([u('buscá'), a('Listo', tools)])

    const sin = crearInforme()
    const sinTools = construirEjemplos(
      [entrada],
      opcionesPorDefecto({ mode: 'conversation', withTools: false }),
      sin,
    )
    expect(sinTools[0].messages[2].content).toBe('Listo')
    expect(sin.mensajesConHerramientas).toBe(0)

    const con = crearInforme()
    const conTools = construirEjemplos(
      [entrada],
      opcionesPorDefecto({ mode: 'conversation', withTools: true }),
      con,
    )
    expect(conTools[0].messages[2].content).toContain('[Herramientas usadas]')
    expect(conTools[0].messages[2].content).toContain('web_search')
    expect(conTools[0].messages[2].content).toContain('resultado')
    expect(con.mensajesConHerramientas).toBe(1)
  })
})

describe('formatearHerramientas', () => {
  it('recorta resultados largos y no rompe con datos raros', () => {
    const trace = formatearHerramientas(
      [
        {
          name: 'x',
          args: { a: 1 },
          result: 'z'.repeat(1000),
          status: 'error',
        },
        null,
      ],
      10,
    )

    expect(trace).toContain('x(')
    expect(trace).toContain('[error]')
    expect(trace).toContain('zzzzzzzzzz')
    expect(trace).not.toContain('z'.repeat(11))
  })

  it('devuelve vacío si no hay herramientas', () => {
    expect(formatearHerramientas(undefined)).toBe('')
    expect(formatearHerramientas([])).toBe('')
  })
})

describe('aJsonl', () => {
  it('escribe una línea por ejemplo y termina en salto de línea', () => {
    const jsonl = aJsonl([
      { messages: [{ role: 'user', content: 'hola' }] },
      { messages: [{ role: 'assistant', content: 'buenas' }] },
    ])

    const lineas = jsonl.trimEnd().split('\n')
    expect(lineas).toHaveLength(2)
    expect(JSON.parse(lineas[0])).toEqual({
      messages: [{ role: 'user', content: 'hola' }],
    })
    expect(jsonl.endsWith('\n')).toBe(true)
  })

  it('devuelve vacío sin ejemplos', () => {
    expect(aJsonl([])).toBe('')
  })
})

describe('set sintético', () => {
  it('tiene suficientes ejemplos y todos son conversaciones válidas', () => {
    expect(SYNTHETIC_EXAMPLES.length).toBeGreaterThanOrEqual(60)

    for (const c of SYNTHETIC_EXAMPLES) {
      expect(c.synthetic).toBe(true)
      expect(c.messages.length).toBeGreaterThanOrEqual(2)
      expect(c.messages.some((m) => m.role === 'user')).toBe(true)
      expect(c.messages.some((m) => m.role === 'assistant')).toBe(true)
      for (const m of c.messages) {
        expect(m.content.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('no contiene secretos ni datos personales detectables por el scrub', () => {
    const informe = crearInforme()
    construirEjemplos(
      SYNTHETIC_EXAMPLES,
      opcionesPorDefecto({ mode: 'turn' }),
      informe,
    )

    expect(informe.redacciones).toBe(0)
    expect(informe.porCategoria).toEqual({})
    expect(informe.ejemplosSinteticos).toBeGreaterThanOrEqual(60)
  })
})
