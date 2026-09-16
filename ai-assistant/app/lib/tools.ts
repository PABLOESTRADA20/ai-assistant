const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the internet for current information, news, documentation, or any online content',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_vault',
      description: 'Search notes in the Obsidian vault (Cerebro tt) by filename or content',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term to match against filenames or content' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_note',
      description: 'Read the full content of a note from the Obsidian vault',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from vault root, e.g. "06-Programacion/TypeScript.md"' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_note',
      description: 'Save a new note or overwrite an existing note in the Obsidian vault',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from vault root, e.g. "07-IA-y-Automatizacion/Nueva-Nota.md"' },
          content: { type: 'string', description: 'Full markdown content of the note' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculate',
      description: 'Evaluate a mathematical expression and return the result. Supports arithmetic, parentheses, and + - * / %. Safe and deterministic (no code execution).',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'The mathematical expression to evaluate, e.g. "(12 + 4) * 3 / 2"' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_time',
      description: 'Get the current date, time, and timezone of the machine',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city or coordinates (uses free Open-Meteo API, no key required)',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name, e.g. "Madrid" or "Buenos Aires"' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'semantic_search_vault',
      description: 'Search notes in the Obsidian vault ranked by semantic relevance using embeddings (cosine similarity), better than exact keyword search',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language phrase or concept to find in notes' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_memory',
      description: 'Recall what ARIA knows about the user (preferences, habits, facts, past events) that relates to the current question',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Topic or question to recall memories about, e.g. "editor de código" or "proyectos recientes"' },
        },
        required: ['query'],
      },
    },
  },
]

