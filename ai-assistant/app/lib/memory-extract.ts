const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

export interface ExtractedMemory {
  type: string
  category: string
  content: string
  importance: number
  confidence?: number
  tags?: string[]
}

const SYSTEM_PROMPT = `Eres el sistema de memoria de ARIA. Extraes del mensaje del usuario únicamente información PERMANENTE y valiosa de recordar a largo plazo: preferencias, hábitos, datos personales, hechos sobre su entorno y eventos importantes.

Reglas:
- Devuelve SIEMPRE un JSON válido: un array de objetos.
- Cada objeto: {"type": "long_term"|"episodic"|"factual"|"procedural", "category": "preference"|"knowledge"|"event"|"skill"|"fact", "content": string, "importance": 0-1, "tags": [string]}
- content en el mismo idioma del usuario, en 3ª persona referida al usuario ("al usuario le gusta...").
- importance: 0.9 para preferencias explícitas ("me gusta", "prefiero", "no me gusta"), 0.7 hechos/hábitos, 0.5 eventos menores.
- No extraigas comandos, preguntas o información trivial/efímera (que plan quiere, qué hora es). Máximo 5 hechos.
- Si nada merece recordarse, devuelve [].`

function sanitizeJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

function sanitizeExtracted(raw: unknown[]): ExtractedMemory[] {
  const out: ExtractedMemory[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const content = typeof o.content === 'string' ? o.content.trim() : ''
    if (!content) continue
    const type = typeof o.type === 'string' ? o.type : 'long_term'
    const category = typeof o.category === 'string' ? o.category : 'fact'
    const importance = typeof o.importance === 'number' ? Math.max(0, Math.min(1, o.importance)) : 0.5
    const confidence = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.6
    const tags = Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 8)
      : []
    out.push({ type, category, content, importance, confidence, tags })
  }
  return out.slice(0, 5)
}

export async function extractMemories(apiKey: string, userContent: string): Promise<ExtractedMemory[]> {
  if (!apiKey || !userContent?.trim()) return []

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent.slice(0, 4000) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.2,
    }),
  })

  if (!res.ok) return []
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(sanitizeJson(text))
  } catch {
    return []
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { facts?: unknown[] })?.facts
  return sanitizeExtracted(Array.isArray(arr) ? arr : [])
}

export function heuristicExtract(userContent: string): ExtractedMemory[] {
  const text = userContent.trim()
  if (!text) return []

  const out: ExtractedMemory[] = []
  const rules: { re: RegExp; category: string; importance: number }[] = [
    { re: /(me gusta|me encanta|prefiero|mi favorit(o|a))/i, category: 'preference', importance: 0.9 },
    { re: /(no me gusta|detesto|odio|tengo alergia a)/i, category: 'preference', importance: 0.85 },
    { re: /(uso |utilizo |trabajo con |trabajo en |mi (editor|stack|ide|sistema|proyecto|teléfono|empresa|puesto))/i, category: 'fact', importance: 0.75 },
    { re: /(estoy aprendiendo|quiero aprender|me estoy formando en)/i, category: 'skill', importance: 0.8 },
    { re: /(recuerda que|no olvides que|para la próxima)/i, category: 'fact', importance: 0.85 },
  ]

  for (const rule of rules) {
    if (rule.re.test(text)) {
      out.push({
        type: 'long_term',
        category: rule.category,
        content: text.slice(0, 220),
        importance: rule.importance,
        confidence: 0.5,
        tags: [rule.category],
      })
    }
  }
  return out
}