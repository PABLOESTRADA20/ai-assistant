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
    description: 'Ultra rápido • Con herramientas',
    badge: '⚡ Rápido',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 32B',
    description: 'Razonamiento profundo • gratis (sin herramientas)',
    badge: '🐋 Gratis',
  },
]