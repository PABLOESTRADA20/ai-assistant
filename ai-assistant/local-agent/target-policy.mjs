/**
 * Política de seguridad del agente local de ARIA.
 *
 * El agente local puede abrir aplicaciones en el PC, así que la decisión de qué
 * se permite abrir vive aquí, separada del servidor HTTP. Esto permite probarla
 * sin arrancar el agente ni tocar el disco (la existencia de rutas se inyecta).
 *
 * Reglas:
 *  - Solo se permiten los esquemas URI de la lista blanca.
 *  - Una ruta existente se abre solo si no es ejecutable y sin argumentos.
 *  - Las consolas (cmd, powershell, terminal) se abren solo sin argumentos.
 *  - Los argumentos deben ser una URL http(s) o una ruta existente no ejecutable,
 *    sin caracteres de inyección.
 *  - ARIA_ALLOW_ANY=1 permite nombres de comando sueltos, pero nunca salta las
 *    reglas de inyección ni las de consolas/rutas.
 */
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto'
import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs'
import path from 'node:path'

/** Esquemas que el agente puede entregar al sistema operativo. */
export const ALLOWED_URI_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'spotify',
  'ms-settings',
  'whatsapp',
  'tg',
  'discord',
  'steam',
  'vscode',
])

/** Extensiones que nunca se abren por ruta (son ejecutables o scripts). */
export const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'msi',
  'msp',
  'lnk',
  'scr',
  'pif',
  'cpl',
  'hta',
  'reg',
  'jar',
  'dll',
  'sh',
  'appimage',
  'app',
  'command',
])

/** Alias cómodos en español e inglés. */
export const APP_ALIASES = Object.freeze({
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
})

/** Alias que abren una consola y por tanto no aceptan argumentos. */
export const CONSOLE_ALIASES = new Set(['cmd', 'powershell', 'terminal'])

/** Nombres de consola aunque lleguen como comando suelto (ARIA_ALLOW_ANY=1). */
const CONSOLE_COMMANDS = new Set([
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'wt',
  'wt.exe',
])

