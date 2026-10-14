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

/** Cabecera que se conserva de un resultado de ronda anterior al recortarlo. */
export const STUB_HEAD_CHARS = 2000

/** Marca que se añade al recortar; permite detectarlo en los tests y en logs. */
export const STUB_MARKER = '[ronda anterior recortada]'

/**
 * Recorta un resultado de herramienta de una ronda anterior conservando su
 * CABECERA.
 *
 * Antes se reemplazaba por una sola línea ("resultado omitido"), con lo que la
 * respuesta final perdía lo leído (README, árbol de archivos, código de los
 * archivos previos) y "revisaba" sin el código delante. Conservar la cabecera
 * mantiene las rutas, la estructura y el principio de cada archivo, y aun así
 * acota los tokens que se reenvían en cada vuelta. Los resultados cortos se
 * devuelven intactos.
 */
export function stubToolResult(result: string, max = STUB_HEAD_CHARS): string {
  if (result.length <= max) return result
  return `${result.slice(0, max)}\n${STUB_MARKER} (+${result.length - max} chars; vuelve a leer con offset si necesitas el resto)`
}
