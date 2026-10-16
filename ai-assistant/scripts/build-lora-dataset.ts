import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * Generador del conjunto de datos de entrenamiento (FASE 6).
 *
 *   npm run db:dataset                 # exporta tus conversaciones (anonimizadas)
 *   npm run db:dataset -- --fake       # autoprueba con datos inventados (no usa la BD)
 *   npm run db:dataset -- --dry        # solo informe, no escribe el archivo
 *   npm run db:dataset -- --limit=50   # como mucho 50 conversaciones
 *   npm run db:dataset -- --out=otra/ruta.jsonl
 *
 * Qué hace: lee las conversaciones y sus mensajes de la base de datos, los pasa
 * por el anonimizador (`app/lib/scrub.ts`) y escribe un archivo JSONL en formato
 * "chat", que es el que entienden casi todas las herramientas de entrenamiento:
 *
 *   {"messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
 *
 * REGLAS (ROADMAP, FASE 6):
 *   - NUNCA se sube a un repositorio público de Hugging Face.
 *   - El archivo vive en `data/lora/`, que está en `.gitignore`.
 *   - Antes de entrenar, revisar el informe: secretos y datos personales = 0.
 *
 * Los mensajes con herramientas (`tools`) no se incluyen todavía: esta primera
 * versión entrena estilo y conversación. Las llamadas a herramientas quedarán
 * para una segunda versión, cuando la base LoRA deje de dar error 500.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { scrubText } from '../app/lib/scrub'

/** Línea de sistema del dataset. Se puede pisar con ARIA_DATASET_SYSTEM. */
const SISTEMA =
  process.env.ARIA_DATASET_SYSTEM ??
  'Eres ARIA, un asistente de IA para programadores e ingenieros. Piensas paso a paso, razonas con cuidado y escribes código listo para producción. Eres directo, preciso y honesto.'

type Turno = { role: 'system' | 'user' | 'assistant'; content: string }

type ConversacionEntrada = {
  id: string
  title: string
  messages: Array<{ role: string; content: string }>
}

type Informe = {
  conversaciones: number
  ejemplos: number
  descartadas: number
  mensajes: number
  maxCaracteresMensaje: number
  redacciones: number
  porCategoria: Record<string, number>
}

/** Acepta `--clave`, `--clave=valor` y `--clave valor`. */
function arg(nombre: string): string | true | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i === -1) return undefined
  const siguiente = process.argv[i + 1]
  if (!siguiente || siguiente.startsWith('--')) return true
  return siguiente
}

function valor(nombre: string, porDefecto: number): number {
  const v = arg(nombre)
  return typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : porDefecto
}

/**
 * Convierte UNA conversación en un ejemplo de entrenamiento, o `null` si no
 * sirve (sin respuestas del asistente).
 */
function aEjemplo(
  conv: ConversacionEntrada,
  informe: Informe,
): { messages: Turno[] } | null {
  const turnos: Turno[] = [{ role: 'system', content: SISTEMA }]
  let respuestas = 0

  for (const m of conv.messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const limpio = scrubText(m.content)
    informe.redacciones += limpio.redactions
    for (const [k, n] of Object.entries(limpio.byKind)) {
      informe.porCategoria[k] = (informe.porCategoria[k] ?? 0) + (n ?? 0)
    }
    if (!limpio.text.trim()) continue
    informe.maxCaracteresMensaje = Math.max(informe.maxCaracteresMensaje, limpio.text.length)
    if (m.role === 'assistant') respuestas++
    turnos.push({ role: m.role, content: limpio.text })
  }

  if (respuestas === 0) return null
  return { messages: turnos }
}

