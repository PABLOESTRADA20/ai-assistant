import { describe, expect, it } from 'vitest'
import {
  buildTestgenDataset,
  bucketFor,
  groupOf,
  hash32,
  inventedSymbol,
  parseOptions,
  serializeTestgenJsonl,
  TESTGEN_SYSTEM,
  type TestgenOptions,
} from '@/app/lib/testgen-dataset'
import type { PilotEvalRecord, PilotTrace } from '@/app/lib/pilot-traces'

const opts = (overrides: Partial<TestgenOptions> = {}): TestgenOptions =>
  parseOptions([], overrides)

function trace(id: string, ref: string, extra: Partial<PilotTrace> = {}): PilotTrace {
  return {
    id,
    ts: '2026-11-23T16:00:00.000Z',
    task: 'test-generation',
    repo: 'PABLOESTRADA20/ai-assistant',
    prompt: `DIFF del PR ${ref}. Clave gsk_abcdefghijklmnopqrstuvwx1234.`,
    tools: [],
    output: 'ARCHIVO: tests/unit/ejemplo.test.ts\n```ts\nexpect(true).toBe(true)\n```',
    verdict: null,
    score: null,
    redactions: 0,
    byKind: {},
    truncated: false,
    meta: { ref, mode: 'llm' },
    ...extra,
  }
}

function evalRecord(
  traceId: string,
  verdict: 'ci-passed' | 'ci-failed',
  ts: string,
  reasons: string[] = ['sin red, BD ni procesos'],
  details: string | null = null,
): PilotEvalRecord {
  return {
    id: `eval-${traceId}-${ts}`,
    traceId,
    task: 'test-generation',
    verdict,
    score: verdict === 'ci-passed' ? 5 : 3,
    reasons,
    details,
    ts,
  }
}

function fixtures() {
  const traces = [
    trace('t1', 'ref-a'),
    trace('t2', 'ref-a'),
    trace('t3', 'ref-b'),
    trace('t4', 'ref-c'),
    trace('t5', 'ref-d'),
    trace('t6', 'ref-e', { task: 'pr-summary' }),
    trace('t7', 'ref-f'),
  ]
  const evals = [
    evalRecord('t1', 'ci-failed', '2026-11-20T00:00:00.000Z', ['path inválido']),
    evalRecord('t1', 'ci-passed', '2026-11-23T00:00:00.000Z', ['vitest en verde']),
    evalRecord('t2', 'ci-passed', '2026-11-23T00:00:00.000Z'),
    evalRecord('t3', 'ci-failed', '2026-11-23T00:00:00.000Z', [
      'no referencia los archivos cambiados',
      'vitest falló',
    ], 'TypeError: evaluatePilot is not a function'),
    evalRecord('t4', 'ci-passed', '2026-11-23T00:00:00.000Z'),
    evalRecord('t5', 'ci-passed', '2026-11-23T00:00:00.000Z'),
    evalRecord('t6', 'ci-passed', '2026-11-23T00:00:00.000Z'),
  ]
  return { traces, evals }
}

describe('helpers deterministas', () => {
  it('hash y bucket son estables', () => {
    expect(hash32('ref-a')).toBe(hash32('ref-a'))
    expect(bucketFor('ref-a')).toBe(bucketFor('ref-a'))
    expect(bucketFor('ref-a')).toBeGreaterThanOrEqual(0)
    expect(bucketFor('ref-a')).toBeLessThan(100)
  })

  it('el grupo es el PR de origen, no la traza', () => {
    const t = trace('t1', 'abc123')
    expect(groupOf(t)).toBe('ref:abc123')
    expect(groupOf({ ...t, meta: {} })).toBe('repo:PABLOESTRADA20/ai-assistant')
  })

  it('extrae el símbolo inventado del log de vitest', () => {
    expect(inventedSymbol('TypeError: evaluatePilot is not a function')).toBe('evaluatePilot')
    expect(inventedSymbol('AssertionError: esperado 1')).toBeNull()
    expect(inventedSymbol(null)).toBeNull()
  })
})

describe('parseOptions', () => {
  it('acepta banderas con y sin igual', () => {
    const options = parseOptions([
      '--traces=datos/trazas.jsonl',
      '--evals',
      'datos/eval.jsonl',
      '--out',
      'datos/salida',
      '--held-out=25',
      '--patience=3',
      '--min-delta=0.01',
      '--dry',
    ])
    expect(options.tracesPath).toBe('datos/trazas.jsonl')
    expect(options.evalsPath).toBe('datos/eval.jsonl')
    expect(options.outDir).toBe('datos/salida')
    expect(options.heldOutPercent).toBe(25)
    expect(options.patience).toBe(3)
    expect(options.minDelta).toBe(0.01)
    expect(options.dryRun).toBe(true)
  })

  it('rechaza valores fuera de rango', () => {
    expect(() => parseOptions(['--held-out=101'])).toThrow(/0 y 100/)
    expect(() => parseOptions(['--patience=0'])).toThrow(/>= 1/)
    expect(() => parseOptions(['--min-delta=-1'])).toThrow(/negativo/)
  })
})

