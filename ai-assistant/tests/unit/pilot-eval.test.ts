import { describe, expect, it, vi } from 'vitest'
import {
  applyVitestResult,
  buildEvalRecord,
  evaluatePrSummary,
  evaluateTestProposal,
  serializeEvalRecord,
} from '@/app/lib/pilot-eval'
import type { PrSummaryProposal, TestProposal } from '@/app/lib/pilot-tasks'
import type { PilotTrace } from '@/app/lib/pilot-traces'

const SAFE_CODE = [
  "import { describe, expect, it } from 'vitest'",
  "import { pilotTaskLabel } from '../../app/lib/pilot-llm'",
  "describe('pilot-llm', () => {",
  "  it('etiqueta la tarea', () => {",
  "    expect(pilotTaskLabel('pr-summary')).toBe('resumidor de PR')",
  '  })',
  '})',
].join('\n')

function proposal(overrides: Partial<TestProposal> = {}): TestProposal {
  return {
    path: 'tests/unit/piloto-generado-eval.test.ts',
    code: SAFE_CODE,
    notes: [],
    ...overrides,
  }
}

function trace(): PilotTrace {
  return {
    id: 'traza-123',
    ts: '2026-11-20T10:00:00.000Z',
    task: 'test-generation',
    repo: 'owner/repo',
    prompt: 'prompt',
    tools: [],
    output: 'salida',
    verdict: null,
    score: null,
    redactions: 0,
    byKind: {},
    truncated: false,
    meta: { mode: 'llm', changedFiles: ['app/lib/pilot-llm.ts'] },
  }
}

describe('evaluateTestProposal', () => {
  it('da 5 puntos a un test seguro que referencia el cambio', () => {
    const result = evaluateTestProposal({
      proposal: proposal(),
      changedFiles: ['app/lib/pilot-llm.ts'],
      pathExists: vi.fn(() => false),
    })

    expect(result.score).toBe(5)
    expect(result.safeToRun).toBe(true)
    expect(result.verdict).toBe('needs-review')
    expect(result.reasons).toContain('sin red, BD ni procesos')
    expect(result.reasons).toContain('referencia archivos del cambio')
  })

  it('rechaza código con red o secretos antes de ejecutarlo', () => {
    const result = evaluateTestProposal({
      proposal: proposal({ code: `${SAFE_CODE}\nfetch('https://ejemplo.test'); process.env.GROQ_API_KEY` }),
      changedFiles: [],
      pathExists: vi.fn(() => false),
    })

    expect(result.safeToRun).toBe(false)
    expect(result.verdict).toBe('ci-failed')
    expect(result.reasons.some((reason) => reason.startsWith('patrón prohibido'))).toBe(true)
  })

  it('permite un import dinámico de módulos seguros', () => {
    const result = evaluateTestProposal({
      proposal: proposal({ code: `${SAFE_CODE}\nconst extra = await import('vitest')` }),
      changedFiles: [],
      pathExists: vi.fn(() => false),
    })
    expect(result.safeToRun).toBe(true)
  })

  it('no permite sobrescribir un test existente', () => {
    const exists = vi.fn(() => true)
    const result = evaluateTestProposal({
      proposal: proposal({ path: 'tests/unit/pilot-run.test.ts' }),
      changedFiles: [],
      pathExists: exists,
    })

    expect(exists).toHaveBeenCalledWith('tests/unit/pilot-run.test.ts')
    expect(result.safeToRun).toBe(false)
    expect(result.reasons).toContain('path inválido o ya existe')
  })
})

describe('evaluatePrSummary', () => {
  const good: PrSummaryProposal = {
    title: 'Conecta el piloto con Groq',
    body: [
      '## Qué cambia',
      'Añade pilot-llm.ts y pilot-run.ts.',
      '',
      '## Por qué',
      'Genera trazas reales.',
      '',
      '## Validación',
      'Pendiente de validar en CI.',
    ].join('\n'),
  }

  it('aprueba un resumen completo que menciona archivos', () => {
    const result = evaluatePrSummary(good, ['app/lib/pilot-llm.ts'])
    expect(result.score).toBe(5)
    expect(result.verdict).toBe('ci-passed')
    expect(result.safeToRun).toBe(false)
  })

  it('falla si faltan secciones', () => {
    const result = evaluatePrSummary({ title: 'Cambio', body: 'Sin secciones.' }, [])
    expect(result.verdict).toBe('ci-failed')
    expect(result.reasons).toContain('falta ## Qué cambia')
  })
})

describe('applyVitestResult', () => {
  const base = evaluateTestProposal({
    proposal: proposal(),
    changedFiles: ['app/lib/pilot-llm.ts'],
    pathExists: vi.fn(() => false),
  })

  it('marca ci-passed cuando vitest termina en verde', () => {
    const result = applyVitestResult(base, { exitCode: 0, stdout: '1 passed', stderr: '' })
    expect(result.verdict).toBe('ci-passed')
    expect(result.score).toBe(5)
    expect(result.reasons.some((reason) => reason.startsWith('vitest en verde'))).toBe(true)
  })

  it('descuenta un punto y marca ci-failed cuando vitest falla', () => {
    const result = applyVitestResult(base, {
      exitCode: 1,
      stdout: '',
      stderr: 'FAIL tests/unit/piloto-generado-eval.test.ts',
    })
    expect(result.verdict).toBe('ci-failed')
    expect(result.score).toBe(4)
    expect(result.reasons.join('\n')).toContain('vitest falló (1)')
  })
})

describe('buildEvalRecord', () => {
  it('anonimiza los detalles y conserva la traza de origen', () => {
    const evaluation = applyVitestResult(
      evaluateTestProposal({
        proposal: proposal(),
        changedFiles: [],
        pathExists: vi.fn(() => false),
      }),
      { exitCode: 0, stdout: 'contacto ana@ejemplo.com', stderr: '' },
    )
    const record = buildEvalRecord({
      trace: trace(),
      evaluation,
      details: 'correo ana@ejemplo.com',
      now: () => new Date('2026-11-20T11:00:00.000Z'),
    })

    expect(record.traceId).toBe('traza-123')
    expect(record.task).toBe('test-generation')
    expect(record.verdict).toBe('ci-passed')
    expect(record.details).toBe('correo <email>')
    expect(record.reasons.join('\n')).toContain('<email>')
    expect(record.ts).toBe('2026-11-20T11:00:00.000Z')
    expect(serializeEvalRecord(record).endsWith('\n')).toBe(true)
  })
})
