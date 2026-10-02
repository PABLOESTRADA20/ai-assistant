import { GROQ, type Provider } from '@/app/lib/providers'

const GROQ_API = GROQ.apiUrl!

/**
 * `fetch` a Groq reintentando ante rate limits (HTTP 429).
 *
 * El free tier es aggressive con TPM: un tool call + el stream de respuesta +
 * la extraccion de memoria pueden cruzarse en el mismo minuto y disparar
 * `rate_limit_exceeded` ("Limit 8000, Used 5936, Requested 2343"), que ademas
 * indica cuantos segundos esperar. Sin este retry, un 429 en el tool call
 * degradaba toda la respuesta a "simple mode" y ese a su vez podia recibir
 * otro 429, dejando al usuario sin respuesta alguna.
 *
 * Respeta el `retry-after` / "Please try again in Xs" que manda Groq y solo
 * reintenta 429 y 5xx: cualquier otro 4xx se propaga de inmediato.
 *
 * Excepcion: `tool_use_failed` (HTTP 400), que tambien se reintenta. Ocurre cuando
 * el modelo genera argumentos que no cumplen el schema del tool y Groq rechaza el
 * request COMPLETO. Medido con gpt-oss-120b: emitio `{"cursor": 0, "id": 4}` para
 * `web_search` (no declaredo ni `cursor` ni `id`), y el error tumbaba todo el
 * tool-calling al "simple mode", que respondia de memoria sin buscar nada. Es
 * estocastico, no deterministico: el mismo prompt y el mismo SYSTEM_PROMPT dieron
 * 16/16 tool calls validos, asi que la respuesta correcta es reintentar (la
 * generacion siguiente difiere) y no cambiar prompts ni schemas.
 */
