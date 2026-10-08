/**
 * Medición LOCAL del contexto de ARIA (cero red, cero API).
 *
 * Desglosa cuántos tokens estimados ocupa cada pieza que viaja al modelo en un
 * turno típico — system prompt, bloque de memoria, resumen y ventana visible —
 * y lo compara con el historial completo "ingenuo". Sirve para verificar a ojo
 * el ahorro de la FASE 1 (prompt recortado, memoria topada, compactación) sin
 * gastar ni un token real.
 *
 * La estimación es chars/3.5 (`app/lib/tokens.ts`): aproximada para presupuestar,
 * nunca para facturar. Este script NO hace fetch. Para correrlo:
 *
 *   npm run tokens:measure
 */
import { pathToFileURL } from 'node:url'
import {
  SYSTEM_PROMPT,
  buildContextMessages,
  composeMemoryBlock,
  CHEAP_MODEL,
  MAX_VISIBLE_MESSAGES,
  MODEL_CONFIG,
  type ChatMessage,
  type MemoryLine,
} from '../app/lib/aria-core'
import {
  DEFAULT_CONTEXT_BUDGET,
  estimateMessagesTokens,
  estimateTokens,
} from '../app/lib/tokens'

/** Memoria de ejemplo: relevante primero, luego relleno (como la real). */
const SAMPLE_MEMORY: MemoryLine[] = [
  {
    key: 'stack',
    line: 'Stack: Next.js + Cloudflare Workers + Prisma (WASM) + Groq free.',
    relevant: true,
    memoryId: 'mem-stack',
  },
  {
    key: 'presupuesto',
    line: 'Restricción dura: cero costo. Solo Groq free, Workers AI free y embeddings locales.',
    relevant: true,
    memoryId: 'mem-cero',
  },
  {
    key: 'db',
    line: 'PostgreSQL en Neon (prod) y Postgres 18 local en el puerto 5433 (tests).',
  },
  {
    key: 'editor',
    line: 'Prefiere VS Code y TypeScript; evita añadir dependencias nuevas.',
  },
  {
    key: 'idioma',
    line: 'Escribe y responde en español, con respuestas directas.',
  },
  {
    key: 'deploy',
    line: 'Deploy: opennextjs-cloudflare build + patch-opennext-wasm.mjs + deploy.',
  },
  {
    key: 'fuera-de-tope',
    line: 'Este recuerdo sobra: el bloque topa en 6 líneas y no debería contarse.',
  },
]

/** Conversación de ejemplo de 40 mensajes (más que la ventana visible). */
const SAMPLE_HISTORY: ChatMessage[] = Array.from({ length: 40 }, (_, i): ChatMessage => {
  const role = i % 2 === 0 ? 'user' : 'assistant'
  return {
    role,
    content:
      role === 'user'
        ? `Consulta ${i + 1}: ¿cómo estructuro el contexto de ARIA para no gastar cuota en charla normal?`
        : `Respuesta ${i + 1}: separo lo relevante del relleno, topo la memoria y compacto el historial.`,
  }
})

/** Resumen ya persistido (no lo generamos aquí: eso sería una llamada real). */
const SAMPLE_SUMMARY =
  'El usuario está reduciendo el costo por mensaje de ARIA sin añadir proveedores. ' +
  'Se decidió que el system prompt no duplique las definiciones de herramientas, ' +
  'que la memoria tenga tope de líneas y caracteres, que solo lo relevante se ' +
  'refuerce, y que el historial se compacte de forma incremental guardando cuántos ' +
  'mensajes ya están resumidos. En charla normal no se manda ningún schema de ' +
  'herramientas y las tareas de fondo usan el modelo barato solo si tiene cuota.'

export interface TokenRow {
  label: string
  tokens: number
}