export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function
  const args = JSON.parse(argsStr)

  switch (name) {
    case 'web_search':
      return webSearch(args.query)
    case 'search_vault':
      return searchVault(args.query)
    case 'read_note':
      return readNote(args.path)
    case 'save_note':
      return saveNote(args.path, args.content)
    case 'calculate':
      return calculate(args.expression)
    case 'get_time':
      return getTime()
    case 'get_weather':
      return getWeather(args.location)
    case 'semantic_search_vault':
      return semanticSearchVault(args.query)
    case 'recall_memory':
      return recallMemory(args.query)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

async function getWeather(location: string): Promise<string> {
  if (!location || typeof location !== 'string') {
    return JSON.stringify({ error: 'Ubicación no válida' })
  }
  try {
    // Geo -> coordinates via Open-Meteo geocoding (no key required)
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=es&format=json`
    )
    if (!geoRes.ok) return JSON.stringify({ error: 'Error en geocoding' })
    const geo = await geoRes.json()
    const place = geo.results?.[0]
    if (!place) return JSON.stringify({ error: `No se encontró la ubicación: ${location}` })

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
    )
    if (!weatherRes.ok) return JSON.stringify({ error: 'Error en el pronóstico' })
    const weather = await weatherRes.json()
    const current = weather.current || {}

    const wmo: Record<number, string> = {
      0: 'Despejado',
      1: 'Mayormente despejado',
      2: 'Parcialmente nublado',
      3: 'Nublado',
      45: 'Niebla',
      48: 'Niebla con escarcha',
      51: 'Llovizna ligera',
      53: 'Llovizna',
      55: 'Llovizna intensa',
      61: 'Lluvia ligera',
      63: 'Lluvia',
      65: 'Lluvia intensa',
      71: 'Nieve ligera',
      73: 'Nieve',
      75: 'Nieve intensa',
      80: 'Chubascos ligeros',
      81: 'Chubascos',
      82: 'Chubascos violentos',
      95: 'Tormenta',
    }

    return JSON.stringify({
      location: place.name + (place.admin1 ? `, ${place.admin1}` : '') + (place.country ? `, ${place.country}` : ''),
      temperature: current.temperature_2m,
      feels_like: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      wind_kmh: current.wind_speed_10m,
      condition: wmo[current.weather_code] ?? `Código ${current.weather_code}`,
    })
  } catch (err) {
    return JSON.stringify({ error: `Error obteniendo clima: ${String(err)}` })
  }
}

async function semanticSearchVault(query: string): Promise<string> {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    return JSON.stringify({ error: 'VAULT_PATH no configurada' })
  }
  try {
    const { semanticSearchDb } = await import('@/app/lib/embeddings')
    const dbResults = await semanticSearchDb(query)
    if (dbResults && dbResults.length > 0) {
      return JSON.stringify({ engine: 'pgvector', files: dbResults })
    }
    const { semanticSearch } = await import('@/app/lib/vault-index')
    return JSON.stringify({ engine: 'tfidf', files: semanticSearch(query).files })
  } catch (err) {
    return JSON.stringify({ error: `Error en búsqueda semántica: ${String(err)}` })
  }
}

async function recallMemory(query: string): Promise<string> {
  try {
    const { searchSemanticMemories } = await import('@/app/lib/memory')
    const memories = await searchSemanticMemories(query, 5, 0.4)
    if (memories.length === 0) {
      return JSON.stringify({ memories: [], note: 'No hay memorias relevantes sobre este tema' })
    }
    return JSON.stringify({
      memories: memories.map((m) => ({
        type: m.type,
        category: m.category,
        content: m.content,
        importance: m.importance,
        similarity: m.similarity,
        recalledAt: m.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    return JSON.stringify({ error: `Error recordando: ${String(err)}` })
  }
}

function calculate(expression: string): string {
  if (typeof expression !== 'string' || !expression.trim()) {
    return JSON.stringify({ error: 'Expresión vacía' })
  }
  const sanitized = expression.replace(/\s+/g, '')
  if (!/^[0-9+\-*/%.()]+$/.test(sanitized)) {
    return JSON.stringify({ error: 'Expresión con caracteres no permitidos' })
  }
  try {
    // eslint-disable-next-line no-new-func
    const value = new Function(`"use strict"; return (${sanitized});`)()
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return JSON.stringify({ error: 'Resultado no es un número finito' })
    }
    return JSON.stringify({ expression, result: value })
  } catch (err) {
    return JSON.stringify({ error: `Error evaluando expresión: ${String(err)}` })
  }
}

function getTime(): string {
  const now = new Date()
  return JSON.stringify({
    iso: now.toISOString(),
    local: now.toString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    unix: Math.floor(now.getTime() / 1000),
  })
}

async function webSearch(query: string): Promise<string> {
  try {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return JSON.stringify({ error: 'TAVILY_API_KEY no configurada' })
    }
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
    })
    if (!res.ok) {
      return JSON.stringify({ error: `Tavily error: ${await res.text()}` })
    }
    const data = await res.json()
    const results = data.results?.map((r: { title: string; url: string; content: string }) =>
      `- **${r.title}** (${r.url}): ${r.content}`
    ).join('\n') || ''
    const answer = data.answer ? `Resumen: ${data.answer}\n\n` : ''
    return JSON.stringify({ answer: data.answer || null, results: data.results || [] })
  } catch (err) {
    return JSON.stringify({ error: String(err) })
  }
}

async function searchVault(query: string): Promise<string> {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    return JSON.stringify({ error: 'VAULT_PATH no configurada' })
  }
  try {
    const { searchVaultIndex } = await import('@/app/lib/vault-index')
    const result = searchVaultIndex(query)
    return JSON.stringify({
      files: result.files,
      total: result.total,
      indexed: result.indexed,
      rebuilt: result.rebuilt,
    })
  } catch (err) {
    return JSON.stringify({ error: `Error buscando en vault: ${String(err)}` })
  }
}

async function readNote(notePath: string): Promise<string> {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    return JSON.stringify({ error: 'VAULT_PATH no configurada' })
  }
  try {
    const fs = await import('fs')
    const path = await import('path')
    const vp = vaultPath
    const fullPath = path.join(vp, notePath)
    if (!fullPath.startsWith(vp)) {
      return JSON.stringify({ error: 'Acceso denegado: fuera del vault' })
    }
    if (!fs.existsSync(fullPath)) {
      return JSON.stringify({ error: `Nota no encontrada: ${notePath}` })
    }
    const content = fs.readFileSync(fullPath, 'utf-8')
    return JSON.stringify({ path: notePath, content })
  } catch (err) {
    return JSON.stringify({ error: String(err) })
  }
}

async function saveNote(notePath: string, content: string): Promise<string> {
  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) {
    return JSON.stringify({ error: 'VAULT_PATH no configurada' })
  }
  try {
    const fs = await import('fs')
    const path = await import('path')
    const vp = vaultPath
    const fullPath = path.join(vp, notePath)
    if (!fullPath.startsWith(vp)) {
      return JSON.stringify({ error: 'Acceso denegado: fuera del vault' })
    }
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, content, 'utf-8')
    return JSON.stringify({ success: true, path: notePath })
  } catch (err) {
    return JSON.stringify({ error: String(err) })
  }
}

type GroqMessage = {
  role: string
  content: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result: string
  status: 'done' | 'error'
}

export async function callGroqWithTools(
  apiKey: string,
  messages: { role: string; content: string }[],
  model: string,
  maxTokens: number,
  temperature: number,
): Promise<{ stream: ReadableStream; toolCalls: ToolCallRecord[] }> {
  const finalMessages: GroqMessage[] = [...messages]
  const toolCalls: ToolCallRecord[] = []
  let toolCallCount = 0
  const MAX_TOOL_ROUNDS = 5

  while (toolCallCount < MAX_TOOL_ROUNDS) {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        stream: false,
        max_tokens: maxTokens,
        temperature,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq API error: ${errText}`)
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const msg = choice?.message

    if (!msg) throw new Error('No response from Groq')

    finalMessages.push(msg)

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // No more tool calls — now stream the final response
      break
    }

    // Execute tool calls
    for (const toolCall of msg.tool_calls) {
      let record: ToolCallRecord
      let result: string
      try {
        const parsed = JSON.parse(toolCall.function.arguments)
        result = await executeToolCall(toolCall)
        record = {
          name: toolCall.function.name,
          args: parsed,
          result,
          status: result.startsWith('{"error"') ? 'error' : 'done',
        }
      } catch (err) {
        result = JSON.stringify({ error: String(err) })
        record = { name: toolCall.function.name, args: {}, result, status: 'error' }
      }
      toolCalls.push(record)
      finalMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })
    }

    toolCallCount++
  }

  // Now stream the final response with the full context
  const streamRes = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      stream: true,
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!streamRes.ok) {
    const errText = await streamRes.text()
    throw new Error(`Groq stream error: ${errText}`)
  }

  return { stream: streamRes.body!, toolCalls }
}
