/**
 * Modo reserva: estado de la cuota de Groq y presupuesto de Workers AI.
 *
 * El free tier de Groq tiene dos límites que de verdad se topan en producción
 * (medido en la app real):
 *
 *   - 8.000 TPM (por minuto): se recupera en segundos, ya lo maneja el retry
 *     de `groqFetch`.
 *   - 200.000 TPD (por día): se agota en unas horas de uso y no vuelve hasta
 *     medianoche UTC. Ese es el que rompía ARIA: cada intento gastaba un
 *     request contra Groq para recibir el mismo 429, y si se acababan los
 *     modelos del chain, el usuario se quedaba sin respuesta.
 *
 * Este módulo guarda ese estado en `SessionContext` (fila por clave, con TTL)
 * para que el servidor sepa SIN hacer la llamada que un modelo está fuera de
 * servicio y hasta cuándo. Con eso, la ruta de chat puede responder de una vez
 * con otro modelo de Groq que sí tenga cuota, o —si no queda ninguno— caer en
 * Workers AI (DeepSeek) en el MISMO request: eso es el modo reserva.
 *
 * Workers AI reparte 10.000 neuronas/día en el plan Free. Para garantizar $0
 * pase lo que pase (incluso en una cuenta Paid, donde la asignación gratis se
 * agota y después cobra $0.011/1000), hay un contador propio con tope de
 * 8.000 neuronas por día (00:00 UTC, igual que Cloudflare). Al tope, ARIA
 * responde con un aviso en vez de seguir gastando.
 *
 * Todo el acceso a la base es best-effort: si `SessionContext` no responde, la
 * cuota se trata como sana (es decir, el comportamiento de siempre) en vez de
 * romper el chat.
 */
import { getContext, setContext } from '@/app/lib/memory'

/** Clave de la fila con el mapa de cuota: modelo -> ISO de recuperación. */
export const GROQ_QUOTA_KEY = 'quota:groq'

/** Clave de la fila con el gasto estimado de la reserva (Workers AI). */
export const FALLBACK_BUDGET_KEY = 'quota:fallback'

/**
 * Tope diario de neuronas para el modo reserva.
 *
 * Va por debajo de las 10.000/día que Cloudflare regala para que el contador
 * propio siempre corte ANTES que el límite real: ni factura ni error del
 * proveedor, el usuario ve un aviso y ya.
 */
export const FALLBACK_NEURON_BUDGET = 8000

/** Mapa modelo -> ISO de recuperación (solo entradas vigentes). */
export type QuotaMap = Record<string, string>

/* ------------------------------------------------------------------ *
 * Helpers puros (sin I/O): se unit-testean directo.                   *
 * ------------------------------------------------------------------ */

/** Medianoche UTC del día siguiente, que es cuando se restablece la cuota. */
export function nextMidnightUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  )
}

/**
 * "Please try again in 45s" / "try again in 12m" → instante ISO o null.
 *
 * Groq lo incluye en el cuerpo del 429 cuando sabe cuánto falta. Cuando no lo
 * trae (típico al agotar el límite diario), se usa medianoche UTC.
 */
export function untilFromError(errText: string, now: Date = new Date()): string {
  const hint = /try again in\s+([\d.]+)\s*(ms|[smh])?/i.exec(errText)
  if (hint) {
    const n = Number(hint[1])
    if (Number.isFinite(n) && n >= 0) {
      const unit = (hint[2] ?? 's').toLowerCase()
      const ms =
        unit === 'ms' ? n : unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * 1000
      return new Date(now.getTime() + ms).toISOString()
    }
  }
  return nextMidnightUtc(now).toISOString()
}

/**
 * Cabecera `x-ratelimit-reset-*` de Groq → instante ISO o null.
 *
 * Formatos reales de Groq: `2m59.56s`, `23h59m59s`, `7.66s` o un número
 * plano (segundos). Si no se puede interpretar, null (y el llamador decide).
 */