export interface TokenReport {
  rows: TokenRow[]
  /** Tokens estimados del system prompt. */
  system: number
  /** Tokens del bloque de memoria inyectado (ya topado). */
  memory: number
  /** Tokens del mensaje de resumen. */
  summary: number
  /** Tokens de los últimos `MAX_VISIBLE_MESSAGES` mensajes. */
  visibleWindow: number
  /** Total que viaja al modelo: system + memoria + resumen + ventana. */
  contextTotal: number
  /** Total "ingenuo": system + memoria + TODO el historial. */
  fullHistoryTotal: number
  /** Tokens que se ahorran frente al historial completo. */
  saved: number
  /** Ahorro en porcentaje (0-100). */
  savedPercent: number
  /** Presupuesto de entrada del modelo barato. */
  budget: number
  /** ¿El contexto final cabe en el presupuesto? */
  withinBudget: boolean
}

/**
 * Calcula el desglose de tokens de un turno típico. Función PURA y síncrona:
 * no hace red, ni toca la base de datos, ni llama a ningún modelo.
 */
export function buildTokenReport(): TokenReport {
  const system = estimateTokens(SYSTEM_PROMPT)

  const memoryBlock = composeMemoryBlock(SAMPLE_MEMORY)
  const memory = estimateMessagesTokens([
    { role: 'system', content: memoryBlock.lines.join('\n') },
  ])

  const contextMessages = buildContextMessages(SAMPLE_HISTORY, SAMPLE_SUMMARY)
  const visibleCount = Math.min(SAMPLE_HISTORY.length, MAX_VISIBLE_MESSAGES)
  const visibleWindow = estimateMessagesTokens(contextMessages.slice(-visibleCount))
  const summary = estimateMessagesTokens(contextMessages.slice(0, -visibleCount))

  const contextTotal = system + memory + summary + visibleWindow
  const fullHistoryTotal =
    system + memory + estimateMessagesTokens(SAMPLE_HISTORY)
  const saved = Math.max(0, fullHistoryTotal - contextTotal)
  const savedPercent = fullHistoryTotal > 0 ? Math.round((saved / fullHistoryTotal) * 100) : 0
  const budget = MODEL_CONFIG[CHEAP_MODEL]?.contextBudget ?? DEFAULT_CONTEXT_BUDGET

  const rows: TokenRow[] = [
    { label: 'System prompt', tokens: system },
    { label: 'Bloque de memoria (topado)', tokens: memory },
    { label: 'Mensaje de resumen', tokens: summary },
    { label: `Ventana visible (últimos ${visibleCount})`, tokens: visibleWindow },
    { label: 'Contexto final', tokens: contextTotal },
    { label: 'Historial completo (ingenuo)', tokens: fullHistoryTotal },
  ]

  return {
    rows,
    system,
    memory,
    summary,
    visibleWindow,
    contextTotal,
    fullHistoryTotal,
    saved,
    savedPercent,
    budget,
    withinBudget: contextTotal <= budget,
  }
}

/** Formatea el reporte como texto legible para la consola. */
export function formatReport(report: TokenReport): string {
  const width = Math.max(...report.rows.map((r) => r.label.length), 'Presupuesto'.length)
  const line = (label: string, tokens: number) =>
    `  ${label.padEnd(width)}  ${String(tokens).padStart(6)} tok`

  const lines = [
    'ARIA · estimación local de tokens (chars/3.5, sin API)',
    '',
    ...report.rows.map((r) => line(r.label, r.tokens)),
    line('Presupuesto del modelo barato', report.budget),
    '',
    `Ahorro frente al historial completo: ${report.saved} tok (${report.savedPercent}%)`,
    report.withinBudget
      ? `✅ El contexto final cabe en el presupuesto (${report.contextTotal} ≤ ${report.budget}).`
      : `❌ El contexto final EXCEDE el presupuesto (${report.contextTotal} > ${report.budget}).`,
  ]
  return lines.join('\n')
}

function main(): void {
  const report = buildTokenReport()
  console.log(formatReport(report))
  if (!report.withinBudget) process.exit(1)
}

// Solo corre como CLI: importarlo desde un test no debe imprimir ni salir.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) main()
