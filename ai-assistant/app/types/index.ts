// app/types/index.ts
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  model?: string
  tools?: ToolInvocation[]
}

export interface ToolInvocation {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
}

export interface Conversation {
  id: string
  title: string
  summary?: string | null
  messages: Message[]
  model: string
  createdAt: Date
  updatedAt: Date
}

export interface AIModel {
  id: string
  name: string
  description: string
  badge: string
}

export interface MemoryRecord {
  id: string
  type: string
  category: string
  content: string
  importance: number
  confidence: number
  tags: string[]
  source: string
  isCompressed: boolean
  createdAt: string
  similarity?: number
}

export interface MemoryStats {
  total: number
  compressed: number
  byType: Record<string, number>
  byCategory: Record<string, number>
  avgImportance: number
  updatedAt: string
}

export const AVAILABLE_MODELS: AIModel[] = [
  // Groq (free tier amplio, con herramientas)
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    description: 'Más inteligente • uso general • con herramientas',
    badge: 'Recomendado',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Razonamiento • código complejo',
    badge: '🧠 Código',
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'Ultra rápido • con herramientas',
    badge: '⚡ Rápido',
  },
  // Cloudflare Workers AI (gratis, sin clave)
  {
    id: '@cf/openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (Cloudflare)',
    description: 'Gratis en Workers AI • razonamiento',
    badge: '🆓 Gratis',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B (Cloudflare)',
    description: 'Gratis en Workers AI • uso general',
    badge: '🆓 Gratis',
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B (Cloudflare)',
    description: 'Gratis en Workers AI • liviano',
    badge: '🆓 Gratis',
  },
  {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    name: 'Mistral Small 24B (Cloudflare)',
    description: 'Gratis en Workers AI • equilibrado',
    badge: '🆓 Gratis',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 32B (Cloudflare)',
    description: 'Razonamiento profundo • gratis (sin herramientas)',
    badge: '🐋 Gratis',
  },
  // Google Gemini (free tier con clave)
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Google • 1M de contexto • gratis con clave',
    badge: '✨ Gemini',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    description: 'Google • rápido • gratis con clave',
    badge: '✨ Gemini',
  },
  // Mistral (free tier con clave)
  {
    id: 'mistral-small-4',
    name: 'Mistral Small 4',
    description: 'Mistral • 256K de contexto • gratis con clave',
    badge: '🌬️ Mistral',
  },
  // OpenRouter (modelos :free con clave)
  {
    id: 'openai/gpt-oss-20b:free',
    name: 'GPT-OSS 20B (OpenRouter)',
    description: 'OpenRouter • gratis con clave',
    badge: '🔀 OpenRouter',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B',
    description: 'OpenRouter • 262K • gratis con clave',
    badge: '🔀 OpenRouter',
  },
  // Z AI / GLM (free tier con clave)
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    description: 'Z AI • 200K • gratis con clave',
    badge: '🧩 GLM',
  },
  // Gateways sin clave (límites bajos, respaldo)
  {
    id: 'Meta-Llama-3_3-70B-Instruct',
    name: 'Llama 3.3 70B (OVH)',
    description: 'Sin clave • 2 req/min • respaldo',
    badge: '🔓 Sin clave',
  },
  {
    id: 'Qwen3.6-27B',
    name: 'Qwen 3.6 27B (OVH)',
    description: 'Sin clave • 2 req/min • respaldo',
    badge: '🔓 Sin clave',
  },
  {
    id: 'gpt-oss:20b',
    name: 'GPT-OSS 20B (LLM7)',
    description: 'Sin clave • límite bajo • respaldo',
    badge: '🔓 Sin clave',
  },
]