export async function groqFetch(
  apiKey: string,
  body: unknown,
  maxRetries = 3,
  provider: Provider = GROQ
): Promise<Response> {
  const MAX_BACKOFF_MS = 12_000
  const apiUrl = provider.apiUrl ?? GROQ_API

  let lastResponse: Response | null = null
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(provider.headers ?? {}),
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastError = err
      if (attempt === maxRetries) throw err
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)))
      continue
    }

    if (res.ok) return res

    // Consumir el body para no dejar el stream colgado antes de reintentar.
    const errText = await res.text()
    lastResponse = res

    const toolUseFailed = errText.includes('"tool_use_failed"')

    /**
     * Cuota diaria agotada: no se reintenta, se propaga.
     *
     * El 429 del free tier tiene dos causas distintas y solo una se puede reintentar:
     * TPM (8.000 por minuto) se recupera en segundos, TPD (200.000 por dia) no se
     * recupera hasta el dia siguiente. Groq lo dice en el mensaje, y reintentar contra
     * el TPD es gastar 3 reintentos y hasta 12 s de backoff para recibir el mismo
     * error. Medido en produccion: 62 s hasta devolver el error al usuario.
     */
    const dailyExhausted = /tokens per day|TPD|free-models-per-day|per day|daily limit|neurons/i.test(errText)
    if (dailyExhausted) {
      throw new Error(`${provider.label} API error: ${errText}`)
    }

    const retryable = res.status === 429 || res.status >= 500 || toolUseFailed
    if (!retryable || attempt === maxRetries) {
      throw new Error(`${provider.label} API error: ${errText}`)
    }

    const headerHint = Number(res.headers.get('retry-after'))
    const bodyHint = /try again in ([\d.]+)s/i.exec(errText)
    const hintMs = Number.isFinite(headerHint) && headerHint > 0
      ? headerHint * 1000
      : bodyHint
        ? Math.ceil(Number(bodyHint[1]) * 1000)
        : 0

    // Un `tool_use_failed` no es un rate limit: no hay que esperar, basta con
    // regenerar. Solo un backoff minimo para no clavarle la cuota de TPM.
    const backoff = toolUseFailed
      ? 300
      : Math.min(Math.max(hintMs + 500, 1000 * 2 ** attempt), MAX_BACKOFF_MS)

    console.warn(
      `${provider.label} ${res.status}${toolUseFailed ? ' tool_use_failed' : ''}, reintento ${attempt + 1}/${maxRetries} en ${backoff}ms (${errText.slice(0, 120)})`
    )
    await new Promise((r) => setTimeout(r, backoff))
  }

  // Solo se llega aqui por error de red en el ultimo intento.
  if (lastResponse) throw new Error(`${provider.label} API error ${lastResponse.status}`)
  throw lastError instanceof Error ? lastError : new Error(`${provider.label} API error`)
}

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
      description:
        'Search reference sources on the internet for current information, facts, dates, ' +
        'documentation and technical discussion. Covers official release versions ' +
        '(endoflife.date), Wikipedia, Stack Overflow, Hacker News and MDN web docs. ' +
        'Free, no API key. Not suitable for breaking news or for any page that requires ' +
        'a live index of the whole web. If the results do not contain the answer, say so ' +
        'instead of guessing.',
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
  {
    type: 'function' as const,
    function: {
      /**
       * `open_app` no se ejecuta en el servidor: Cloudflare no puede alcanzar el
       * PC del usuario. El servidor solo deja constancia de la intención y el
       * navegador, al ver este tool_call, llama al agente local en 127.0.0.1.
       */
      name: 'open_app',
      description:
        'Open an application, program, file, folder or link on the user\'s OWN computer. ' +
        'Only works in the ARIA web app and only while the local companion agent is ' +
        'running on that machine. Use natural names ("Spotify", "Visual Studio Code", ' +
        '"Bloc de notas", "Calculadora") or a URI scheme ("spotify:", "ms-settings:"). ' +
        'It cannot launch apps on the server or on a remote machine.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'App name, executable, file path or URI, e.g. "spotify", "notepad", "ms-settings:"',
          },
          args: {
            type: 'string',
            description: 'Optional argument passed to the app: a file/folder path or a URL to open with it.',
          },
        },
        required: ['app'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_email',
      description:
        'Send an email on behalf of the user. Provide the recipient address, a subject and the ' +
        'body as plain text. The user must have configured email sending (RESEND_API_KEY). ' +
        'Confirm important content with the user before sending.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address, or several separated by commas' },
          subject: { type: 'string', description: 'Subject line' },
          body: { type: 'string', description: 'Plain-text body of the email' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_repo_overview',
      description:
        'Get a read-only overview of a GitHub repository: description, language, stars, ' +
        'open issues count, top-level files and the README. This is the best first step ' +
        'when the user asks you to review a repo or suggest fixes. Read-only, never writes.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
        },
        required: ['repo'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_list_files',
      description:
        'List files and folders of a GitHub repository (read-only). Optionally restrict to a ' +
        'path prefix to explore a subdirectory. Use it to locate the files worth reading.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          path: { type: 'string', description: 'Optional folder prefix, e.g. "src/components"' },
          ref: { type: 'string', description: 'Optional branch, tag or commit SHA (default branch if omitted)' },
        },
        required: ['repo'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_read_file',
      description:
        'Read the full text content of a file in a GitHub repository (read-only). Use it after ' +
        'github_list_files to inspect the code you are asked to review or fix.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          path: { type: 'string', description: 'File path inside the repo, e.g. "src/index.ts"' },
          ref: { type: 'string', description: 'Optional branch, tag or commit SHA' },
        },
        required: ['repo', 'path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_list_issues',
      description:
        'List issues of a GitHub repository (read-only), newest first. Useful to propose fixes ' +
        'or a plan for known bugs. Pull requests are excluded.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          state: { type: 'string', description: 'open, closed or all (default open)' },
        },
        required: ['repo'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_cloud_note',
      description:
        "Save or update a note in the user's cloud ARIA folder (a persistent notes store, " +
        'available from phone and PC and exportable to Obsidian). Use it when the user asks you ' +
        'to remember, save, write down or keep information for later. If a note with the same ' +
        'title already exists it is updated instead of duplicated. This is persistent storage, ' +
        'unlike conversation memory.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, descriptive title used as the note name' },
          content: { type: 'string', description: 'Full note content in Markdown' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional short tags',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_cloud_notes',
      description:
        "List the notes in the user's cloud ARIA folder (titles, dates and a short preview). " +
        'Use it when the user asks what is saved, or before reading a note.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional text to filter by title or content' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_cloud_note',
      description:
        "Read the full content of a note in the user's cloud ARIA folder, by title (a partial " +
        'match is fine) or by id.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title or id' },
        },
        required: ['title'],
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
    case 'open_app':
      return openApp(args.app, args.args)
    case 'send_email':
      return sendEmailTool(args.to, args.subject, args.body)
    case 'github_repo_overview':
      return githubRepoOverview(args.repo)
    case 'github_list_files':
      return githubListFiles(args.repo, args.path, args.ref)
    case 'github_read_file':
      return githubReadFile(args.repo, args.path, args.ref)
    case 'github_list_issues':
      return githubListIssues(args.repo, args.state)
    case 'save_cloud_note':
      return saveCloudNote(args.title, args.content, args.tags)
    case 'list_cloud_notes':
      return listCloudNotes(args.query)
    case 'read_cloud_note':
      return readCloudNote(args.title)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