/** Datos inventados: sirven para probar el circuito completo sin tocar la BD. */
function conversacionesFalsas(): ConversacionEntrada[] {
  return [
    {
      id: 'fake-1',
      title: 'Cómo ordenar una lista',
      messages: [
        { role: 'user', content: '¿Cómo ordeno una lista de números en Python?' },
        {
          role: 'assistant',
          content:
            'Con `sorted()`, que devuelve una lista nueva:\n\n```python\nnumeros = [3, 1, 2]\nordenados = sorted(numeros)\n```',
        },
      ],
    },
    {
      id: 'fake-2',
      title: 'Con datos que deben borrarse',
      messages: [
        {
          role: 'user',
          content:
            'Mi correo es ana@ejemplo.com y mi clave es gsk_abcdefghijklmnopqrstuvwx1234. Vivo en la IP 10.0.0.7.',
        },
        { role: 'assistant', content: 'Perfecto, tomo nota.' },
      ],
    },
    {
      id: 'fake-3',
      title: 'Conversación sin respuesta (se descarta)',
      messages: [{ role: 'user', content: 'Hola' }],
    },
  ]
}

async function leerDeBaseDeDatos(limit: number): Promise<ConversacionEntrada[]> {
  const { prisma } = await import('../app/lib/prisma')
  const filas = await prisma.conversation.findMany({
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  return filas.map((c) => ({
    id: c.id,
    title: c.title,
    messages: c.messages.map((m) => ({ role: m.role, content: m.content })),
  }))
}

async function main(): Promise<void> {
  const esFake = arg('fake') === true
  const esDry = arg('dry') === true
  const limit = valor('limit', 1000)
  const rutaSalida = resolve(
    typeof arg('out') === 'string' ? (arg('out') as string) : 'data/lora/aria-chat.jsonl',
  )

  const informe: Informe = {
    conversaciones: 0,
    ejemplos: 0,
    descartadas: 0,
    mensajes: 0,
    maxCaracteresMensaje: 0,
    redacciones: 0,
    porCategoria: {},
  }

  console.log(
    esFake
      ? 'Modo AUTOPRUEBA: datos inventados, no se toca la base de datos.'
      : `Leyendo conversaciones de la base de datos (máximo ${limit})...`,
  )

  const conversaciones = esFake ? conversacionesFalsas() : await leerDeBaseDeDatos(limit)
  informe.conversaciones = conversaciones.length

  const ejemplos: Array<{ messages: Turno[] }> = []
  for (const conv of conversaciones) {
    const ejemplo = aEjemplo(conv, informe)
    if (ejemplo) {
      ejemplos.push(ejemplo)
      informe.mensajes += ejemplo.messages.length - 1 // sin contar la línea de sistema
    } else {
      informe.descartadas++
    }
  }
  informe.ejemplos = ejemplos.length

  const jsonl = ejemplos.map((e) => JSON.stringify(e)).join('\n') + (ejemplos.length ? '\n' : '')

  console.log('\n--- Informe ---')
  console.log(`Conversaciones leídas:        ${informe.conversaciones}`)
  console.log(`Ejemplos escritos:            ${informe.ejemplos}`)
  console.log(`Conversaciones descartadas:   ${informe.descartadas}`)
  console.log(`Mensajes (sin línea de sistema): ${informe.mensajes}`)
  console.log(`Mensaje más largo:            ${informe.maxCaracteresMensaje} caracteres`)
  console.log(`Datos borrados (anonimizados): ${informe.redacciones}`)
  for (const [k, n] of Object.entries(informe.porCategoria)) console.log(`  - ${k}: ${n}`)

  if (informe.redacciones === 0 && !esFake) {
    console.log('\nAviso: no se borró nada. Revisá el archivo a mano antes de entrenar.')
  }

  if (esDry) {
    console.log('\nModo informe (--dry): no se escribió ningún archivo.')
    return
  }

  mkdirSync(dirname(rutaSalida), { recursive: true })
  writeFileSync(rutaSalida, jsonl, 'utf8')

  console.log(`\nArchivo escrito: ${rutaSalida} (${Buffer.byteLength(jsonl)} bytes)`)
  console.log('RECUERDA: este archivo tiene datos tuyos. No lo subas a ningún repositorio público.')
}

main().catch((error) => {
  console.error('Falló la generación del conjunto de datos:', error)
  process.exitCode = 1
})
