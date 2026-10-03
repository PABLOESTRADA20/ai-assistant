/**
 * Registro de proveedores y catalogo de modelos.
 *
 * ARIA nacio atada a Groq (fetch + SSE estilo OpenAI). Con el tiempo se fueron
 * sumando Workers AI (binding `AI`, sin clave) y ahora varios proveedores con
 * free tier que hablan el mismo dialecto OpenAI: Google Gemini, Mistral,
 * OpenRouter y Z AI.
 *
 * Toda la infraestructura ya asume "fetch a un endpoint OpenAI-compatible con
 * Bearer", asi que sumar un proveedor es solo agregar una entrada aca. Los
 * modelos sin clave (Workers AI) funcionan de inmediato; los demas aparecen en la
 * app recien cuando su variable de entorno esta configurada.
 */
export type ProviderId =
  | 'groq'
  | 'workers-ai'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'zai'

export interface Provider {
  id: ProviderId
  label: string
  /** Endpoint OpenAI-compatible (solo proveedores por fetch). */
  apiUrl?: string
  /** Variable de entorno con la API key (solo proveedores por fetch con clave). */
  apiKeyEnv?: string
  /** Cabeceras extra que algunos gateways exigen. */
  headers?: Record<string, string>
  /** Si admite `tools`/`tool_choice`. Los modelos de razonamiento no. */
  supportsTools: boolean
  /** Se puede usar sin configurar ninguna clave (limites bajos). */
  keyless?: boolean
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
 * 10.000 neuronas/dia del plan Free. Es un modelo de razonamiento: no soporta
 * function calling, asi que va por el camino "simple" (sin herramientas).
 */
export const WORKERS_AI: Provider = {
  id: 'workers-ai',
  label: 'Cloudflare Workers AI',
  supportsTools: false,
  keyless: true,
}

export const GEMINI: Provider = {
  id: 'gemini',
  label: 'Google Gemini',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  apiKeyEnv: 'GEMINI_API_KEY',
  supportsTools: false,
}

export const MISTRAL: Provider = {
  id: 'mistral',
  label: 'Mistral AI',
  apiUrl: 'https://api.mistral.ai/v1/chat/completions',
  apiKeyEnv: 'MISTRAL_API_KEY',
  supportsTools: false,
}

export const OPENROUTER: Provider = {
  id: 'openrouter',
  label: 'OpenRouter',
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  supportsTools: false,
  headers: {
    'HTTP-Referer': 'https://ai-assistant.pablo-maximiliano-cocio-estrada.workers.dev',
    'X-Title': 'ARIA',
  },
}

export const ZAI: Provider = {
  id: 'zai',
  label: 'Z AI (GLM)',
  apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
  apiKeyEnv: 'ZAI_API_KEY',
  supportsTools: false,
}

export interface ModelCatalogEntry {
  id: string
  name: string
  description: string
  badge: string
  provider: Provider
}

/**
 * Catalogo visible en la app. El `id` es exactamente el nombre que espera el
 * endpoint del proveedor (no hay traduccion), por eso conviven ids como
 * `openai/gpt-oss-120b` (Groq) y `@cf/openai/gpt-oss-120b` (Workers AI) sin chocar.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // --- Groq (free tier amplio, con herramientas) ---
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    description: 'Mas inteligente • uso general • con herramientas',
    badge: 'Recomendado',
    provider: GROQ,
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Razonamiento • codigo complejo',
    badge: 'Código',
    provider: GROQ,
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'Ultra rapido • con herramientas',
    badge: 'Rápido',
    provider: GROQ,
  },

  // --- Cloudflare Workers AI (gratis, sin clave) ---
  {
    id: '@cf/openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (Cloudflare)',
    description: 'Gratis en Workers AI • razonamiento',
    badge: 'Gratis',
    provider: WORKERS_AI,
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B (Cloudflare)',
    description: 'Gratis en Workers AI • uso general',
    badge: 'Gratis',
    provider: WORKERS_AI,
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B (Cloudflare)',
    description: 'Gratis en Workers AI • liviano',
    badge: 'Gratis',
    provider: WORKERS_AI,
  },
  {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    name: 'Mistral Small 24B (Cloudflare)',
    description: 'Gratis en Workers AI • equilibrado',
    badge: 'Gratis',
    provider: WORKERS_AI,
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 32B (Cloudflare)',
    description: 'Razonamiento profundo • gratis (sin herramientas)',
    badge: 'Gratis',
    provider: WORKERS_AI,
  },

  // --- Google Gemini (free tier; requiere GEMINI_API_KEY) ---
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Google • 1M de contexto • gratis con clave',
    badge: 'Gemini',
    provider: GEMINI,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    description: 'Google • rapido • gratis con clave',
    badge: 'Gemini',
    provider: GEMINI,
  },

  // --- Mistral (free tier; requiere MISTRAL_API_KEY) ---
  {
    id: 'mistral-small-4',
    name: 'Mistral Small 4',
    description: 'Mistral • 256K de contexto • gratis con clave',
    badge: 'Mistral',
    provider: MISTRAL,
  },

  // --- OpenRouter (modelos :free; requiere OPENROUTER_API_KEY) ---
  {
    id: 'openai/gpt-oss-20b:free',
    name: 'GPT-OSS 20B (OpenRouter)',
    description: 'OpenRouter • gratis con clave',
    badge: 'OpenRouter',
    provider: OPENROUTER,
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    description: 'OpenRouter • 262K • gratis con clave',
    badge: 'OpenRouter',
    provider: OPENROUTER,
  },

  // --- Z AI / GLM (free tier; requiere ZAI_API_KEY) ---
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    description: 'Z AI • 200K • gratis con clave',
    badge: 'GLM',
    provider: ZAI,
  },

]

const CATALOG_BY_ID = new Map(MODEL_CATALOG.map((m) => [m.id, m]))

export function catalogEntry(model: string): ModelCatalogEntry | undefined {
  return CATALOG_BY_ID.get(model)
}

export function isWorkersAiModel(model: string): boolean {
  return model.startsWith('@cf/')
}

export function providerForModel(model: string): Provider {
  const entry = CATALOG_BY_ID.get(model)
  if (entry) return entry.provider
  return isWorkersAiModel(model) ? WORKERS_AI : GROQ
}

/** Un modelo esta disponible si no necesita clave o si su clave esta puesta. */
export function isModelAvailable(model: string): boolean {
  const entry = CATALOG_BY_ID.get(model)
  if (!entry) return true
  const provider = entry.provider
  if (provider.keyless || !provider.apiKeyEnv) return true
  return Boolean(process.env[provider.apiKeyEnv])
}

/** Catalogo con el flag `available` ya calculado, para el endpoint publico. */
export function catalogWithAvailability() {
  return MODEL_CATALOG.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    badge: m.badge,
    provider: m.provider.label,
    available: isModelAvailable(m.id),
  }))
}