/**
 * Delegación al agente local.
 *
 * El Worker corre en el cloud de Cloudflare y no tiene forma de ejecutar nada en
 * el PC del usuario. Lo único que puede hacer es devolver el resultado del tool
 * y dejar que el cliente (que sí ve la lista de tool_calls del stream SSE) llame
 * al agente local en `http://127.0.0.1:8787`. Ver `app/lib/local-agent.ts` y
 * `local-agent/aria-local-agent.mjs`.
 */
async function openApp(app: string, target?: string): Promise<string> {
  if (!app || typeof app !== 'string') {
    return JSON.stringify({ error: 'Aplicación no válida' })
  }
  return JSON.stringify({
    status: 'delegated_to_local_agent',
    app,
    target: target || null,
    note:
      'El navegador del usuario intentará abrirlo ahora con el agente local. ' +
      'Responde que lo estás intentando o abriendo, NUNCA que ya se abrió: el ' +
      'resultado depende de que el agente local esté corriendo en su equipo.',
  })
}

async function sendEmailTool(to: string, subject: string, body: string): Promise<string> {
  if (!to || !body) {
    return JSON.stringify({ error: 'Faltan destinatario o cuerpo del correo' })
  }
  const { sendEmail } = await import('@/app/lib/email')
  const result = await sendEmail({ to, subject: subject || '(sin asunto)', text: body })
  if (!result.ok) return JSON.stringify({ error: result.message })
  return JSON.stringify({ success: true, message: result.message, id: result.id })
}

/* --------------------------- herramientas GitHub ------------------------- */

/**
 * Envoltorios de las herramientas de GitHub. Se cargan con import dinámico para
 * no arrastrar Prisma a los caminos que no las usan, igual que el correo.
 */
async function githubRepoOverview(repo?: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  const gh = await import('@/app/lib/github')
  return gh.repoOverview(repo)
}

async function githubListFiles(repo?: unknown, prefix?: unknown, ref?: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  const gh = await import('@/app/lib/github')
  return gh.listFiles(
    repo,
    typeof prefix === 'string' ? prefix : '',
    typeof ref === 'string' ? ref : undefined,
  )
}

async function githubReadFile(repo?: unknown, filePath?: unknown, ref?: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim() || typeof filePath !== 'string') {
    return JSON.stringify({ error: 'Faltan el repositorio o la ruta del archivo' })
  }
  const gh = await import('@/app/lib/github')
  return gh.readFile(repo, filePath, typeof ref === 'string' ? ref : undefined)
}

async function githubListIssues(repo?: unknown, state?: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  const gh = await import('@/app/lib/github')
  return gh.listIssues(repo, typeof state === 'string' ? state : 'open')
}

/* ----------------------- herramientas de notas nube ---------------------- */

