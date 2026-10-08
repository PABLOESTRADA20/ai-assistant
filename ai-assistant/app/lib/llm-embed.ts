import { prisma } from './prisma'
import { chargeEmbedding, fallbackBudgetLeft } from './quota'

const MODEL = '@cf/baai/bge-m3'
export { MODEL }
export const EMBEDDING_DIM = 1024

/** Entradas de caché más viejas que esto se ignoran (y se barren al escribir). */
export const EMBEDDING_CACHE_TTL_MS = 30 * 86_400_000

/**
 * Hash FNV-1a de 32 bits (8 dígitos hex) del texto EXACTO que se embebe
 * (incluye el prefijo `query:` / `passage:`). Es la clave de `EmbeddingCache`:
 * textos repetidos vuelven a su vector sin gastar neuronas de Workers AI.
 * Puro y determinista; las colisiones son rarísimas y, de darse, inofensivas
 * (dos textos devolverían el mismo vector ya cacheado).
 */
export function hashEmbedText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Vector cacheado del texto, o null si no hay entrada vigente (best-effort). */
export async function embeddingCacheGet(text: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ embedding: string }[]>`
      SELECT "embedding"
      FROM "EmbeddingCache"
      WHERE "hash" = ${hashEmbedText(text)}
        AND "createdAt" > NOW() - INTERVAL '30 days'
      LIMIT 1
    `
    if (rows.length === 0) return null
    try {
      await prisma.$executeRaw`
        UPDATE "EmbeddingCache" SET "usedAt" = NOW() WHERE "hash" = ${hashEmbedText(text)}
      `
    } catch {
      /* refrescar la última lectura es opcional */
    }
    return rows[0].embedding
  } catch {
    // Ante cualquier fallo de BD se sigue con la API: la caché nunca rompe.
    return null
  }
}

/**
 * Guarda (o sobrescribe) el vector del texto y barre las entradas vencidas.
 * Best-effort: si la BD falla, la llamada a la API ya se hizo y no se repite.
 */
export async function embeddingCacheSet(text: string, vector: string): Promise<void> {
  try {
    const h = hashEmbedText(text)
    await prisma.$executeRaw`
      INSERT INTO "EmbeddingCache" ("hash", "embedding", "createdAt", "usedAt")
      VALUES (${h}, ${vector}::vector, NOW(), NOW())
      ON CONFLICT ("hash") DO UPDATE SET "embedding" = EXCLUDED."embedding", "usedAt" = NOW()
    `
    // Barrido defensivo: acota la tabla sin cron jobs (mismo TTL de la lectura).
    await prisma.$executeRaw`
      DELETE FROM "EmbeddingCache" WHERE "createdAt" < NOW() - INTERVAL '30 days'
    `
  } catch {
    /* la caché nunca debe tumbar un request */
  }
}

export function vectorText(data: ArrayLike<number>): string {
  return `[${Array.from(data).join(',')}]`
}

type AiResult = { data: number[][] }

async function viaBinding(text: string): Promise<number[]> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const ctx = await getCloudflareContext({ async: true })
  const ai = ctx.env.AI as { run: (model: string, input: { text: string }) => Promise<AiResult> }
  const out = await ai.run(MODEL, { text })
  return out.data[0]
}

async function viaRest(text: string): Promise<number[]> {
  const hasProcess = typeof process !== 'undefined'
  const account = hasProcess ? process.env.CLOUDFLARE_ACCOUNT_ID ?? '' : ''
  const token = hasProcess ? process.env.CLOUDFLARE_API_TOKEN ?? '' : ''
  if (!account || !token) {
    throw new Error('Para embeddings necesitas CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN en el entorno')
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    throw new Error(`Workers AI error ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { result: AiResult }
  const vec = json.result.data[0]
  if (!vec || vec.length !== EMBEDDING_DIM) {
    throw new Error(`Workers AI devolvió ${vec?.length ?? 0} dims, se esperaba ${EMBEDDING_DIM}`)
  }
  return vec
}

/**
 * Embedding local determinista: hashing de tokens (FNV-1a) a 1024 dims,
 * normalizado. Sin red y reproducible.
 *
 * Existe SOLO para los tests (`EMBEDDING_PROVIDER=local`, que es lo que
 * fija `tests/setup.ts`): los tests de integración necesitan vectores
 * estables para poder asertar sobre similitudes, y no deben depender de
 * Workers AI ni gastar su cuota. En producción la variable no está definida
 * y se usa el modelo real (`@cf/baai/bge-m3`).
 */
function localEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0)
  const tokens = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
  for (const token of tokens) {
    let h = 2166136261
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    v[Math.abs(h) % EMBEDDING_DIM] += 1
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export async function embed(text: string): Promise<string> {
  // Modo tests: embeddings locales deterministas, sin red ni DB.
  if (process.env.EMBEDDING_PROVIDER === 'local') {
    return vectorText(localEmbed(text))
  }

  // Caché: textos repetidos no vuelven a costar neuronas de Workers AI.
  const cached = await embeddingCacheGet(text)
  if (cached) return cached

  // Reserva: si la cuota compartida ya está agotada, NO llamar a la API (cero $).
  // Quien llama degrada igual que ante un error de red: searchBrain cae a la
  // vía léxica, el reindexador cuenta el fallo, etc. Nunca se mezclan vectores
  // "locales" con los reales de bge-m3 (espacios de embedding distintos).
  if (!(await fallbackBudgetLeft())) {
    throw new Error('[embed] reserva de Workers AI agotada: se omite la API y se usa la vía léxica')
  }

  let vec: number[]
  try {
    vec = await viaBinding(text)
  } catch {
    vec = await viaRest(text)
  }

  try {
    await chargeEmbedding(text)
  } catch {
    /* la carga de la reserva es best-effort */
  }

  const vector = vectorText(vec)
  await embeddingCacheSet(text, vector)
  return vector
}