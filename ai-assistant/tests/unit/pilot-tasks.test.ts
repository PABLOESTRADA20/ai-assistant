import { describe, expect, it } from 'vitest'
import {
  buildPrSummaryPrompt,
  buildTestGenerationPrompt,
  parsePrSummary,
  parseTestProposal,
  PILOT_TASKS,
} from '@/app/lib/pilot-tasks'

const SYSTEM = 'Eres ARIA. Responde en español y verifica antes de dar por bueno.'

describe('buildTestGenerationPrompt', () => {
  it('incluye el system prompt, reglas, archivos y diff', () => {
    const prompt = buildTestGenerationPrompt({
      systemPrompt: SYSTEM,
      diff: '+ const nueva = 1',
      changedFiles: ['app/lib/nuevo.ts'],
      existingTests: ['tests/unit/viejo.test.ts'],
    })

    expect(prompt).toContain('SYSTEM DE PRODUCCIÓN')
    expect(prompt).toContain(SYSTEM)
    expect(prompt).toContain('vi.mock')
    expect(prompt).toContain('tests/unit/')
    expect(prompt).toContain('Máximo 40 líneas')
    expect(prompt).toContain('app/lib/nuevo.ts')
    expect(prompt).toContain('tests/unit/viejo.test.ts')
    expect(prompt).toContain('+ const nueva = 1')
  })

  it('recorta diffs y system prompts enormes', () => {
    const prompt = buildTestGenerationPrompt({
      systemPrompt: 'S'.repeat(9_000),
      diff: 'D'.repeat(20_000),
      changedFiles: [],
    })

    expect(prompt).toContain('S'.repeat(1_500))
    expect(prompt).not.toContain('S'.repeat(1_501))
    expect(prompt).toContain('D'.repeat(4_000))
    expect(prompt).not.toContain('D'.repeat(4_001))
  })
})

describe('parseTestProposal', () => {
  const valid = [
    'ARCHIVO: tests/unit/nuevo.test.ts',
    '```ts',
    "import { describe, expect, it } from 'vitest'",
    '- esto parece nota pero está dentro del código',
    "describe('nuevo', () => { it('ok', () => expect(1).toBe(1)) })",
    '```',
    '- usa vi.mock si el módulo toca red',
    '- sin BD real',
  ].join('\n')

  it('extrae ruta, código y notas fuera del bloque de código', () => {
    const proposal = parseTestProposal(valid)

    expect(proposal).not.toBeNull()
    expect(proposal?.path).toBe('tests/unit/nuevo.test.ts')
    expect(proposal?.code).toContain("describe('nuevo'")
    expect(proposal?.notes).toEqual([
      'usa vi.mock si el módulo toca red',
      'sin BD real',
    ])
  })

  it('normaliza barras invertidas', () => {
    expect(parseTestProposal(valid.replace('tests/unit/', 'tests\\unit\\'))?.path).toBe(
      'tests/unit/nuevo.test.ts',
    )
  })

  it('rechaza rutas fuera de tests/unit o con navegación', () => {
    expect(parseTestProposal(valid.replace('tests/unit/nuevo', 'app/nuevo'))).toBeNull()
    expect(parseTestProposal(valid.replace('tests/unit/nuevo', 'tests/unit/../nuevo'))).toBeNull()
  })

  it('rechaza respuestas sin bloque de código', () => {
    expect(parseTestProposal('ARCHIVO: tests/unit/nuevo.test.ts\nsin código')).toBeNull()
  })
})

describe('buildPrSummaryPrompt', () => {
  it('incluye repo, commits, formato y diff', () => {
    const prompt = buildPrSummaryPrompt({
      systemPrompt: SYSTEM,
      diff: '- antes\n+ después',
      commits: ['abc123 arregla el parser'],
      repo: 'owner/repo',
    })

    expect(prompt).toContain(SYSTEM)
    expect(prompt).toContain('TÍTULO:')
    expect(prompt).toContain('owner/repo')
    expect(prompt).toContain('abc123 arregla el parser')
    expect(prompt).toContain('- antes\n+ después')
  })
})

describe('parsePrSummary', () => {
  it('extrae título y cuerpo', () => {
    const proposal = parsePrSummary([
      'TÍTULO: Corrige el parser de regex',
      '',
      '## Qué cambia',
      'Ignora llaves dentro de literales.',
      '',
      '## Validación',
      'npm run test:unit',
    ].join('\n'))

    expect(proposal?.title).toBe('Corrige el parser de regex')
    expect(proposal?.body).toContain('## Qué cambia')
    expect(proposal?.body).toContain('npm run test:unit')
  })

  it('acepta título con # y limita su longitud', () => {
    const proposal = parsePrSummary(`# ${'x'.repeat(100)}\n\nCuerpo`)
    expect(proposal?.title).toHaveLength(72)
    expect(proposal?.body).toBe('Cuerpo')
  })

  it('rechaza respuestas sin título o sin cuerpo', () => {
    expect(parsePrSummary('solo texto')).toBeNull()
    expect(parsePrSummary('TÍTULO: ') ).toBeNull()
    expect(parsePrSummary('TÍTULO: algo')).toBeNull()
  })
})

describe('PILOT_TASKS', () => {
  it('son exactamente las dos aplicaciones del piloto', () => {
    expect(PILOT_TASKS).toEqual(['test-generation', 'pr-summary'])
  })
})
