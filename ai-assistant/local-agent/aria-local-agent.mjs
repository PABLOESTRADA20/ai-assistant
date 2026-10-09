#!/usr/bin/env node
/**
 * ARIA Local Agent — abre aplicaciones en TU PC.
 *
 * ¿Por qué existe esto?
 * ----------------------
 * ARIA corre en Cloudflare Workers (el cloud de Cloudflare). Un Worker no puede
 * ejecutar nada en tu ordenador: no tiene acceso a tu sistema de archivos ni a
 * tus procesos. El navegador tampoco puede lanzar apps de escritorio por sí solo
 * (sandbox de seguridad).
 *
 * La única forma limpia es un pequeño proceso que corra en tu máquina y escuche
 * en `127.0.0.1`. Cuando en el chat pides "abre Spotify", ARIA emite un tool_call
 * `open_app`; la página web, al verlo, llama a este agente; y el agente lanza la
 * aplicación. El Worker nunca toca tu PC.
 *
 * Uso:
 *   node local-agent/aria-local-agent.mjs
 *
 * Variables de entorno (o un archivo `.env` junto a este script):
 *   ARIA_AGENT_PORT=8787              puerto local (por defecto 8787)
 *   ARIA_LOCAL_TOKEN=...              token que exige el agente. Si no lo defines,
 *                                     el agente genera uno la primera vez y lo
 *                                     guarda en `.aria-local-token` (se imprime en
 *                                     consola). El usuario lo pega UNA vez en la
 *                                     app web; queda en el `localStorage` del
 *                                     navegador, nunca en el bundle.
 *   ARIA_ALLOWED_ORIGINS=...          orígenes extra permitidos (separados por coma).
 *   ARIA_ALLOW_ANY=1                  permite abrir CUALQUIER ejecutable. Sin esta
 *                                     variable, además de las apps del mapa, se
 *                                     permiten rutas existentes y URIs, pero no
 *                                     cualquier nombre de comando.
 *
 * Seguridad: el agente escucha SOLO en 127.0.0.1 (no en la red), valida el
 * `Origin` y exige siempre el token (fail-closed). No compartas el token.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* ----------------------------- configuración ----------------------------- */

function loadEnvFile(file) {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf-8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(path.join(__dirname, '.env'))

const PORT = Number(process.env.ARIA_AGENT_PORT || 8787)
const ALLOW_ANY = process.env.ARIA_ALLOW_ANY === '1'

/**
 * Token que exige el agente. Nunca se expone en el bundle de la web: el usuario
 * lo pega UNA vez en el navegador y queda en `localStorage`.
 *
 * Orden de resolución:
 *   1. `ARIA_LOCAL_TOKEN` (variable de entorno o `.env`), si está definida.
 *   2. Un token generado la primera vez y guardado en `.aria-local-token` junto
 *      a este script (se imprime en consola para poder pegarlo). Así el valor es
 *      estable entre reinicios y no hace falta configurar nada a mano.
 */
const TOKEN_FILE = path.join(__dirname, '.aria-local-token')
const TOKEN = (() => {
  const fromEnv = process.env.ARIA_LOCAL_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    if (existsSync(TOKEN_FILE)) {
      const saved = readFileSync(TOKEN_FILE, 'utf-8').trim()
      if (saved) return saved
    }
    const generated = randomBytes(32).toString('hex')
    writeFileSync(TOKEN_FILE, generated + '\n', { mode: 0o600 })
    return generated
  } catch (err) {
    console.error('No pude leer/escribir el token local:', err.message)
    // Fail-closed: sin token, el agente rechaza todo (ver handler de /open).
    return ''
  }
})()
const EXTRA_ORIGINS = (process.env.ARIA_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const IS_WINDOWS = process.platform === 'win32'

/* ------------------------------ mapa de apps ----------------------------- */

/**
 * Alias cómodos en español e inglés. El valor es lo que se pasa al sistema.
 * Las claves se comparan en minúsculas y sin espacios.
 */
const APP_ALIASES = {
  spotify: 'spotify:',
  vscode: 'code',
  'visual studio code': 'code',
  code: 'code',
  chrome: 'chrome',
  'google chrome': 'chrome',
  edge: 'msedge',
  'microsoft edge': 'msedge',
  firefox: 'firefox',
  brave: 'brave',
  notepad: 'notepad',
  'bloc de notas': 'notepad',
  'bloc notas': 'notepad',
  calc: 'calc',
  calculadora: 'calc',
  calculator: 'calc',
  explorer: 'explorer',
  explorador: 'explorer',
  'explorador de archivos': 'explorer',
  terminal: 'wt',
  cmd: 'cmd',
  powershell: 'powershell',
  word: 'winword',
  excel: 'excel',
  powerpoint: 'powerpnt',
  outlook: 'outlook',
  whatsapp: 'whatsapp:',
  telegram: 'tg:',
  discord: 'discord:',
  steam: 'steam:',
  obs: 'obs64',
  vlc: 'vlc',
  paint: 'mspaint',
  settings: 'ms-settings:',
  configuracion: 'ms-settings:',
  ajustes: 'ms-settings:',
}

function normalizeKey(name) {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/** Caracteres que romperían el parseo de `cmd /c start` (inyección de shell). */
const UNSAFE = /[&|<>^%\r\n"`]/

function resolveTarget(app) {
  const cleaned = app.trim()
  const key = normalizeKey(cleaned)

  // 1) Alias del mapa.
  if (APP_ALIASES[key]) return { value: APP_ALIASES[key], kind: 'alias' }

  // 2) Una URI con esquema (spotify:, ms-settings:, mailto:, vscode://...).
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) && !/^[a-z]:[\\/]/i.test(cleaned)) {
    return { value: cleaned, kind: 'uri' }
  }

  // 3) Una ruta existente (archivo o carpeta): se abre con su programa asociado.
  try {
    if (existsSync(cleaned)) return { value: cleaned, kind: 'path' }
  } catch {
    /* ignore */
  }

  // 4) Un ejecutable o comando suelto solo si se permite explícitamente.
  if (ALLOW_ANY) return { value: cleaned, kind: 'command' }
  return null
}

/* --------------------------------- abrir --------------------------------- */

function launch(target, args) {
  if (UNSAFE.test(target) || (args && UNSAFE.test(args))) {
    throw new Error('El nombre o el argumento contiene caracteres no permitidos.')
  }

  // En Windows, `start` necesita un título (de ahí el "") y separa bien los
  // argumentos. `detached` + `unref` deja el proceso abierto tras cerrar el agente.
  const command = IS_WINDOWS ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const baseArgs = IS_WINDOWS ? ['/c', 'start', '', target] : [target]

  if (IS_WINDOWS && args) baseArgs.push(args)
  else if (!IS_WINDOWS && args) baseArgs.push(args)

  const child = spawn(command, baseArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', (err) => {
    console.error(`[open] error lanzando "${target}":`, err.message)
  })
  child.unref()
}

