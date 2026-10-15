import { GROQ, type Provider } from '@/app/lib/providers'
import type { MemoryUpdate } from '@/app/lib/memory'
import { markGroqQuota, nextMidnightUtc, parseResetWindow, untilFromError } from '@/app/lib/quota'
import { sliceWindow, stubToolResult } from '@/app/lib/truncate'

const GROQ_API = GROQ.apiUrl!

/** Modelo de un body de chat completions, '' si no lo trae. */
function bodyModel(body: unknown): string {
  if (body && typeof body === 'object' && 'model' in body) {
    const model = (body as { model?: unknown }).model
    if (typeof model === 'string') return model
  }
  return ''
}

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
          'Content-Type': 'application/json',
          // Si un proveedor no necesita clave, no se manda `Authorization`.
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
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

    if (res.ok) {
      /**
       * Cuota diaria agotada ANTES del primer 429.
       *
       * `x-ratelimit-remaining-requests` de Groq siempre es RPD (peticiones
       * por día, se reinicia a medianoche UTC) y `x-ratelimit-reset-requests`
       * dice cuánto falta (`2m59.56s`, `23h59m59s`). Si llega a 0, el
       * siguiente request va a fallar igual: se deja constancia ahora para que
       * la ruta de chat salte directo al modo reserva sin gastar el intento.
       */
      if (provider.id === 'groq') {
        const remaining = res.headers.get('x-ratelimit-remaining-requests')
        const model = bodyModel(body)
        if (model && remaining !== null && Number(remaining) <= 0) {
          const until =
            parseResetWindow(res.headers.get('x-ratelimit-reset-requests')) ??
            nextMidnightUtc().toISOString()
          void markGroqQuota(model, until)
        }
      }
      return res
    }

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
      // Se registra el hasta-cuándo en la base: el próximo request de chat no
      // tendrá que pagarlo para saberlo (ver app/lib/quota.ts). Solo aplica a
      // Groq: los demás proveedores no comparten este límite ni este código.
      if (provider.id === 'groq') {
        const model = bodyModel(body)
        if (model) void markGroqQuota(model, untilFromError(errText))
      }
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
      description: 'Read the content of a note from the Obsidian vault (long notes are windowed; continue with offset)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from vault root, e.g. "06-Programacion/TypeScript.md"' },
          offset: { type: 'integer', description: 'Optional character offset to continue a long note (use next_offset from the previous call)' },
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
        'Read the text content of a file in a GitHub repository (read-only), windowed to a ' +
        'maximum per call; continue with offset. Use it after github_list_files to inspect the ' +
        'code you are asked to review or fix.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          path: { type: 'string', description: 'File path inside the repo, e.g. "src/index.ts"' },
          ref: { type: 'string', description: 'Optional branch, tag or commit SHA' },
          offset: { type: 'integer', description: 'Optional character offset to continue a long file (use next_offset from the previous call)' },
          start_line: { type: 'integer', description: 'Optional 1-based first line to read (returns numbered lines). Overrides offset.' },
          end_line: { type: 'integer', description: 'Optional 1-based last line to read, inclusive. With start_line, read a line range.' },
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
      name: 'github_create_pull_request',
      description:
        'Create a SAFE proposed change in a GitHub repository: it creates a new aria/* branch, ' +
        'writes up to 5 text files there, and opens a pull request for human review. It never ' +
        'writes to the default branch, never merges, never deletes files, and cannot edit ' +
        '.github/workflows. Use ONLY when the user explicitly asks to implement or modify code, ' +
        'and only after reading the relevant files. Requires GITHUB_WRITE_ENABLED=true and a ' +
        'fine-grained token with Contents: write and Pull requests: write.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          title: { type: 'string', description: 'Short pull request title' },
          body: { type: 'string', description: 'Pull request explanation, tests and risks' },
          branch: { type: 'string', description: 'Optional short branch description; aria/ is added automatically' },
          changes: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Repository-relative file path' },
                content: { type: 'string', description: 'Complete new text content for the file' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['repo', 'title', 'changes'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_apply_patch',
      description:
        'Edit existing files in a GitHub repository with small, precise patches instead of ' +
        'rewriting whole files. Each patch is {path, search, replace}: "search" must be the ' +
        'EXACT literal block (copy it verbatim from github_read_file, including indentation) ' +
        'and must appear exactly once in the file; "replace" is the new text. Provide "baseSha" ' +
        'from the file you read so a concurrent change aborts the patch. By default it creates ' +
        'a new aria/* branch and a pull request; pass "branch" (an existing aria/* branch) to ' +
        'commit a fix onto an open pull request. It never writes to the default branch, never ' +
        'merges, never deletes files, cannot edit .github/workflows, and rejects patches that ' +
        'delete too much. Automatic fixes on the same branch are limited to 2; after that the ' +
        'patch is refused and human review is required. Requires GITHUB_WRITE_ENABLED=true and a ' +
        'fine-grained token with Contents: write and Pull requests: write. Use it (not ' +
        'github_create_pull_request) for any change to an existing file.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          title: { type: 'string', description: 'Short pull request title (used for a new branch/PR)' },
          body: { type: 'string', description: 'Pull request explanation, tests and risks' },
          branch: {
            type: 'string',
            description:
              'Optional existing aria/* branch to commit the patch to (to fix an open PR). ' +
              'Omit to create a new aria/* branch and pull request.',
          },
          patches: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Repository-relative path of an EXISTING file' },
                search: { type: 'string', description: 'Exact literal block to find (must match exactly once)' },
                replace: { type: 'string', description: 'Replacement text for the matched block' },
                baseSha: { type: 'string', description: 'Optional blob sha from github_read_file; aborts if the file changed' },
              },
              required: ['path', 'search', 'replace'],
            },
          },
        },
        required: ['repo', 'title', 'patches'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'github_get_check_runs',
      description:
        'Read-only: check the CI status of a pull request or branch (GitHub Actions check runs ' +
        'plus legacy commit statuses) for its latest commit. Returns an aggregate state ' +
        '(success, failure, pending or none), per-check counts, the SHA checked, and for ' +
        'failures the check output and annotations (file, line, message). It cannot read the ' +
        'full Actions log (that is a ZIP behind the API), so when there is no detail it says ' +
        'so instead of guessing. Call it after opening or patching a pull request, and never ' +
        'tell the user a change is ready while the state is pending or failure. If it fails, ' +
        'fix it on the same branch with github_apply_patch (at most two corrections per PR).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository as "owner/repo" or its GitHub URL' },
          pr: { type: 'integer', description: 'Pull request number (preferred)' },
          branch: { type: 'string', description: 'Branch name, e.g. the aria/* branch, if you do not have the PR number' },
        },
        required: ['repo'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_code',
      description:
        "Semantic search over the user's own project, which is indexed locally as " +
        'function/class/file chunks (built by `npm run db:index-code`). It combines ' +
        'vector similarity with exact identifier matching and returns path, line range, ' +
        'symbol and the code itself, so you can locate WHERE something lives without ' +
        'reading files one by one. Use it first to jump to the right place, then ' +
        'github_read_file for exact bytes around it. It only searches what is indexed; ' +
        'an empty result means the index is missing or stale, not that the code does not exist.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'What you need: a symbol, an identifier, or what you want to understand, ' +
              'e.g. "where is the tool loop bounded" or "applyPatch"',
          },
          repo: {
            type: 'string',
            description: 'Optional "owner/repo" label to filter; omit to search everything indexed',
          },
          limit: { type: 'integer', description: 'How many results, 1-10 (default 6)' },
        },
        required: ['query'],
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
        "Read the content of a note in the user's cloud ARIA folder, by title (a partial " +
        'match is fine) or by id. Long notes are windowed; continue with offset.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title or id' },
          offset: { type: 'integer', description: 'Optional character offset to continue a long note (use next_offset from the previous call)' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_memory',
      description:
        'Edit an existing memory of the user, by id (get the id with recall_memory first). Use it only ' +
        'when the user asks to correct, update or forget something you had memorized. Every change is ' +
        'audited and can be undone with revert_change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id (uuid), obtained from recall_memory' },
          content: { type: 'string', description: 'New memory text (max 2000 characters)' },
          importance: { type: 'number', description: 'How important it is, 0..1' },
          category: { type: 'string', description: 'New category' },
          type: { type: 'string', description: 'New memory type' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_cloud_note',
      description:
        "Edit an existing note in the user's cloud ARIA folder, by id (get the id with list_cloud_notes " +
        'or read_cloud_note). Use it to fix or extend a saved note instead of saving it again. Every ' +
        'change is audited and can be undone with revert_change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Note id (uuid), obtained from list_cloud_notes or read_cloud_note' },
          title: { type: 'string', description: 'New title (max 200 characters)' },
          content: { type: 'string', description: 'New full note content in Markdown' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags' },
          pinned: { type: 'boolean', description: 'Pin or unpin the note' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'revert_change',
      description:
        'Undo a previous data change made by ARIA on a memory or a cloud note, restoring its previous ' +
        'value. Pass changeId (returned by update_memory / update_cloud_note), or entity + entityId to ' +
        'undo the latest change on that item.',
      parameters: {
        type: 'object',
        properties: {
          changeId: { type: 'string', description: 'Change id returned by a previous update_* call' },
          entity: { type: 'string', enum: ['memory', 'note'], description: 'Which kind of item to undo the latest change of' },
          entityId: { type: 'string', description: 'Id of the memory or note (used with entity)' },
        },
        required: [],
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
      return readNote(args.path, args.offset)
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
      return githubReadFile(args.repo, args.path, args.ref, args.offset, args.start_line, args.end_line)
    case 'github_list_issues':
      return githubListIssues(args.repo, args.state)
    case 'github_create_pull_request':
      return githubCreatePullRequest(args)
    case 'github_apply_patch':
      return githubApplyPatch(args)
    case 'github_get_check_runs':
      return githubGetCheckRuns(args.repo, args.pr, args.branch)
    case 'search_code':
      return searchCodeTool(args)
    case 'save_cloud_note':
      return saveCloudNote(args.title, args.content, args.tags)
    case 'list_cloud_notes':
      return listCloudNotes(args.query)
    case 'read_cloud_note':
      return readCloudNote(args.title, args.offset)
    case 'update_memory':
      return updateMemoryTool(args)
    case 'update_cloud_note':
      return updateCloudNoteTool(args)
    case 'revert_change':
      return revertChangeTool(args)
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

async function githubReadFile(
  repo?: unknown,
  filePath?: unknown,
  ref?: unknown,
  offset?: unknown,
  startLine?: unknown,
  endLine?: unknown,
): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim() || typeof filePath !== 'string') {
    return JSON.stringify({ error: 'Faltan el repositorio o la ruta del archivo' })
  }
  const gh = await import('@/app/lib/github')
  return gh.readFile(
    repo,
    filePath,
    typeof ref === 'string' ? ref : undefined,
    offset,
    startLine,
    endLine,
  )
}

async function githubListIssues(repo?: unknown, state?: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  const gh = await import('@/app/lib/github')
  return gh.listIssues(repo, typeof state === 'string' ? state : 'open')
}

async function githubCreatePullRequest(args: Record<string, unknown>): Promise<string> {
  if (typeof args.repo !== 'string' || !args.repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  if (typeof args.title !== 'string' || !args.title.trim() || !Array.isArray(args.changes)) {
    return JSON.stringify({ error: 'Faltan el título o los archivos del pull request' })
  }
  const gh = await import('@/app/lib/github')
  return gh.createPullRequest({
    repo: args.repo,
    title: args.title,
    body: typeof args.body === 'string' ? args.body : undefined,
    branch: typeof args.branch === 'string' ? args.branch : undefined,
    changes: args.changes as { path: string; content: string }[],
  })
}

async function githubApplyPatch(args: Record<string, unknown>): Promise<string> {
  if (typeof args.repo !== 'string' || !args.repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  if (typeof args.title !== 'string' || !args.title.trim() || !Array.isArray(args.patches)) {
    return JSON.stringify({ error: 'Faltan el título o los parches' })
  }
  const gh = await import('@/app/lib/github')
  return gh.applyPatch({
    repo: args.repo,
    title: args.title,
    body: typeof args.body === 'string' ? args.body : undefined,
    branch: typeof args.branch === 'string' ? args.branch : undefined,
    patches: args.patches as {
      path: string
      search: string
      replace: string
      baseSha?: string
    }[],
  })
}

async function githubGetCheckRuns(
  repo?: unknown,
  pr?: unknown,
  branch?: unknown,
): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) {
    return JSON.stringify({ error: 'Falta el repositorio (formato owner/repo)' })
  }
  const gh = await import('@/app/lib/github')
  return gh.getCheckRuns({
    repo,
    pr,
    branch: typeof branch === 'string' ? branch : undefined,
  })
}

/* ----------------------- herramientas de notas nube ---------------------- */

/** Tope de lectura de una nota (vault o nube) por llamada; el resto se pide con `offset`. */
export const NOTE_READ_MAX = 6000

async function saveCloudNote(title?: unknown, content?: unknown, tags?: unknown): Promise<string> {
  if (typeof title !== 'string' || !title.trim()) {
    return JSON.stringify({ error: 'Falta el título de la nota' })
  }
  if (typeof content !== 'string' || !content.trim()) {
    return JSON.stringify({ error: 'Falta el contenido de la nota' })
  }
  const notes = await import('@/app/lib/notes')
  const note = await notes.saveNote({ title, content, tags })
  // Cerebro: espejo en Memoria para que la búsqueda unificada la encuentre.
  // Best-effort: el guardado de la nota no debe fallar por esto.
  const { mirrorNoteToMemory } = await import('@/app/lib/brain')
  await mirrorNoteToMemory(note).catch(() => {})
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

async function readCloudNote(title?: unknown, offset?: unknown): Promise<string> {
  if (typeof title !== 'string' || !title.trim()) {
    return JSON.stringify({ error: 'Falta el título o el id de la nota' })
  }
  const notes = await import('@/app/lib/notes')
  const note = await notes.findNote(title)
  if (!note) return JSON.stringify({ error: `No encontré la nota "${title}".` })
  const window = sliceWindow(note.content, offset, NOTE_READ_MAX)
  return JSON.stringify({
    id: note.id,
    title: note.title,
    tags: note.tags,
    updatedAt: note.updatedAt,
    offset: window.offset,
    truncated: window.truncated,
    next_offset: window.nextOffset,
    content: window.content,
  })
}

/* ------------------ modificación de memorias y notas (FASE 4) ------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tope de texto de una memoria (una memoria es una frase, no un documento). */
const MEMORY_CONTENT_MAX = 2000
/** Topes de una nota de la nube. */
const NOTE_TITLE_MAX = 200
const NOTE_CONTENT_MAX = 50000

/** Copia solo los campos que se pueden modificar; es lo que se audita. */
function memorySnapshot(m: {
  type: string
  category: string
  content: string
  importance: number
  confidence: number
  tags: string[]
}) {
  return {
    type: m.type,
    category: m.category,
    content: m.content,
    importance: m.importance,
    confidence: m.confidence,
    tags: m.tags,
  }
}

function noteSnapshot(n: { title: string; content: string; tags: string[]; pinned: boolean }) {
  return { title: n.title, content: n.content, tags: n.tags, pinned: n.pinned }
}

async function updateMemoryTool(args: Record<string, unknown>): Promise<string> {
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (!UUID_RE.test(id)) {
    return JSON.stringify({ error: 'Falta un id de memoria válido (uuid). Obtenlo con recall_memory.' })
  }

  const patch: MemoryUpdate = {}
  if (args.content !== undefined) {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      return JSON.stringify({ error: 'El contenido de la memoria no puede quedar vacío' })
    }
    if (args.content.length > MEMORY_CONTENT_MAX) {
      return JSON.stringify({ error: `El contenido supera el máximo de ${MEMORY_CONTENT_MAX} caracteres` })
    }
    patch.content = args.content
  }
  if (args.importance !== undefined) {
    const n = Number(args.importance)
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return JSON.stringify({ error: 'importance debe ser un número entre 0 y 1' })
    }
    patch.importance = n
  }
  if (typeof args.category === 'string' && args.category.trim()) patch.category = args.category.trim()
  if (typeof args.type === 'string' && args.type.trim()) patch.type = args.type.trim()
  if (Array.isArray(args.tags)) {
    patch.tags = args.tags.filter((t): t is string => typeof t === 'string')
  }
  if (Object.keys(patch).length === 0) {
    return JSON.stringify({ error: 'No indicaste ningún campo para cambiar' })
  }

  const [memory, changelog] = await Promise.all([
    import('@/app/lib/memory'),
    import('@/app/lib/changelog'),
  ])

  const before = await memory.findMemoryById(id)
  if (!before) return JSON.stringify({ error: `No encontré una memoria con id ${id}` })

  const recent = await changelog.countRecentChanges('memory', id)
  if (recent >= changelog.MAX_CHANGES_PER_MINUTE) {
    return JSON.stringify({
      error: `Demasiados cambios seguidos en esta memoria (límite ${changelog.MAX_CHANGES_PER_MINUTE}/min). Esperá un momento.`,
    })
  }

  let updated: Awaited<ReturnType<typeof memory.updateMemory>>
  try {
    updated = await memory.updateMemory(id, patch)
  } catch {
    // `updateMemory` aplica los campos y DESPUÉS recalcula el embedding; si eso
    // falla (p. ej. cuota diaria de Workers AI agotada, `embed` lanza) la fila
    // ya cambió. Releemos para no perder el cambio ni dejar la auditoría a medias.
    const after = await memory.findMemoryById(id).catch(() => null)
    if (!after) return JSON.stringify({ error: 'No se pudo actualizar la memoria' })
    const change = await changelog.recordChange({
      entity: 'memory',
      entityId: id,
      before: memorySnapshot(before),
      after: memorySnapshot(after),
    })
    return JSON.stringify({
      success: true,
      warning:
        'La memoria se actualizó, pero no se pudo recalcular su embedding (se corregirá al reindexar).',
      id,
      changeId: change.id,
      memory: {
        content: after.content,
        importance: after.importance,
        category: after.category,
        tags: after.tags,
      },
    })
  }

  const change = await changelog.recordChange({
    entity: 'memory',
    entityId: id,
    before: memorySnapshot(before),
    after: memorySnapshot(updated),
  })

  return JSON.stringify({
    success: true,
    message: 'Memoria actualizada.',
    id,
    changeId: change.id,
    memory: {
      content: updated.content,
      importance: updated.importance,
      category: updated.category,
      tags: updated.tags,
    },
  })
}

