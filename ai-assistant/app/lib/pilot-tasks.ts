/**
 * Dos aplicaciones del piloto: generar un test unitario y resumir un PR.
 *
 * Son funciones puras: construyen el prompt con el system prompt de producción
 * y parsean la respuesta del modelo sin llamar a la red. El LLM se inyecta en
 * quien ejecute el piloto, así que los tests pueden sustituirlo por un mock.
 */

import type { PilotTaskName } from '@/app/lib/pilot-traces'
import { sliceWindow } from '@/app/lib/truncate'

const DIFF_CHARS = 4_000
const PROMPT_CHARS = 1_500

export interface TestGenerationInput {
  diff: string
  changedFiles: string[]
  systemPrompt: string
  existingTests?: string[]
}

export interface PrSummaryInput {
  diff: string
  commits: string[]
  systemPrompt: string
  repo?: string
}

export interface TestProposal {
  path: string
  code: string
  notes: string[]
}

export interface PrSummaryProposal {
  title: string
  body: string
}

function window(text: string, max: number): string {
  return sliceWindow(text, 0, max).content
}

function bullets(items: string[], fallback: string): string {
  const clean = items.filter(Boolean).slice(0, 20).map((item) => `- ${item}`)
  return clean.length ? clean.join('\n') : fallback
}

/** Prompt para proponer UN test unitario nuevo, con el formato que espera el parser. */
export function buildTestGenerationPrompt(input: TestGenerationInput): string {
  return [
    'SYSTEM DE PRODUCCIÓN (respétalo, no lo resumas):',
    window(input.systemPrompt, PROMPT_CHARS),
    '',
    'TAREA: propón UN archivo nuevo de tests unitarios para el cambio mostrado.',
    'Reglas: Vitest; usa vi.mock si el módulo tiene efectos; sin red, sin BD real, sin secretos.',
    'ANTES de importar un símbolo, verifica que aparezca en el DIFF; si no aparece, no lo uses.',
    'No inventes nombres parecidos: copia el export exacto del diff. Si el diff está truncado, reduces el test a lo observable.',
    'El archivo debe vivir en tests/unit/ y terminar en .test.ts.',
    'El path debe ser NUEVO: no sobrescribas ningún test existente; usa tests/unit/piloto-generado-<nombre>.test.ts.',
    'Máximo 40 líneas; cierra siempre el bloque ```. No expliques el código fuera del formato.',
    'Devuelve exactamente este formato, sin texto adicional:',
    'ARCHIVO: tests/unit/ejemplo.test.ts',
    '```ts',
    '...código del test...',
    '```',
    '- nota opcional (una por línea)',
    '',
    'Archivos cambiados:',
    bullets(input.changedFiles, '- (no se indicaron)'),
    '',
    'Tests existentes:',
    bullets(input.existingTests ?? [], '- (ninguno)'),
    '',
    'DIFF:',
    window(input.diff, DIFF_CHARS),
  ].join('\n')
}

/** Extrae la ruta, el código y las notas de una propuesta de test. */
export function parseTestProposal(text: string): TestProposal | null {
  const pathMatch = text.match(/^\s*ARCHIVO:\s*(\S+\.test\.ts)\s*$/m)
  const codeMatch = text.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/i)
  if (!pathMatch || !codeMatch) return null

  const path = pathMatch[1].replace(/\\/g, '/').trim()
  if (!path.startsWith('tests/unit/') || path.includes('..')) return null

  const withoutCode = text.replace(/```[\s\S]*?```/g, '')
  const notes = withoutCode
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s+/, '').trim())
    .filter(Boolean)

  return { path, code: `${codeMatch[1].trim()}\n`, notes }
}

/** Prompt para generar título y cuerpo de PR en español. */
export function buildPrSummaryPrompt(input: PrSummaryInput): string {
  return [
    'SYSTEM DE PRODUCCIÓN (respétalo, no lo resumas):',
    window(input.systemPrompt, PROMPT_CHARS),
    '',
    'TAREA: resume este cambio como un PR listo para revisar, en español.',
    'Reglas: título de máximo 72 caracteres; cuerpo con Qué cambia, Por qué y Validación.',
    'No inventes datos. Si no ves validación, escribe " pendiente de validar".',
    'Devuelve exactamente este formato:',
    'TÍTULO: texto del título',
    '',
    '## Qué cambia',
    '...',
    '',
    '## Por qué',
    '...',
    '',
    '## Validación',
    '...',
    '',
    `Repositorio: ${input.repo ?? '(no indicado)'}`,
    '',
    'Commits:',
    bullets(input.commits, '- (sin mensajes)'),
    '',
    'DIFF:',
    window(input.diff, DIFF_CHARS),
  ].join('\n')
}

/** Extrae título y cuerpo de la respuesta del resumidor. */
export function parsePrSummary(text: string): PrSummaryProposal | null {
  const titleMatch = text.match(/^\s*(?:T[IÍ]TULO:|#)\s*(.+?)\s*$/im)
  if (!titleMatch?.[1]) return null

  const title = titleMatch[1].trim()
  if (!title) return null

  const afterTitle = text.indexOf('\n', text.indexOf(titleMatch[0]) + titleMatch[0].length)
  const body = afterTitle === -1 ? '' : text.slice(afterTitle).trim()
  if (!body) return null

  return { title: title.slice(0, 72), body }
}

/** Útil para el demo y para futuros reportes: el nombre canónico de cada tarea. */
export const PILOT_TASKS: readonly PilotTaskName[] = ['test-generation', 'pr-summary'] as const
