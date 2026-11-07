/**
 * Lógica pura del generador del dataset de Fase 6.
 *
 * Vive aparte del CLI para poder probarla con Vitest sin base de datos ni red.
 * El CLI (`scripts/build-lora-dataset.ts`) solo lee la BD, elige opciones y
 * escribe el JSONL.
 */
import { scrubText } from '../app/lib/scrub'

export const DEFAULT_SYSTEM =
  'Eres ARIA, un asistente de IA para programadores e ingenieros. Piensas paso a paso, razonas con cuidado y escribes código listo para producción. Eres directo, preciso y honesto.'

export type Rol = 'system' | 'user' | 'assistant'

export type Turno = { role: Rol; content: string }

export interface MensajeEntrada {
  role: string
  content: string
  /** Llamadas a herramientas persistidas en `Message.tools` (opcional). */
  tools?: unknown
}

export interface ConversacionEntrada {
  id: string
  title: string
  messages: MensajeEntrada[]
  /** `true` para el set curado que vive en `scripts/lora-seed.ts`. */
  synthetic?: boolean
}

export interface EjemploDataset {
  messages: Turno[]
}

export interface OpcionesDataset {
  system: string
  /** `turn`: un ejemplo por respuesta del asistente. `conversation`: uno por charla. */
  mode: 'turn' | 'conversation'
  /** Añade un bloque de texto con las herramientas usadas (si existen). */
  withTools: boolean
  /** Descarta respuestas del asistente más cortas que esto. */
  minAssistantChars: number
  /**
   * Mensajes previos que acompañan a cada respuesta (incluida ella).
   * `0` = todo el historial anterior.
   */
  maxContextMessages: number
  /** Evita ejemplos idénticos. */
  dedupe: boolean
}

export interface Informe {
  conversaciones: number
  conversacionesReales: number
  conversacionesSinteticas: number
  ejemplos: number
  ejemplosReales: number
  ejemplosSinteticos: number
  descartadas: number
  duplicados: number
  mensajes: number
  mensajesConHerramientas: number
  maxCaracteresMensaje: number
  redacciones: number
  porCategoria: Record<string, number>
}

export function crearInforme(): Informe {
  return {
    conversaciones: 0,
    conversacionesReales: 0,
    conversacionesSinteticas: 0,
    ejemplos: 0,
    ejemplosReales: 0,
    ejemplosSinteticos: 0,
    descartadas: 0,
    duplicados: 0,
    mensajes: 0,
    mensajesConHerramientas: 0,
    maxCaracteresMensaje: 0,
    redacciones: 0,
    porCategoria: {},
  }
}

export function opcionesPorDefecto(overrides: Partial<OpcionesDataset> = {}): OpcionesDataset {
  return {
    system: DEFAULT_SYSTEM,
    mode: 'turn',
    withTools: false,
    minAssistantChars: 1,
    maxContextMessages: 12,
    dedupe: true,
    ...overrides,
  }
}

function texto(value: unknown, max = 400): string {
  if (typeof value === 'string') return value.slice(0, max)
  try {
    return JSON.stringify(value).slice(0, max)
  } catch {
    return ''
  }
}

/**
 * Convierte `Message.tools` en un bloque legible. No incluye el JSON crudo
 * completo: recorta argumentos/resultados para no inflar el ejemplo.
 */
export function formatearHerramientas(tools: unknown, maxResultChars = 400): string {
  if (tools == null) return ''
  const lista = Array.isArray(tools) ? tools : [tools]
  const lineas: string[] = []

  for (const raw of lista.slice(0, 8)) {
    if (raw == null || typeof raw !== 'object') continue
    const t = raw as { name?: unknown; args?: unknown; result?: unknown; status?: unknown }
    const nombre = typeof t.name === 'string' && t.name ? t.name : 'herramienta'
    const args = t.args == null ? '{}' : texto(t.args, 300)
    const estado = typeof t.status === 'string' ? t.status : 'done'
    const resultado = t.result == null ? '' : texto(t.result, maxResultChars)
    lineas.push(
      `- ${nombre}(${args}) [${estado}]${resultado ? ` -> ${resultado}` : ''}`,
    )
  }

  return lineas.length > 0 ? `[Herramientas usadas]\n${lineas.join('\n')}` : ''
}

