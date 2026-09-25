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

export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    description: 'Más inteligente • Uso general',
    badge: 'Recomendado',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Razonamiento • Código complejo',
    badge: '🧠 Código',
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'Ultra rápido • Respuestas simples',
    badge: '⚡ Rápido',
  },
]