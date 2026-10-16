/**
 * Anonimización de texto para el conjunto de datos de entrenamiento (FASE 6).
 *
 * Regla del ROADMAP: el dataset NUNCA debe salir con secretos ni datos
 * personales. Esta función reemplaza por etiquetas (`<email>`, `<clave>`, …) lo
 * que se detecta y devuelve cuántas cosas borró, para poder auditar el
 * resultado antes de usar el archivo.
 *
 * Es a propósito CONSERVADORA: prefiere borrar de más antes que dejar pasar un
 * secreto. Aun así, no es infalible: el archivo final sigue siendo dato local y
 * nunca se sube a un repositorio público.
 */

/** Categorías de lo que se puede borrar. Sirve para el informe de conteos. */
export type ScrubKind =
  | 'url-credentials'
  | 'api-key'
  | 'jwt'
  | 'bearer'
  | 'email'
  | 'ip'
  | 'user-path'
  | 'phone'
  | 'dni'
  | 'card'
  | 'long-hash'

export type ScrubResult = {
  /** Texto ya limpio. */
  text: string
  /** Total de reemplazos hechos. */
  redactions: number
  /** Desglose por categoría (solo las que aparecieron). */
  byKind: Partial<Record<ScrubKind, number>>
}

type Rule = {
  kind: ScrubKind
  re: RegExp
  /** Reemplazo; admite `$1`… como en `String.replace`. */
  replace: string
}

/**
 * Orden importante: primero lo compuesto (URLs con clave) y después lo simple,
 * para que las etiquetas no se vuelvan a tocar.
 */
const RULES: Rule[] = [
  // postgres://usuario:clave@host -> deja el motor y tapa usuario/clave.
  {
    kind: 'url-credentials',
    re: /((?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/)[^:@/\s]+:[^@/\s]+@/gi,
    replace: '$1<usuario>:<clave>@',
  },
  // Claves con prefijo conocido (Groq, OpenAI, GitHub, Neon, AWS, Google, Slack).
  {
    kind: 'api-key',
    re: /\b(?:gsk_|sk-|gh[pousr]_|github_pat_|npg_|xox[baprs]-)[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}/g,
    replace: '<clave>',
  },
  // JWT (tres bloques base64url separados por punto).
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replace: '<token>',
  },
  // Cabecera Authorization: Bearer <token>.
  {
    kind: 'bearer',
    re: /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
    replace: 'Bearer <token>',
  },
  // Correos.
  {
    kind: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replace: '<email>',
  },
  // Direcciones IP.
  {
    kind: 'ip',
    re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    replace: '<ip>',
  },
  // Rutas con el nombre de usuario dentro.
  {
    kind: 'user-path',
    re: /([A-Za-z]:\\Users\\)([^\\/\s"']+)/gi,
    replace: '$1<usuario>',
  },
  {
    kind: 'user-path',
    re: /(\/(?:Users|home)\/)([^/\s"']+)/g,
    replace: '$1<usuario>',
  },
  // Teléfonos: solo formatos claros (con + o con paréntesis), para no romper
  // números sueltos del código.
  {
    kind: 'phone',
    re: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}/g,
    replace: '<telefono>',
  },
  {
    kind: 'phone',
    re: /\(\d{2,4}\)\s?\d{3,4}[\s.-]?\d{3,4}/g,
    replace: '<telefono>',
  },
  // Documento de identidad español (DNI / NIE).
  {
    kind: 'dni',
    re: /\b(?:\d{7,8}[A-Z]|[XYZ]\d{7}[A-Z])\b/g,
    replace: '<dni>',
  },
  // Tarjeta de crédito (16 dígitos en grupos de 4).
  {
    kind: 'card',
    re: /\b(?:\d{4}[\s-]){3}\d{4}\b/g,
    replace: '<tarjeta>',
  },
  // Hashes largos (git sha, md5/sha, tokens en hexadecimal).
  {
    kind: 'long-hash',
    re: /\b[a-f0-9]{32,}\b/gi,
    replace: '<hash>',
  },
]

/**
 * Limpia un texto y devuelve cuántas cosas borró.
 *
 * @example
 * scrubText('mi correo es ana@ejemplo.com').text // 'mi correo es <email>'
 */
export function scrubText(input: string): ScrubResult {
  let text = input
  let redactions = 0
  const byKind: Partial<Record<ScrubKind, number>> = {}

  for (const rule of RULES) {
    const matches = text.match(rule.re)
    if (!matches) continue
    redactions += matches.length
    byKind[rule.kind] = (byKind[rule.kind] ?? 0) + matches.length
    text = text.replace(rule.re, rule.replace)
  }

  return { text, redactions, byKind }
}
