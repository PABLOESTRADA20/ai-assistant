import { describe, expect, it, vi } from 'vitest'
import { runPilot } from '@/app/lib/pilot-run'
import type { PilotTaskName, PilotTrace } from '@/app/lib/pilot-traces'

const TEST_OUTPUT = [
  'ARCHIVO: tests/unit/generado.test.ts',
  '```ts',
  "import { describe, expect, it } from 'vitest'",
  "describe('generado', () => { it('ok', () => expect(1).toBe(1)) })",
  '```',
  '- revisar antes de commitear',
].join('\n')

const PR_OUTPUT = [
  'TÍTULO: Cambio verificado por CI',
  '',
  '## Qué cambia',
  'Pequeño ajuste.',
  '',
  '## Validación',
  'CI en verde.',
].join('\n')

function responder(prompt: string, task: PilotTaskName): string {
  return task === 'test-generation' ? TEST_OUTPUT : PR_OUTPUT
}

function baseInput(complete = responder) {
  const lines: string[] = []
  return {
    lines,
    input: {
      diff: '+ correo ana@ejemplo.com y clave gsk_12345678901234567890',
      changedFiles: ['app/lib/nuevo.ts'],
      commits: ['abc123 ajuste'],
      systemPrompt: 'Eres ARIA. No compartas ana@ejemplo.com.',
      repo: 'owner/repo',
      complete,
      sink: { append: (line: string) => lines.push(line) },
      verdict: 'ci-passed' as const,
      score: 4,
      meta: { mode: 'llm' },
    },
  }
}

describe('runPilot', () => {
  it('anonimiza antes de llamar al LLM y guarda dos trazas con veredicto', async () => {
    const { input, lines } = baseInput()
    const complete = vi.fn(responder)
    const result = await runPilot({ ...input, complete })

    expect(complete).toHaveBeenCalledTimes(2)
    const testPrompt = complete.mock.calls[0][0] as string
    expect(testPrompt).toContain('<email>')
    expect(testPrompt).toContain('<clave>')
    expect(testPrompt).not.toContain('ana@ejemplo.com')
    expect(testPrompt).not.toContain('gsk_12345678901234567890')

    expect(result).toEqual({
      testPath: 'tests/unit/generado.test.ts',
      prTitle: 'Cambio verificado por CI',
      redactions: expect.any(Number),
      traces: 2,
    })
    expect(lines).toHaveLength(2)

    const traces = lines.map((line) => JSON.parse(line) as PilotTrace)
    expect(traces.map((trace) => trace.task)).toEqual(['test-generation', 'pr-summary'])
    for (const trace of traces) {
      expect(trace.verdict).toBe('ci-passed')
      expect(trace.score).toBe(4)
      expect(trace.meta.mode).toBe('llm')
      expect(trace.redactions).toBeGreaterThan(0)
      expect(trace.output).not.toContain('ana@ejemplo.com')
    }
    expect(traces[0].meta.proposalPath).toBe('tests/unit/generado.test.ts')
    expect(traces[1].meta.proposalTitle).toBe('Cambio verificado por CI')
  })

  it('si el completor devuelve basura, lanza y no guarda trazas', async () => {
    const { input, lines } = baseInput(() => 'esto no es una propuesta')

    await expect(runPilot(input)).rejects.toThrow(/formato inválido/)
    expect(lines).toHaveLength(0)
  })

  it('el veredicto por defecto es needs-review y el score ausente es null', async () => {
    const { input, lines } = baseInput()
    delete (input as { verdict?: string }).verdict
    delete (input as { score?: number }).score

    await runPilot(input)

    const traces = lines.map((line) => JSON.parse(line) as PilotTrace)
    expect(traces[0].verdict).toBe('needs-review')
    expect(traces[0].score).toBeNull()
  })
})