async function saveCloudNote(title?: unknown, content?: unknown, tags?: unknown): Promise<string> {
  if (typeof title !== 'string' || !title.trim()) {
    return JSON.stringify({ error: 'Falta el título de la nota' })
  }
  if (typeof content !== 'string' || !content.trim()) {
    return JSON.stringify({ error: 'Falta el contenido de la nota' })
  }
  const notes = await import('@/app/lib/notes')
  const note = await notes.saveNote({ title, content, tags })
  return JSON.stringify({
    success: true,
    message: 'Nota guardada en la carpeta de ARIA.',
    note: { id: note.id, title: note.title, updatedAt: note.updatedAt },
  })
}

async function listCloudNotes(query?: unknown): Promise<string> {
  const notes = await import('@/app/lib/notes')
  const all = await notes.listNotes(typeof query === 'string' ? query : undefined)
  return JSON.stringify({
    count: all.length,
    notes: all.map((n) => ({
      id: n.id,
      title: n.title,
      tags: n.tags,
      updatedAt: n.updatedAt,
      preview: n.content.replace(/\s+/g, ' ').slice(0, 160),
    })),
  })
}

async function readCloudNote(title?: unknown): Promise<string> {
  if (typeof title !== 'string' || !title.trim()) {
    return JSON.stringify({ error: 'Falta el título o el id de la nota' })
  }
  const notes = await import('@/app/lib/notes')
  const note = await notes.findNote(title)
  if (!note) return JSON.stringify({ error: `No encontré la nota "${title}".` })
  return JSON.stringify({
    id: note.id,
    title: note.title,
    tags: note.tags,
    updatedAt: note.updatedAt,
    content: note.content,
  })
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

/**
 * Evaluador de expresiones aritméticas.
 *
 * NO usar `eval` / `new Function`: workerd lo prohíbe por diseño
 * ("Code generation from strings disallowed for this context"). Implementamos
 * un parser descendente recursivo sobre los tokens, que además es más seguro.
 *
 * Soporta: + - * / % ^ ( ), unario +/-, funciones (sqrt, abs, round, floor,
 * ceil, min, max, pow, sin, cos, tan, asin, acos, atan, log, log2, log10, exp)
 * y constantes (pi, e).
 */
const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  sign: Math.sign,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
}

class MathParser {
  private pos = 0

  constructor(private readonly src: string) {}

  parse(): number {
    const value = this.parseExpression()
    this.skipSpaces()
    if (this.pos < this.src.length) {
      throw new Error(`carácter inesperado en la posición ${this.pos}: "${this.src[this.pos]}"`)
    }
    return value
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++
  }

  private peek(): string {
    this.skipSpaces()
    return this.src[this.pos] ?? ''
  }

  private eat(ch: string): boolean {
    if (this.peek() === ch) {
      this.pos++
      return true
    }
    return false
  }

  /** expression := term (('+' | '-') term)* */
  private parseExpression(): number {
    let left = this.parseTerm()
    for (;;) {
      const ch = this.peek()
      if (ch === '+') {
        this.pos++
        left += this.parseTerm()
      } else if (ch === '-') {
        this.pos++
        left -= this.parseTerm()
      } else {
        return left
      }
    }
  }

  /** term := unary (('*' | '/' | '%') unary)* */
  private parseTerm(): number {
    let left = this.parseUnary()
    for (;;) {
      const ch = this.peek()
      if (ch === '*') {
        this.pos++
        left *= this.parseUnary()
      } else if (ch === '/') {
        this.pos++
        left /= this.parseUnary()
      } else if (ch === '%') {
        this.pos++
        left %= this.parseUnary()
      } else {
        return left
      }
    }
  }

  /** unary := ('+' | '-') unary | power */
  private parseUnary(): number {
    const ch = this.peek()
    if (ch === '-') {
      this.pos++
      return -this.parseUnary()
    }
    if (ch === '+') {
      this.pos++
      return this.parseUnary()
    }
    return this.parsePower()
  }

  /** power := primary ('^' unary)?  (asociativo a la derecha) */
  private parsePower(): number {
    const base = this.parsePrimary()
    if (this.eat('^')) {
      return base ** this.parseUnary()
    }
    return base
  }