/** Caracteres que romperían el parseo de `cmd /c start` (inyección de shell). */
const UNSAFE = /[&|<>^%\r\n"`]/

export function normalizeKey(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function hasUnsafeChars(value) {
  return typeof value === 'string' && UNSAFE.test(value)
}

/**
 * True si la ruta termina en una extensión ejecutable. Se normalizan puntos y
 * espacios finales para que `foo.exe.` o `foo.EXE ` no se cuelen.
 */
export function isExecutablePath(value) {
  const base = path.basename(String(value)).toLowerCase().replace(/[. ]+$/g, '')
  const ext = path.extname(base).slice(1).toLowerCase()
  return EXECUTABLE_EXTENSIONS.has(ext)
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidArgument(value, exists) {
  if (typeof value !== 'string' || !value || hasUnsafeChars(value)) return false
  if (isHttpUrl(value)) return true
  try {
    return exists(value) && !isExecutablePath(value)
  } catch {
    return false
  }
}

function denied(error, status = 403) {
  return { ok: false, status, error }
}

/**
 * Resuelve la app a un valor que el sistema operativo pueda abrir.
 *
 * Devuelve `{ ok: true, value, kind }` o `{ ok: false, status, error }`.
 * `options.existsSync` permite inyectar un comprobador falso en los tests.
 */
export function resolveTarget(app, options = {}) {
  if (typeof app !== 'string' || !app.trim()) {
    return denied('Falta el campo "app".', 400)
  }

  const cleaned = app.trim()
  const key = normalizeKey(cleaned)
  const exists = options.existsSync ?? nodeExistsSync
  const allowAny = options.allowAny === true

  if (hasUnsafeChars(cleaned)) {
    return denied('El nombre de la aplicación contiene caracteres no permitidos.')
  }

  // 1) Alias del mapa. hasOwnProperty evita que "constructor", "__proto__" o
  // "toString" se traten como alias heredados del prototipo.
  if (Object.prototype.hasOwnProperty.call(APP_ALIASES, key)) {
    return { ok: true, value: APP_ALIASES[key], kind: 'alias' }
  }

  // 2) Una URI con esquema. C:\ y C:/ son rutas de Windows, no esquemas.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (schemeMatch && !/^[a-z]:[\\/]/i.test(cleaned)) {
    const scheme = schemeMatch[1].toLowerCase()
    if (!ALLOWED_URI_SCHEMES.has(scheme)) {
      return denied(`El esquema "${scheme}:" no está permitido.`)
    }
    return { ok: true, value: cleaned, kind: 'uri' }
  }

  // 3) Ruta existente: solo si no es ejecutable. Nunca se abre un .exe/.bat/...
  // por ruta, ni siquiera con ARIA_ALLOW_ANY=1 (esa variable es para comandos
  // sueltos que resuelve el PATH, no para rutas ejecutables).
  try {
    if (exists(cleaned)) {
      if (isExecutablePath(cleaned)) {
        return denied('Por seguridad no se abren ejecutables por ruta.')
      }
      return { ok: true, value: cleaned, kind: 'path' }
    }
  } catch {
    /* si existsSync falla, se sigue con las demás reglas */
  }

  // 4) Un comando suelto solo si se permite explícitamente.
  if (allowAny) return { ok: true, value: cleaned, kind: 'command' }

  return denied(
    `No sé cómo abrir "${cleaned}". Usa una app del mapa, una ruta existente o una URI permitida, ` +
      'o arranca el agente con ARIA_ALLOW_ANY=1 para permitir comandos sueltos.',
  )
}

/**
 * Valida una petición completa de /open. Devuelve `{ ok: true, target, args,
 * kind }` o `{ ok: false, status, error }`.
 */
export function validateOpenRequest({ app, args } = {}, options = {}) {
  if (args !== undefined && typeof args !== 'string') {
    return denied('El campo "args" debe ser texto.', 400)
  }

  const resolved = resolveTarget(app, options)
  if (!resolved.ok) return resolved

  const key = normalizeKey(app)
  const exists = options.existsSync ?? nodeExistsSync
  const isConsoleAlias = CONSOLE_ALIASES.has(key)
  const isConsoleCommand =
    resolved.kind === 'command' && CONSOLE_COMMANDS.has(path.basename(resolved.value).toLowerCase())

  if (args !== undefined) {
    // b) Una ruta existente solo se abre sin argumentos.
    if (resolved.kind === 'path') {
      return denied('Una ruta existente solo se abre sin argumentos.')
    }

    // c) Las consolas solo se abren sin argumentos.
    if (isConsoleAlias || isConsoleCommand) {
      return denied('Las consolas solo se abren sin argumentos.')
    }

    // d) Los argumentos deben ser una URL http(s) o una ruta no ejecutable.
    if (!isValidArgument(args, exists)) {
      return denied(
        'Los argumentos deben ser una URL http(s) o una ruta existente no ejecutable, ' +
          'sin caracteres de inyección.',
      )
    }
  }

  return { ok: true, target: resolved.value, args, kind: resolved.kind }
}

/**
 * Compara el token en tiempo constante. Se hashean ambos lados para que la
 * comparación no dependa de la longitud ni del primer byte distinto.
 */
export function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Resuelve el token del agente con el mismo orden de siempre:
 *   1. ARIA_LOCAL_TOKEN.
 *   2. `.aria-local-token` si ya existe.
 *   3. Uno nuevo, generado y guardado con permisos 0600.
 *
 * Las funciones de fs y randomBytes se pueden inyectar en los tests. Si falla
 * la lectura/escritura, devuelve '' y el agente queda fail-closed.
 */
export function loadAgentToken(options = {}) {
  const fromEnv = typeof options.envToken === 'string' ? options.envToken.trim() : ''
  if (fromEnv) return fromEnv

  const tokenFile = options.tokenFile
  if (!tokenFile) return ''

  const exists = options.existsSync ?? nodeExistsSync
  const read = options.readFileSync ?? nodeReadFileSync
  const write = options.writeFileSync ?? nodeWriteFileSync
  const random = options.randomBytes ?? nodeRandomBytes
  const warn = options.warn ?? ((message) => console.error(message))

  try {
    if (exists(tokenFile)) {
      const saved = String(read(tokenFile, 'utf-8')).trim()
      if (saved) return saved
    }
    const generated = random(32).toString('hex')
    write(tokenFile, generated + '\n', { mode: 0o600 })
    return generated
  } catch (err) {
    warn('No pude leer/escribir el token local:', err)
    return ''
  }
}