async function updateCloudNoteTool(args: Record<string, unknown>): Promise<string> {
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (!UUID_RE.test(id)) {
    return JSON.stringify({ error: 'Falta un id de nota válido (uuid). Obtenlo con list_cloud_notes.' })
  }

  const patch: { title?: string; content?: string; tags?: string[]; pinned?: boolean } = {}
  if (args.title !== undefined) {
    if (typeof args.title !== 'string' || !args.title.trim()) {
      return JSON.stringify({ error: 'El título de la nota no puede quedar vacío' })
    }
    if (args.title.length > NOTE_TITLE_MAX) {
      return JSON.stringify({ error: `El título supera el máximo de ${NOTE_TITLE_MAX} caracteres` })
    }
    patch.title = args.title
  }
  if (args.content !== undefined) {
    if (typeof args.content !== 'string' || !args.content.trim()) {
      return JSON.stringify({ error: 'El contenido de la nota no puede quedar vacío' })
    }
    if (args.content.length > NOTE_CONTENT_MAX) {
      return JSON.stringify({ error: `El contenido supera el máximo de ${NOTE_CONTENT_MAX} caracteres` })
    }
    patch.content = args.content
  }
  if (Array.isArray(args.tags)) {
    patch.tags = args.tags.filter((t): t is string => typeof t === 'string')
  }
  if (typeof args.pinned === 'boolean') patch.pinned = args.pinned
  if (Object.keys(patch).length === 0) {
    return JSON.stringify({ error: 'No indicaste ningún campo para cambiar' })
  }

  const [notes, changelog] = await Promise.all([
    import('@/app/lib/notes'),
    import('@/app/lib/changelog'),
  ])

  const before = await notes.getNote(id)
  if (!before) return JSON.stringify({ error: `No encontré una nota con id ${id}` })

  const recent = await changelog.countRecentChanges('note', id)
  if (recent >= changelog.MAX_CHANGES_PER_MINUTE) {
    return JSON.stringify({
      error: `Demasiados cambios seguidos en esta nota (límite ${changelog.MAX_CHANGES_PER_MINUTE}/min). Esperá un momento.`,
    })
  }

  const updated = await notes.updateNote(id, patch)
  if (!updated) return JSON.stringify({ error: 'No se pudo actualizar la nota' })

  const change = await changelog.recordChange({
    entity: 'note',
    entityId: id,
    before: noteSnapshot(before),
    after: noteSnapshot(updated),
  })

  return JSON.stringify({
    success: true,
    message: 'Nota actualizada.',
    id,
    changeId: change.id,
    note: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt },
  })
}