function acumularRedacciones(
  informe: Informe,
  limpio: ReturnType<typeof scrubText>,
): void {
  informe.redacciones += limpio.redactions
  for (const [k, n] of Object.entries(limpio.byKind)) {
    informe.porCategoria[k] = (informe.porCategoria[k] ?? 0) + (n ?? 0)
  }
}

/** Limpia y normaliza una conversación; devuelve solo turnos user/assistant. */
function limpiarMensajes(
  conv: ConversacionEntrada,
  options: OpcionesDataset,
  informe: Informe,
): Turno[] {
  const turnos: Turno[] = []

  for (const m of conv.messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue

    const limpio = scrubText(m.content)
    acumularRedacciones(informe, limpio)
    const content = limpio.text.trim()

    let toolsText = ''
    if (m.role === 'assistant' && options.withTools) {
      const raw = formatearHerramientas(m.tools)
      if (raw) {
        const toolsLimpio = scrubText(raw)
        acumularRedacciones(informe, toolsLimpio)
        toolsText = toolsLimpio.text.trim()
        informe.mensajesConHerramientas++
      }
    }

    if (!content && !toolsText) continue
    const final = [content, toolsText].filter(Boolean).join('\n\n')
    turnos.push({ role: m.role, content: final })
    informe.maxCaracteresMensaje = Math.max(informe.maxCaracteresMensaje, final.length)
  }

  return turnos
}

/**
 * Construye los ejemplos. En modo `turn` cada respuesta del asistente genera
 * un ejemplo con el contexto anterior; en `conversation` se mantiene el
 * comportamiento antiguo (una charla = un ejemplo).
 */
export function construirEjemplos(
  conversaciones: ConversacionEntrada[],
  options: OpcionesDataset,
  informe: Informe,
): EjemploDataset[] {
  const ejemplos: EjemploDataset[] = []
  const vistos = new Set<string>()

  function agregar(conv: ConversacionEntrada, turnos: Turno[]): boolean {
    if (!turnos.some((t) => t.role === 'user')) return false
    if (!turnos.some((t) => t.role === 'assistant')) return false

    const messages: Turno[] = [
      { role: 'system', content: options.system },
      ...turnos,
    ]
    const clave = JSON.stringify(messages)
    if (options.dedupe && vistos.has(clave)) {
      informe.duplicados++
      return false
    }
    vistos.add(clave)

    ejemplos.push({ messages })
    informe.ejemplos++
    if (conv.synthetic) informe.ejemplosSinteticos++
    else informe.ejemplosReales++
    informe.mensajes += turnos.length
    return true
  }

  for (const conv of conversaciones) {
    informe.conversaciones++
    if (conv.synthetic) informe.conversacionesSinteticas++
    else informe.conversacionesReales++

    const turnos = limpiarMensajes(conv, options, informe)
    const respuestas = turnos
      .map((t, i) => (t.role === 'assistant' ? i : -1))
      .filter((i) => i >= 0)

    if (respuestas.length === 0) {
      informe.descartadas++
      continue
    }

    let escritos = 0

    if (options.mode === 'conversation') {
      if (agregar(conv, turnos)) escritos++
    } else {
      for (const i of respuestas) {
        const respuesta = turnos[i]
        if (respuesta.content.length < options.minAssistantChars) continue

        const desde =
          options.maxContextMessages > 0
            ? Math.max(0, i - options.maxContextMessages + 1)
            : 0
        const ventana = turnos.slice(desde, i + 1)
        if (!ventana.some((t) => t.role === 'user')) continue
        if (agregar(conv, ventana)) escritos++
      }
    }

    if (escritos === 0) informe.descartadas++
  }

  return ejemplos
}

/** Serializa a JSONL: un objeto por línea, con salto final si hay ejemplos. */
export function aJsonl(ejemplos: EjemploDataset[]): string {
  if (ejemplos.length === 0) return ''
  return ejemplos.map((e) => JSON.stringify(e)).join('\n') + '\n'
}
