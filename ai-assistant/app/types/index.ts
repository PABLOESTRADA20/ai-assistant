// app/types/index.ts
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  model?: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  createdAt: Date
  updatedAt: Date
}

export const AVAILABLE_MODELS = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    description: 'Más inteligente • Uso general',
    badge: 'Recomendado',
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1',
    description: 'Razonamiento profundo • Código complejo',
    badge: '🧠 Código',
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    description: 'Contexto largo • Análisis',
    badge: '32K ctx',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B',
    description: 'Ultra rápido • Respuestas simples',
    badge: '⚡ Rápido',
  },
]