  /** primary := number | '(' expression ')' | identifier (constante o función) */
  private parsePrimary(): number {
    this.skipSpaces()
    if (this.pos >= this.src.length) {
      throw new Error('expresión incompleta')
    }

    const ch = this.src[this.pos]

    if (ch === '(') {
      this.pos++
      const value = this.parseExpression()
      if (!this.eat(')')) throw new Error('falta el paréntesis de cierre ")"')
      return value
    }

    if (/[0-9.]/.test(ch)) {
      const start = this.pos
      while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos])) this.pos++
      const raw = this.src.slice(start, this.pos)
      const num = Number(raw)
      if (!Number.isFinite(num)) throw new Error(`número inválido: "${raw}"`)
      return num
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = this.pos
      while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) this.pos++
      const name = this.src.slice(start, this.pos).toLowerCase()

      // `in` recorrería el prototipo ("__proto__", "constructor", "toString"...)
      if (Object.prototype.hasOwnProperty.call(MATH_CONSTANTS, name)) {
        return MATH_CONSTANTS[name]
      }

      if (Object.prototype.hasOwnProperty.call(MATH_FUNCTIONS, name)) {
        const fn = MATH_FUNCTIONS[name]
        if (!this.eat('(')) throw new Error(`la función "${name}" requiere paréntesis`)
        const args: number[] = []
        if (!this.eat(')')) {
          do {
            args.push(this.parseExpression())
          } while (this.eat(','))
          if (!this.eat(')')) throw new Error(`falta el paréntesis de cierre de "${name}"`)
        }
        return fn(...args)
      }

      throw new Error(`función o constante desconocida: "${name}"`)
    }

    throw new Error(`carácter no permitido: "${ch}"`)
  }
}