/* --------------------------------- HTTP ---------------------------------- */

function isOriginAllowed(origin) {
  if (!origin) return true
  if (EXTRA_ORIGINS.includes(origin)) return true
  try {
    const url = new URL(origin)
    // Permite la app web desplegada y el dev server local.
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
    if (url.hostname.endsWith('.workers.dev')) return true
  } catch {
    return false
  }
  return false
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-ARIA-Token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function send(res, status, payload, origin) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(origin),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024) {
        reject(new Error('Body demasiado grande'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true, name: 'aria-local-agent', platform: process.platform, allowAny: ALLOW_ANY, authRequired: Boolean(TOKEN) }, origin)
    return
  }

  if (req.method === 'GET' && url.pathname === '/apps') {
    send(res, 200, { ok: true, aliases: Object.keys(APP_ALIASES).sort() }, origin)
    return
  }

  if (req.method === 'POST' && url.pathname === '/open') {
    // Fail-closed: si por lo que sea no hay token (p. ej. no se pudo escribir el
    // archivo), se rechaza todo en vez de quedar abierto.
    if (!TOKEN || req.headers['x-aria-token'] !== TOKEN) {
      send(res, 401, { ok: false, error: 'Token incorrecto o ausente.' }, origin)
      return
    }

    let payload
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch {
      send(res, 400, { ok: false, error: 'JSON inválido.' }, origin)
      return
    }

    const app = typeof payload.app === 'string' ? payload.app : ''
    const args = typeof payload.args === 'string' ? payload.args : undefined
    if (!app) {
      send(res, 400, { ok: false, error: 'Falta el campo "app".' }, origin)
      return
    }

    const resolved = resolveTarget(app)
    if (!resolved) {
      send(
        res,
        403,
        {
          ok: false,
          error:
            `No sé cómo abrir "${app}". Usa una app del mapa, una ruta existente o una URI, ` +
            `o arranca el agente con ARIA_ALLOW_ANY=1 para permitir cualquier comando.`,
        },
        origin,
      )
      return
    }

    try {
      launch(resolved.value, args)
    } catch (err) {
      send(res, 400, { ok: false, error: String(err.message || err) }, origin)
      return
    }

    console.log(`[open] ${app}${args ? ` (${args})` : ''} -> ${resolved.kind}:${resolved.value}`)
    send(res, 200, { ok: true, message: `Abriendo ${app}…`, resolved: resolved.value, kind: resolved.kind }, origin)
    return
  }

  send(res, 404, { ok: false, error: 'Ruta no encontrada.' }, origin)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log(`  ARIA Local Agent escuchando en http://127.0.0.1:${PORT}`)
  console.log(`  Plataforma: ${process.platform}${ALLOW_ANY ? ' (modo ARIA_ALLOW_ANY=1)' : ''}`)
  console.log('')
  console.log(`  Token: ${TOKEN || '(no disponible)'}`)
  console.log('  Pegalo UNA vez en la app cuando pida el token del agente local')
  console.log('  (queda guardado en el navegador, no viaja en el bundle de la web).')
  console.log('  Deja esta ventana abierta mientras uses ARIA.')
  console.log('')
})
