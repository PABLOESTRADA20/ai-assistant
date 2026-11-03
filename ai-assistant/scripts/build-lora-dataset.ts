import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

/**
 * Generador del conjunto de datos de entrenamiento (FASE 6).
 *
 *   npm run db:dataset                         # turnos reales + set sintético
 *   npm run db:dataset -- --no-seed            # solo conversaciones reales
 *   npm run db:dataset -- --seed-only          # solo el set sintético
 *   npm run db:dataset -- --fake               # autoprueba sin BD
 *   npm run db:dataset -- --dry                # solo informe
 *   npm run db:dataset -- --by-conversation    # una charla = un ejemplo (antiguo)
 *   npm run db:dataset -- --with-tools         # incluye trazas de herramientas
 *   npm run db:dataset -- --limit=50 --out=otra/ruta.jsonl
 *
 * Qué hace: lee las conversaciones y sus mensajes de la base, los pasa por el
 * anonimizador (`app/lib/scrub.ts`) y escribe JSONL en formato "chat":
 *
 *   {"messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
 *
 * Por defecto genera un ejemplo por respuesta del asistente (con contexto),
 * que multiplica los datos útiles frente a "una conversación = un ejemplo".
 *
 * REGLAS (ROADMAP, FASE 6):
 *   - NUNCA se sube a un repositorio público de Hugging Face.
 *   - El archivo vive en `data/lora/`, que está en `.gitignore`.
 *   - Antes de entrenar, revisar el informe: secretos y datos personales = 0.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  aJsonl,
  construirEjemplos,
  crearInforme,
  DEFAULT_SYSTEM,
  opcionesPorDefecto,
  type ConversacionEntrada,
  type OpcionesDataset,
} from './lora-dataset-lib'
import { SYNTHETIC_EXAMPLES } from './lora-seed'

/** Acepta `--clave`, `--clave=valor` y `--clave valor`. */
function arg(nombre: string): string | true | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i === -1) return undefined
  const siguiente = process.argv[i + 1]
  if (!siguiente || siguiente.startsWith('--')) return true
  return siguiente
}

function tiene(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`)
}

function valor(nombre: string, porDefecto: number): number {
  const v = arg(nombre)
  return typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : porDefecto
}

function texto(nombre: string, porDefecto: string): string {
  const v = arg(nombre)
  return typeof v === 'string' && v.length > 0 ? v : porDefecto
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
    messages: c.messages.map((m) => ({
      role: m.role,
      content: m.content,
      tools: m.tools ?? undefined,
    })),
  }))
}

function opcionesDesdeArgs(): OpcionesDataset {
  const modo = texto('mode', tiene('by-conversation') ? 'conversation' : 'turn')
  return opcionesPorDefecto({
    system: process.env.ARIA_DATASET_SYSTEM ?? DEFAULT_SYSTEM,
    mode: modo === 'conversation' ? 'conversation' : 'turn',
    withTools: tiene('with-tools'),
    minAssistantChars: valor('min-assistant-chars', 1),
    maxContextMessages: valor('max-context-messages', 12),
    dedupe: !tiene('no-dedupe'),
  })
}

async function main(): Promise<void> {
  const esFake = tiene('fake')
  const esDry = tiene('dry')
  const sinSeed = tiene('no-seed')
  const soloSeed = tiene('seed-only')
  const limit = valor('limit', 1000)
  const rutaSalida = resolve(
    typeof arg('out') === 'string'
      ? (arg('out') as string)
      : 'data/lora/aria-chat.jsonl',
  )
  const opciones = opcionesDesdeArgs()

  if (esFake && soloSeed) {
    throw new Error('--fake y --seed-only no se pueden combinar.')
  }

  const informe = crearInforme()

  console.log(
    esFake
      ? 'Modo AUTOPRUEBA: datos inventados, no se toca la base de datos.'
      : soloSeed
        ? 'Modo SEED-ONLY: solo ejemplos sintéticos curados.'
        : `Leyendo conversaciones de la base de datos (máximo ${limit})...`,
  )

  let conversaciones: ConversacionEntrada[]
  if (soloSeed) {
    conversaciones = [...SYNTHETIC_EXAMPLES]
  } else if (esFake) {
    conversaciones = conversacionesFalsas()
  } else {
    conversaciones = await leerDeBaseDeDatos(limit)
  }

  if (!sinSeed && !soloSeed) {
    conversaciones = [...conversaciones, ...SYNTHETIC_EXAMPLES]
  }

  const ejemplos = construirEjemplos(conversaciones, opciones, informe)
  const jsonl = aJsonl(ejemplos)

  console.log('\n--- Informe ---')
  console.log(
    `Modo:                          ${opciones.mode === 'turn' ? 'un ejemplo por turno' : 'una conversación por ejemplo'}`,
  )
  console.log(`Conversaciones reales:         ${informe.conversacionesReales}`)
  console.log(`Conversaciones sintéticas:     ${informe.conversacionesSinteticas}`)
  console.log(`Ejemplos reales:               ${informe.ejemplosReales}`)
  console.log(`Ejemplos sintéticos:           ${informe.ejemplosSinteticos}`)
  console.log(`Ejemplos escritos:             ${informe.ejemplos}`)
  console.log(`Conversaciones descartadas:    ${informe.descartadas}`)
  console.log(`Duplicados omitidos:           ${informe.duplicados}`)
  console.log(`Mensajes (sin línea de sistema): ${informe.mensajes}`)
  console.log(`Mensajes con herramientas:     ${informe.mensajesConHerramientas}`)
  console.log(`Mensaje más largo:             ${informe.maxCaracteresMensaje} caracteres`)
  console.log(`Datos borrados (anonimizados): ${informe.redacciones}`)
  for (const [k, n] of Object.entries(informe.porCategoria)) console.log(`  - ${k}: ${n}`)

  if (informe.redacciones === 0 && informe.ejemplosReales > 0) {
    console.log('\nAviso: no se borró nada en los datos reales. Revisá el archivo a mano antes de entrenar.')
  }

  if (informe.ejemplos === 0) {
    console.log('\nNo se generó ningún ejemplo. Revisá los filtros y la base de datos.')
  }

  if (esDry) {
    console.log('\nModo informe (--dry): no se escribió ningún archivo.')
    return
  }

  mkdirSync(dirname(rutaSalida), { recursive: true })
  writeFileSync(rutaSalida, jsonl, 'utf8')

  console.log(`\nArchivo escrito: ${rutaSalida} (${Buffer.byteLength(jsonl)} bytes)`)
  console.log('RECUERDA: este archivo puede tener datos tuyos. No lo subas a ningún repositorio público.')
}

main().catch((error) => {
  console.error('Falló la generación del conjunto de datos:', error)
  process.exitCode = 1
})
