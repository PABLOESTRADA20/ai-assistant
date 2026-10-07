const MODEL = '@cf/baai/bge-m3'
export { MODEL }
export const EMBEDDING_DIM = 1024

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
  if (process.env.EMBEDDING_PROVIDER === 'local') {
    return vectorText(localEmbed(text))
  }
  let vec: number[]
  try {
    vec = await viaBinding(text)
  } catch {
    vec = await viaRest(text)
  }
  return vectorText(vec)
}