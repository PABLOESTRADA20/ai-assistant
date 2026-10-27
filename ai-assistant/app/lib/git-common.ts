/**
 * Piezas neutras compartidas por las plataformas de código (FASE 7 — Parte B).
 *
 * Acá vive lo que NO depende de GitHub ni de GitLab: validar nombres de rama,
 * limpiar rutas de archivo, generar un slug de rama, codificar en base64 y
 * aplicar parches {search, replace} sobre un texto. Antes estaban dentro de
 * `github.ts`; se extrajeron para que GitLab reutilice EXACTAMENTE las mismas
 * protecciones (una sola fuente de verdad, sin riesgo de que se separen).
 *
 * Es un módulo puramente funcional: sin red, sin base de datos, sin Prisma.
 */

/** Tope de tamaño de un bloque `search` de un parche. */
export const PATCH_SEARCH_MAX_CHARS = 20_000
/** Líneas netas eliminadas toleradas por archivo (eliminadas − añadidas). */
export const PATCH_MAX_REMOVED_LINES = 120

/**
 * Nombre de rama válido según una versión corta de `git check-ref-format`.
 *
 * Deliberadamente conservador: se rechaza cualquier cosa rara (espacios,
 * controles, `~ ^ : ? * [ \`, `..`, `@{`, barras dobles o en los extremos,
 * terminar en `.lock`, empezar con `.` o `-`, o superar 200 caracteres). No
 * hacerlo bien permite inyección de referencias en la API del proveedor.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (/[\s\u0000-\u001f\u007f]/.test(name)) return false
  if (/[~^:?*[\]\\]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  if (name.startsWith('/') || name.endsWith('/')) return false
  if (name.startsWith('-') || name.startsWith('.')) return false
  if (name.endsWith('.') || name.endsWith('.lock')) return false
  if (name === '@') return false
  return true
}

/**
 * Valida la rama sobre la que se puede escribir.
 *
 * Nunca se escribe directamente en la rama por defecto (`base`), así que un
 * nombre libre no puede saltarse la revisión por PR/MR.
 */
export function validateBranch(
  name: string,
  base: string,
): { ok: true; branch: string } | { ok: false; error: string } {
  const branch = name.trim()
  if (!branch) return { ok: false, error: 'La rama no puede estar vacía.' }
  if (branch === base) {
    return {
      ok: false,
      error:
        `No escribo directamente en la rama principal ("${base}"). ` +
        'Usá una rama nueva y dejá que el cambio pase por el pull request.',
    }
  }
  if (!isValidBranchName(branch)) {
    return {
      ok: false,
      error:
        `Nombre de rama inválido: "${name}". Evitá espacios, ".." y los caracteres ` +
        '~ ^ : ? * [ \\ , y no empieces con "." ni con "-".',
    }
  }
  return { ok: true, branch }
}

/**
 * Normaliza la ruta de un archivo del repositorio. Devuelve null si es
 * inaceptable: rutas relativas (`..`), nulas, o workflows de GitHub (pueden
 * ejecutar código con secretos y exigen permisos extra).
 */
export function cleanRepoPath(path: string): string | null {
  const clean = path.trim().replace(/^\/+/, '').replace(/\\/g, '/')
  if (!clean || clean.includes('\0') || clean.split('/').some((part) => part === '..')) return null
  if (clean.toLowerCase().startsWith('.github/workflows/')) return null
  return clean
}

/** Convierte un texto libre en un slug corto para usar en una rama. */
export function branchSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\.{2,}|\/{2,}/g, '-')
    .replace(/^[./-]+|[./-]+$/g, '')
    .slice(0, 60)
}

/** Codifica un texto UTF-8 en base64 (compatible con workerd). */
export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Número de líneas de un fragmento ('' = 0). */
export function countLines(value: string): number {
  return value === '' ? 0 : value.split('\n').length
}

/**
 * Aplica una lista de {search, replace} sobre el TEXTO de un archivo.
 *
 * Reglas de seguridad (fallan con mensaje claro, sin tocar nada):
 * - `search` no puede ser vacío.
 * - `search` debe aparecer EXACTAMENTE una vez (0 = no está; >1 = ambiguo).
 * - El bloque `search` no puede superar `PATCH_SEARCH_MAX_CHARS`.
 * - No puede eliminarse más de `PATCH_MAX_REMOVED_LINES` líneas netas.
 * - No puede dejar el archivo vacío si antes tenía contenido.
 *
 * Tolerancia a saltos de línea: compara sobre texto normalizado a `\n` y, al
 * terminar, restaura los `\r\n` originales del archivo. Así el modelo puede
 * copiar el bloque con `\n` aunque el archivo use CRLF, sin corromperlo.
 */
export function applyTextPatches(
  text: string,
  ops: { search: string; replace: string }[],
): { ok: true; content: string } | { ok: false; error: string } {
  const usesCrlf = text.includes('\r\n')
  let work = text.replace(/\r\n/g, '\n')
  let removed = 0
  let added = 0

  for (const op of ops) {
    if (!op.search) {
      return { ok: false, error: 'Cada parche necesita un bloque "search" no vacío.' }
    }
    const search = op.search.replace(/\r\n/g, '\n')
    const replace = op.replace.replace(/\r\n/g, '\n')

    if (search.length > PATCH_SEARCH_MAX_CHARS) {
      return {
        ok: false,
        error: `El bloque "search" es demasiado grande (máximo ${PATCH_SEARCH_MAX_CHARS} caracteres).`,
      }
    }

    const first = work.indexOf(search)
    if (first === -1) {
      return {
        ok: false,
        error:
          'El bloque "search" no aparece en el archivo. Copialo exactamente como lo ' +
          'devolvió la lectura del archivo (con su indentación) o volvé a leerlo: pudo cambiar.',
      }
    }
    if (work.indexOf(search, first + 1) !== -1) {
      return {
        ok: false,
        error:
          'El bloque "search" aparece más de una vez. Incluí más contexto ' +
          '(líneas vecinas) para que sea único.',
      }
    }

    const before = countLines(search)
    const after = countLines(replace)
    removed += Math.max(0, before - after)
    added += Math.max(0, after - before)

    work = work.slice(0, first) + replace + work.slice(first + search.length)
  }

  const net = removed - added
  if (net > PATCH_MAX_REMOVED_LINES) {
    return {
      ok: false,
      error:
        `El parche elimina demasiadas líneas (${net} netas, máximo ` +
        `${PATCH_MAX_REMOVED_LINES}). Si es intencional, reescribí el archivo ` +
        'completo con la herramienta de crear pull request.',
    }
  }
  if (work.length === 0 && text.length > 0) {
    return { ok: false, error: 'El parche dejaría el archivo vacío. Rechazado por seguridad.' }
  }

  return { ok: true, content: usesCrlf ? work.replace(/\n/g, '\r\n') : work }
}