function calculate(expression: string): string {
  if (typeof expression !== 'string' || !expression.trim()) {
    return JSON.stringify({ error: 'Expresión vacía' })
  }
  try {
    const value = new MathParser(expression).parse()
    if (!Number.isFinite(value)) {
      return JSON.stringify({ error: 'Resultado no es un número finito' })
    }
    // Redondeo para evitar ruido de punto flotante (0.1+0.2 = 0.30000000000000004)
    return JSON.stringify({ expression, result: Number(value.toPrecision(12)) })
  } catch (err) {
    return JSON.stringify({ error: `Error evaluando expresión: ${err instanceof Error ? err.message : String(err)}` })
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
    const { searchWeb } = await import('@/app/lib/web-search')
    const outcome = await searchWeb(query, 6)

    if (outcome.results.length === 0) {
      return JSON.stringify({
        error: 'No se encontraron resultados en las fuentes disponibles',
        query: outcome.query,
        warnings: outcome.warnings,
      })
    }

    return JSON.stringify({
      query: outcome.query,
      // Formato legible para el modelo, que lo resumira en su respuesta.
      summary: outcome.results
        .map(
          (r, i) =>
            `[${i + 1}] (${r.source}) ${r.title}\n    ${r.url}\n    ${r.snippet}`
        )
        .join('\n'),
      sources: outcome.sources,
      warnings: outcome.warnings,
    })
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
  forceSearch = false,
  /**
   * Si se indica, solo se ofrecen estas herramientas. Útil para canales donde
   * algunas no tienen sentido: `open_app` no puede funcionar por WhatsApp (no hay
   * agente local), así que allí se excluye.
   */
  allowedTools?: string[],
  /** Proveedor del modelo (Groq por defecto). Permite enrutar a otro gateway. */
  provider: Provider = GROQ,
): Promise<{ stream: ReadableStream; toolCalls: ToolCallRecord[]; hitRoundLimit: boolean }> {
  const toolDefinitions = allowedTools
    ? TOOL_DEFINITIONS.filter((t) => allowedTools.includes(t.function.name))
    : TOOL_DEFINITIONS
  // Si no se ofrece `web_search`, forzar la primera ronda contra esa herramienta
  // haría que Groq rechace el request entero. En ese caso se decide en 'auto'.
  const canForceSearch = toolDefinitions.some((t) => t.function.name === 'web_search')

  const finalMessages: GroqMessage[] = [...messages]
  const toolCalls: ToolCallRecord[] = []
  let toolCallCount = 0
  // 3 rondas: con 5 el modelo entra en bucle de busquedas casi identicas
  // (medido: 5 web_search sobre lo mismo) y cada ronda gasta TPM del free
  // tier, alargando la respuesta a 25-70s sin llegar a contenido final.
  const MAX_TOOL_ROUNDS = 3

  /**
   * `web_search` obligatorio en la primera ronda.
   *
   * Con `tool_choice: 'auto'` el modelo decide, y decide no buscar. Medido: con
   * "Busca en la web como se instala Deno" respondio de memoria con
   * `tool_calls: 0`, inventandose el comando. El SYSTEM_PROMPT ya le dice que use las
   * herramientas, pero son instrucciones blandas y en la practica pierde: cuando el
   * modelo "ya sabe" la respuesta, escribirla le sale mas barato que pedirla.
   *
   * Por eso el detonante no es el prompt sino el mensaje del usuario: cuando pide
   * buscar explicitamente, se fuerza. Aqui no se decide que lo haya pedido, eso lo
   * hace `wantsWebSearch` en la ruta.
   *
   * El forzado a veces no lo respeta, y no es raro: medido 2 de 4 intentos correctos
   * en `openai/gpt-oss-120b`, que responde la pregunta en texto plano y Groq lo
   * rechaza con HTTP 400 `tool_use_failed` ("Tool choice is required, but model did
   * not call a tool"). Es el mismo error estocastico que ya se reintentaba dentro de
   * `groqFetch`, pero aqui sale por la via del `tool_choice`. Con 2 reintentos la
   * probabilidad de fallo completo baja a ~25%, y si aun asi falla lo captura el
   * paso siguiente.
   */
  let searched = !forceSearch || !canForceSearch

  while (toolCallCount < MAX_TOOL_ROUNDS) {
    const body = {
      model,
      messages: finalMessages,
      tools: toolDefinitions,
      tool_choice: searched
        ? ('auto' as const)
        : ({ type: 'function', function: { name: 'web_search' } } as const),
      stream: false,
      max_tokens: maxTokens,
      temperature,
    }

    let res: Response
    try {
      // El forzado lleva 2 reintentos y no 3 porque cada intento es un 400 que no
      // aporta nada: con el rate limit de 8000 TPM, insistir de mas sale peor que
      // aceptar un 'auto' sin busqueda.
      res = await groqFetch(apiKey, body, searched ? 3 : 2, provider)
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error)
      if (searched || !/HTTP 400|tool_use_failed|invalid/i.test(detail)) throw error
      // El modelo no admite el forzado: se sigue con decision propia.
      console.warn(`tool_choice forzado rechazado, reintentando en auto: ${detail}`)
      searched = true
      continue
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

    // La busqueda forzada ya se hizo: a partir de aqui manda 'auto' para no gastar
    // una ronda entera repitiendo la obligacion.
    searched = true
  }

  // Now stream the final response with the full context.
  //
  // Si se agotaron las rondas, el modelo sigue pidiendo herramientas en bucle
  // (medido: 5 web_search sobre lo mismo) y el stream final llega sin texto, solo
  // `reasoning`. Se le indica explicitamente que responda con lo ya reunido.
  //
  // Va como `user` y no como `system`: los modelos `gpt-oss-*` viven en formato
  // harmony y no aplican un `system` inyectado a mitad del historial, con lo que
  // el aviso se pierde y el stream vuelve a cerrarse vacio.
  const hitRoundLimit = toolCallCount >= MAX_TOOL_ROUNDS
  if (hitRoundLimit) {
    console.warn(`Limite de ${MAX_TOOL_ROUNDS} rondas de herramientas alcanzado, forzando respuesta`)
    finalMessages.push({
      role: 'user',
      content:
        'AVISO: se agoto el limite de busquedas. No pidas mas herramientas. ' +
        'Responde ahora al usuario con la informacion que ya tenes, citando las ' +
        'fuentes. Si no alcanza, decilo explicitamente.',
    })
  }

  const streamRes = await groqFetch(apiKey, {
    model,
    messages: finalMessages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
  }, 3, provider)

  return { stream: streamRes.body!, toolCalls, hitRoundLimit }
}