export function parseResetWindow(value: string | null | undefined, now: Date = new Date()): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return new Date(now.getTime() + Number(raw) * 1000).toISOString()
  }

  let ms = 0
  let matched = false
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi)) {
    const n = Number(m[1])
    if (!Number.isFinite(n)) continue
    const unit = m[2].toLowerCase()
    matched = true
    ms += unit === 'ms' ? n : unit === 'h' ? n * 3_600_000 : unit === 'm' ? n * 60_000 : n * 1000
  }
  return matched ? new Date(now.getTime() + ms).toISOString() : null
}

/**
 * Descarta las entradas vencidas (o con fecha inválida) del mapa de cuota.
 * Se llama en cada lectura: así la fila se autolimpia sin cron jobs.
 */
export function pruneQuotaMap(map: QuotaMap, now: Date = new Date()): QuotaMap {
  const out: QuotaMap = {}
  for (const [model, until] of Object.entries(map ?? {})) {
    const ms = typeof until === 'string' ? Date.parse(until) : NaN
    if (Number.isFinite(ms) && ms > now.getTime()) out[model] = new Date(ms).toISOString()
  }
  return out
}

/**
 * Neuronas estimadas de una respuesta de Workers AI (cuenta de seguridad, no
 * factura). El tope de 8.000 está pensado con esta estimación al alza
 * (~100 neuronas por 1.000 tokens) para que quede MUY por debajo de las
 * 10.000 reales que cobra Cloudflare: en una cuenta Paid no puede aparecer
 * ni un centavo.
 */
export function estimateNeurons(charsIn: number, charsOut: number): number {
  const tokensIn = Math.max(0, Math.ceil(charsIn / 4))
  const tokensOut = Math.max(0, Math.ceil(charsOut / 4))
  return Math.ceil((tokensIn * 100) / 1000) + Math.ceil((tokensOut * 100) / 1000)
}

/** Día UTC en curso, para que el presupuesto se reinicie a las 00:00 UTC. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ *
 * Persistencia (best-effort: nunca tira abajo un request)             *
 * ------------------------------------------------------------------ */

async function readQuota(key: string): Promise<unknown> {
  try {
    const value = await getContext<unknown>(key)
    return value ?? null
  } catch (err) {
    console.warn('[quota] no se pudo leer el estado:', err)
    return null
  }
}

async function writeQuota(key: string, value: unknown, ttlMinutes: number): Promise<void> {
  try {
    await setContext(key, value, Math.min(Math.max(Math.ceil(ttlMinutes), 1), 60 * 48))
  } catch (err) {
    console.warn('[quota] no se pudo guardar el estado:', err)
  }
}

/** Mapa de cuota vigente (ya podado). Vacío si no hay datos o falla la BD. */
export async function getQuotaMap(): Promise<QuotaMap> {
  const raw = await readQuota(GROQ_QUOTA_KEY)
  if (!raw || typeof raw !== 'object') return {}
  return pruneQuotaMap(raw as QuotaMap)
}

/**
 * ¿Este modelo está fuera de servicio y hasta cuándo?
 *
 * Devuelve el `until` ISO o `null` si está sano (o si no hay datos: ante la
 * duda se prueba con el proveedor, que es el comportamiento actual).
 */
export async function modelQuotaUntil(model: string): Promise<string | null> {
  if (!model) return null
  const map = await getQuotaMap()
  return map[model] ?? null
}

/**
 * Marca un modelo de Groq como "sin cuota hasta X".
 *
 * `until` por defecto = medianoche UTC. Nunca empeora una marca existente:
 * si ya se sabe que vuelve más tarde, se conserva la más lejana.
 */
