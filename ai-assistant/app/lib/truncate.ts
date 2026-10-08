/**
 * Ventanas de texto y stubs para los resultados de herramientas.
 *
 * Una herramienta puede devolver miles de caracteres (un archivo, un README,
 * una nota). Reenviar todo en cada ronda quema tokens del free tier y, además,
 * desplaza del contexto lo que importa. Aquí viven los recortes compartidos:
 * 100% local, sin red.
 */

/** Normaliza un offset venido del modelo (número, string o basura) a entero >= 0. */
export function normalizeOffset(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

export interface TextWindow {
  /** Offset realmente usado como inicio (normalizado). */
  offset: number
  /** Contenido recortado. */
  content: string
  /** true si quedó texto fuera de la ventana. */
  truncated: boolean
  /** Offset para pedir el siguiente trozo, o null si ya está completo. */
  nextOffset: number | null
}

/**
 * Devuelve una ventana de `max` caracteres a partir de `offset`.
 * Un offset más allá del final devuelve contenido vacío (sin marcar truncado).
 */
export function sliceWindow(text: string, offset: unknown, max: number): TextWindow {
  const total = text.length
  const start = Math.min(normalizeOffset(offset), total)
  const limit = Math.max(0, Math.floor(max) || 0)

  if (start >= total || limit === 0) {
    return { offset: start, content: '', truncated: false, nextOffset: null }
  }

  const end = start + limit
  const content = text.slice(start, end)
  const truncated = end < total
  return { offset: start, content, truncated, nextOffset: truncated ? end : null }
}

/**
 * Resumen de una línea para resultados de herramientas de rondas anteriores:
 * el modelo ya los vio para decidir la siguiente ronda, así que no hace falta
 * reenviarlos completos. Nunca contiene saltos de línea.
 */
export function oneLineStub(result: string): string {
  return `[resultado de una ronda anterior omitido (${result.length} chars); ya se usó para decidir]`
}
