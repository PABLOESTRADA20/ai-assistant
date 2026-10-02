/**
 * Registro de proveedores de modelos.
 *
 * ARIA nació atada a Groq (fetch + SSE estilo OpenAI). Para sumar DeepSeek
 * gratis sin abrir otra cuenta se usa el binding `AI` de Cloudflare Workers AI,
 * que ya estaba configurado para los embeddings. Este módulo traduce un `model`
 * a su proveedor para que la ruta de chat sepa cómo hablarle: por fetch (Groq)
 * o por binding (Workers AI).
 */
export type ProviderId = 'groq' | 'workers-ai'

export interface Provider {
  id: ProviderId
  label: string
  /** Endpoint OpenAI-compatible (solo proveedores por fetch). */
  apiUrl?: string
  /** Variable de entorno con la API key (solo proveedores por fetch). */
  apiKeyEnv?: string
  /** Cabeceras extra que algunos gateways exigen. */
  headers?: Record<string, string>
  /** Si admite `tools`/`tool_choice`. Los modelos de razonamiento no. */
  supportsTools: boolean
}

export const GROQ: Provider = {
  id: 'groq',
  label: 'Groq',
  apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
  apiKeyEnv: 'GROQ_API_KEY',
  supportsTools: true,
}

/**
 * DeepSeek R1 distilado, servido por Cloudflare. Es gratis dentro de las
 * 10.000 neuronas/día del plan Free. Es un modelo de razonamiento: no soporta
 * function calling, así que va por el camino "simple" (sin herramientas).
 */
export const WORKERS_AI: Provider = {
  id: 'workers-ai',
  label: 'Cloudflare Workers AI',
  supportsTools: false,
}

export function isWorkersAiModel(model: string): boolean {
  return model.startsWith('@cf/')
}

export function providerForModel(model: string): Provider {
  return isWorkersAiModel(model) ? WORKERS_AI : GROQ
}