export async function markGroqQuota(model: string, until?: string): Promise<void> {
  if (!model) return
  const now = Date.now()
  const target = typeof until === 'string' ? Date.parse(until) : NaN
  const untilIso = Number.isFinite(target) && target > now
    ? new Date(target).toISOString()
    : nextMidnightUtc(new Date(now)).toISOString()

  const map = await getQuotaMap()
  const prev = map[model]
  if (prev && Date.parse(prev) > Date.parse(untilIso)) return

  map[model] = untilIso

  // TTL = hasta la última recuperación del mapa + margen, para que la fila se
  // venza sola y no quede marca fantasma después de restablecerse la cuota.
  const furthest = Math.max(...Object.values(map).map((u) => Date.parse(u)))
  const ttlMinutes = (furthest - now) / 60_000 + 10
  await writeQuota(GROQ_QUOTA_KEY, map, ttlMinutes)
}

/** ¿Queda algún modelo de Groq con cuota? (para tareas de fondo) */
export async function firstAvailableGroqModel(candidates: string[]): Promise<string | null> {
  const map = await getQuotaMap()
  const now = Date.now()
  for (const id of candidates) {
    const until = map[id]
    if (!until || Date.parse(until) <= now) return id
  }
  return null
}

/** La marca de cuota más lejana vigente, para los mensajes de 429. */
export async function latestGroqQuotaUntil(): Promise<string | null> {
  const map = await getQuotaMap()
  const all = Object.values(map)
  if (all.length === 0) return null
  return all.sort((a, b) => Date.parse(a) - Date.parse(b))[all.length - 1]
}

/* ------------------------------------------------------------------ *
 * Presupuesto de la reserva (Workers AI)                              *
 * ------------------------------------------------------------------ */

export interface FallbackBudget {
  day: string
  neurons: number
}

export async function getFallbackBudget(): Promise<FallbackBudget> {
  const today = utcDayKey()
  const raw = await readQuota(FALLBACK_BUDGET_KEY)
  const row = raw as Partial<FallbackBudget> | null
  if (!row || row.day !== today || typeof row.neurons !== 'number') {
    return { day: today, neurons: 0 }
  }
  return { day: today, neurons: row.neurons }
}

/** ¿Sigue disponible la reserva de Workers AI para hoy? */
export async function fallbackBudgetLeft(): Promise<boolean> {
  const budget = await getFallbackBudget()
  return budget.neurons < FALLBACK_NEURON_BUDGET
}

/**
 * Carga a la reserva lo que costó una respuesta (se calcula al terminar,
 * con los caracteres realmente emitidos). Se persiste hasta medianoche UTC.
 */
export async function chargeFallback(charsIn: number, charsOut: number): Promise<void> {
  try {
    const budget = await getFallbackBudget()
    const neurons = budget.neurons + estimateNeurons(charsIn, charsOut)
    const ttlMinutes = (nextMidnightUtc().getTime() - Date.now()) / 60_000 + 30
    await writeQuota(FALLBACK_BUDGET_KEY, { day: budget.day, neurons }, ttlMinutes)
    if (neurons >= FALLBACK_NEURON_BUDGET) {
      console.warn(`[quota] reserva de Workers AI agotada para hoy (${neurons} neuronas estimadas)`)
    }
  } catch (err) {
    console.warn('[quota] no se pudo cargar la reserva:', err)
  }
}

/* ------------------------------------------------------------------ *
 * Embeddings: mismo presupuesto, solo entrada                         *
 * ------------------------------------------------------------------ */

/**
 * Neuronas estimadas de un embedding: se cobra solo la entrada (los vectores
 * no generan tokens de salida). Estimación al alza como en `estimateNeurons`.
 */
export function estimateEmbeddingNeurons(text: string): number {
  return estimateNeurons(text.length, 0)
}

/**
 * Carga a la reserva compartida el costo de un embedding.
 *
 * El presupuesto es UNO solo (no se separa chat de embeddings) porque Workers
 * AI regala 10.000 neuronas/día por cuenta: respuestas y vectores compiten por
 * el MISMO tope real, así que compartir el contador es lo que garantiza $0.
 * Best-effort como el resto del módulo.
 */
export async function chargeEmbedding(text: string): Promise<void> {
  await chargeFallback(text.length, 0)
}