/**
 * Deshace un cambio auditado reaplicando su valor anterior (`before`). Se puede
 * pedir por `changeId` (lo devuelven `update_memory` / `update_cloud_note`) o
 * por `entity` + `entityId` (revierte el último cambio de ese registro).
 */
async function revertChangeTool(args: Record<string, unknown>): Promise<string> {
  const changelog = await import('@/app/lib/changelog')

  let change: import('@/app/lib/changelog').ChangeRecord | null = null
  const changeId = typeof args.changeId === 'string' ? args.changeId.trim() : ''
  if (changeId) {
    change = await changelog.getChange(changeId)
  } else {
    const entity = args.entity === 'memory' || args.entity === 'note' ? args.entity : null
    const entityId = typeof args.entityId === 'string' ? args.entityId.trim() : ''
    if (!entity || !entityId) {
      return JSON.stringify({ error: 'Indicá changeId, o bien entity + entityId' })
    }
    change = await changelog.latestChange(entity, entityId)
  }

  if (!change) return JSON.stringify({ error: 'No encontré ese cambio' })
  if (change.revertedAt) return JSON.stringify({ error: 'Ese cambio ya estaba revertido' })

  const before = change.before as Record<string, unknown> | null
  if (!before || typeof before !== 'object') {
    return JSON.stringify({ error: 'El cambio no guarda un valor anterior: no se puede revertir' })
  }

  if (change.entity === 'memory') {
    const memory = await import('@/app/lib/memory')
    const current = await memory.findMemoryById(change.entityId)
    if (!current) return JSON.stringify({ error: 'La memoria ya no existe' })
    try {
      await memory.updateMemory(change.entityId, before as MemoryUpdate)
    } catch {
      // Mismo caso que en `update_memory`: los campos se reaplican antes de
      // recalcular el embedding; si eso falla, el valor anterior ya volvió.
      const after = await memory.findMemoryById(change.entityId).catch(() => null)
      if (!after) return JSON.stringify({ error: 'No se pudo revertir la memoria' })
    }
  } else if (change.entity === 'note') {
    const notes = await import('@/app/lib/notes')
    const current = await notes.getNote(change.entityId)
    if (!current) return JSON.stringify({ error: 'La nota ya no existe' })
    await notes.updateNote(change.entityId, before as { title?: string; content?: string; tags?: unknown; pinned?: boolean })
  } else {
    return JSON.stringify({ error: `No sé revertir cambios de tipo "${change.entity}"` })
  }

  const marked = await changelog.markReverted(change.id)
  if (!marked) return JSON.stringify({ error: 'Ese cambio ya estaba revertido' })

  return JSON.stringify({
    success: true,
    message: 'Cambio revertido.',
    changeId: change.id,
    entity: change.entity,
    entityId: change.entityId,
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

/**
 * Búsqueda sobre el índice de código (FASE 3).
 *
 * El índice lo construye `scripts/index-code.ts` en la PC; acá solo se consulta
 * la tabla `CodeChunk`. Se importa en diferido para no cargar el módulo (y su
 * Prisma) cuando la herramienta no se usa.
 */
async function searchCodeTool(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return JSON.stringify({ error: 'query vacía' })

  const rawLimit = Number(args.limit)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 10) : 6
  const repo = typeof args.repo === 'string' && args.repo.trim() ? args.repo.trim() : null

  try {
    const { searchCode, formatCodeLocation } = await import('@/app/lib/code-index')
    const hits = await searchCode(query, { limit, repo })
    if (hits.length === 0) {
      return JSON.stringify({
        results: [],
        note:
          'El índice de código no devolvió nada. O no está construido (ejecutar ' +
          '`npm run db:index-code` en la PC donde está el repo) o el tema no está cubierto. ' +
          'Puedes leer el fichero concreto con github_read_file.',
      })
    }
    return JSON.stringify({
      results: hits.map((hit) => ({
        where: formatCodeLocation(hit),
        score: hit.score,
        code: hit.content.slice(0, 900),
      })),
    })
  } catch (err) {
    return JSON.stringify({ error: `Error buscando en el índice de código: ${String(err)}` })
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
        // El `id` es imprescindible: `update_memory` trabaja por id (FASE 4).
        id: m.id,
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

async function readNote(notePath: string, offset?: unknown): Promise<string> {
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
    const window = sliceWindow(content, offset, NOTE_READ_MAX)
    return JSON.stringify({
      path: notePath,
      size: content.length,
      offset: window.offset,
      truncated: window.truncated,
      next_offset: window.nextOffset,
      content: window.content,
    })
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
  /**
   * Rondas máximas de herramientas.
   *
   * Con 3 una revisión de código no alcanzaba a leer los archivos relevantes.
   * Se subió a 5, y ahora a 8: un ciclo real de edición es leer (varios
   * archivos) → parchear → confirmar, y en la Fase 2 se suma consultar los
   * checks y corregir. Con 5 se cortaba justo al empezar lo útil. La guarda
   * anti-bucle (abajo) sigue evitando el bucle medido de `web_search` idénticos,
   * así que subir no lo reintroduce; el costo es cuota de TPM del free tier.
   */
  const MAX_TOOL_ROUNDS = 8
  /**
   * Rondas cuyos resultados se conservan COMPLETOS en el contexto final. Antes
   * solo sobrevivía la última y las anteriores se borraban a una línea, así que
   * la respuesta se redactaba sin lo leído. Las más viejas se recortan a su
   * cabecera (`stubToolResult`), no se borran.
   */
  const KEEP_FULL_ROUNDS = 2

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
  // Índices de los mensajes `tool` de cada ronda ya ejecutada, en orden. Sirve
  // para recortar (no borrar) los resultados viejos al empezar otra ronda.
  const toolRounds: number[][] = []
  // Firmas `nombre:argumentos` ya ejecutadas, para detectar rondas que no
  // aportan nada nuevo (guarda anti-bucle).
  const seenCalls = new Set<string>()

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

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // No more tool calls — now stream the final response
      finalMessages.push(msg)
      break
    }

    // Guarda anti-bucle: si la ronda solo repite llamadas ya hechas (mismo
    // nombre y argumentos), no aporta nada nuevo. Se descarta (no se envía al
    // modelo, que la respondería pidiendo más) y se pasa a redactar con lo ya
    // reunido. Sin esto, subir las rondas reintroduce el bucle medido de
    // `web_search` idénticos.
    const isNovel = msg.tool_calls.some(
      (tc: ToolCall) => !seenCalls.has(`${tc.function.name}:${tc.function.arguments}`),
    )
    if (!isNovel) {
      console.warn('Ronda de herramientas sin llamadas nuevas; se corta para redactar')
      break
    }

    finalMessages.push(msg)

    // Hay una nueva ronda: se recortan a su cabecera los resultados de las
    // rondas más viejas, conservando COMPLETAS las últimas KEEP_FULL_ROUNDS.
    // Antes se borraban a una línea, con lo que la respuesta final perdía el
    // README, el árbol y los archivos ya leídos.
    const stubUntil = toolRounds.length - KEEP_FULL_ROUNDS
    for (let r = 0; r < stubUntil; r++) {
      for (const index of toolRounds[r]) {
        const current = finalMessages[index].content
        if (typeof current === 'string') {
          finalMessages[index].content = stubToolResult(current)
        }
      }
    }

    // Execute tool calls
    const roundIndexes: number[] = []
    for (const toolCall of msg.tool_calls) {
      seenCalls.add(`${toolCall.function.name}:${toolCall.function.arguments}`)
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
      roundIndexes.push(finalMessages.length - 1)
    }
    toolRounds.push(roundIndexes)

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