describe('buildTestgenDataset', () => {
  it('usa la última evaluación y descarta tareas ajenas', () => {
    const { traces, evals } = fixtures()
    const { examples, report } = buildTestgenDataset(traces, evals, opts())

    expect(report.traces).toBe(7)
    expect(report.wrongTask).toBe(1)
    expect(report.withoutEval).toBe(1)
    expect(report.examples).toBe(5)
    expect(report.byVerdict).toEqual({ 'ci-passed': 4, 'ci-failed': 1 })
    expect(examples.find((example) => example.id.endsWith(hash32('t1').toString(16)))).toMatchObject({
      verdict: 'ci-passed',
      score: 5,
    })
  })

  it('no mezcla un mismo PR entre train y valid', () => {
    const { traces, evals } = fixtures()
    const { examples } = buildTestgenDataset(traces, evals, opts({ heldOutPercent: 45 }))
    const byGroup = new Map<string, Set<string>>()

    for (const example of examples) {
      const splits = byGroup.get(example.group) ?? new Set<string>()
      splits.add(example.split)
      byGroup.set(example.group, splits)
    }
    for (const splits of byGroup.values()) expect(splits.size).toBe(1)
    expect(examples.some((example) => example.split === 'valid')).toBe(true)
    expect(examples.some((example) => example.split === 'train')).toBe(true)
  })

  it('fuerza un grupo held-out si el hash no eligió ninguno', () => {
    const { traces, evals } = fixtures()
    const { report } = buildTestgenDataset(traces, evals, opts({ heldOutPercent: 1 }))
    expect(report.valid).toBeGreaterThan(0)
    expect(report.forcedHeldOut).toBe(true)
  })

  it('con 0% no fuerza validación; con 100% todo es validación', () => {
    const { traces, evals } = fixtures()
    expect(buildTestgenDataset(traces, evals, opts({ heldOutPercent: 0 })).report.valid).toBe(0)
    expect(buildTestgenDataset(traces, evals, opts({ heldOutPercent: 100 })).report.train).toBe(0)
  })

  it('los ejemplos llevan ReAct y la corrección sin repetir código fallido', () => {
    const { traces, evals } = fixtures()
    const { examples } = buildTestgenDataset(traces, evals, opts({ heldOutPercent: 0 }))
    const failed = examples.find((example) => example.verdict === 'ci-failed')!
    const passed = examples.find((example) => example.verdict === 'ci-passed')!

    expect(failed.messages[0].content).toBe(TESTGEN_SYSTEM)
    for (const step of ['Pensamiento:', 'Acción:', 'Observación:', 'Respuesta:']) {
      expect(failed.messages[2].content).toContain(step)
    }
    expect(failed.messages[2].content).toContain('No entrego la propuesta original')
    expect(failed.messages[2].content).toContain('evaluatePilot no existe en el cambio')
    expect(failed.messages[2].content).not.toContain('evaluatePilot is not a function')
    expect(passed.messages[2].content).toContain('ci-passed')
    expect(passed.messages[2].content).toContain('ARCHIVO:')
  })

  it('vuelve a anonimizar y lo cuenta en el informe', () => {
    const { traces, evals } = fixtures()
    const { report, examples } = buildTestgenDataset(traces, evals, opts({ heldOutPercent: 0 }))
    expect(report.redactions).toBeGreaterThan(0)
    expect(report.byKind['api-key']).toBeGreaterThan(0)
    expect(examples[0].messages[1].content).toContain('<clave>')
    expect(examples[0].messages[1].content).not.toContain('gsk_')
  })

  it('el manifest fija early stopping sobre valid_loss', () => {
    const { traces, evals } = fixtures()
    const { manifest } = buildTestgenDataset(traces, evals, opts({ patience: 4, minDelta: 0.02 }))
    expect(manifest.earlyStopping).toEqual({
      monitor: 'valid_loss',
      mode: 'min',
      patience: 4,
      minDelta: 0.02,
    })
    expect(manifest.privacy).toEqual({ scrubbed: true, publicUploadForbidden: true })
  })

  it('serializa solo messages, igual que el dataset de chat', () => {
    const { traces, evals } = fixtures()
    const { examples } = buildTestgenDataset(traces, evals, opts({ heldOutPercent: 0 }))
    const lines = serializeTestgenJsonl(examples).trim().split('\n')
    expect(lines).toHaveLength(examples.length)
    expect(Object.keys(JSON.parse(lines[0]))).toEqual(['messages'])
  })
})
