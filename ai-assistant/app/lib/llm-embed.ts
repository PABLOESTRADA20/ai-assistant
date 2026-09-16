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

export async function embed(text: string): Promise<string> {
  let vec: number[]
  try {
    vec = await viaBinding(text)
  } catch {
    vec = await viaRest(text)
  }
  return vectorText(vec)
}