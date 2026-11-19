import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/scrub', () => ({
  scrubText: vi.fn((text: string) => {
    const matches = text.match(/SECRETO/g) ?? []
    return {
      text: text.replace(/SECRETO/g, '<clave>'),
      redactions: matches.length,
      byKind: matches.length ? { 'api-key': matches.length } : {},
    }
  }),
}))

import { scrubText } from '@/app/lib/scrub'
import { createTraceLogger, type PilotTrace } from '@/app/lib/pilot-traces'

const scrub = vi.mocked(scrubText)

function sink() {
  const lines: string[] = []
  return { lines, append: (line: string) => lines.push(line) }
}

function parse(line: string): PilotTrace {
  return JSON.parse(line) as PilotTrace
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTraceLogger', () => {
  it('anonimiza prompt, salida y herramientas antes de escribir JSONL', () => {
    const out = sink()
    const trace = createTraceLogger(out).record({
      task: 'test-generation',
      prompt: 'usuario SECRETO',
      output: 'respuesta SECRETO',
      tools: [{ name: 'git_diff', result: 'token SECRETO' }],
      verdict: 'needs-review',
    })

    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].endsWith('\n')).toBe(true)
    const saved = parse(out.lines[0])
    expect(saved).toEqual(trace)
    expect(saved.prompt).toBe('usuario <clave>')
    expect(saved.output).toBe('respuesta <clave>')
    expect(saved.tools[0].result).toBe('token <clave>')
    expect(saved.redactions).toBe(3)
    expect(saved.byKind['api-key']).toBe(3)
    expect(out.lines[0]).not.toContain('SECRETO')
    expect(scrub).toHaveBeenCalled()
  })

  it('también limpia los metadatos anidados', () => {
    const out = sink()
    const trace = createTraceLogger(out).record({
      task: 'pr-summary',
      prompt: 'prompt',
      output: 'salida',
      meta: { token: 'SECRETO', nested: { clave: 'SECRETO' } },
    })

    expect(trace.meta).toEqual({ token: '<clave>', nested: { clave: '<clave>' } })
    expect(trace.redactions).toBe(2)
    expect(out.lines[0]).not.toContain('SECRETO')
  })

  it('veredicto y score ausentes o inválidos quedan como null', () => {
    const logger = createTraceLogger(sink())
    const sinVeredicto = logger.record({
      task: 'pr-summary',
      prompt: 'a',
      output: 'b',
    })
    const conNan = logger.record({
      task: 'pr-summary',
      prompt: 'a',
      output: 'b',
      score: Number.NaN,
    })

    expect(sinVeredicto.verdict).toBeNull()
    expect(sinVeredicto.score).toBeNull()
    expect(conNan.score).toBeNull()
  })

  it('recorta campos enormes y marca la traza como truncada', () => {
    const trace = createTraceLogger(sink()).record({
      task: 'pr-summary',
      prompt: 'a'.repeat(25_000),
      output: 'b',
    })

    expect(trace.prompt).toHaveLength(20_000)
    expect(trace.truncated).toBe(true)
  })

  it('usa el reloj inyectado para la marca de tiempo y el id', () => {
    const now = () => new Date('2026-11-19T10:20:30.000Z')
    const trace = createTraceLogger(sink()).record({
      task: 'pr-summary',
      prompt: 'a',
      output: 'b',
      now,
    })

    expect(trace.ts).toBe('2026-11-19T10:20:30.000Z')
    expect(trace.id).toContain('2026-11-19T10:20:30.000Z')
    expect(trace.id).toContain('pr-summary')
  })
})
