/**
 * Formateo compartido de números y fechas para la UI.
 *
 * `formatCompactNumber` une los dos formateadores compactos que existían
 * (`formatCompactNumber` en quota-info y `formatCompactTokens` en context-info)
 * con la misma salida y la misma tolerancia a valores no finitos.
 */

/** 6100 → "6.1k", 999 → "999", 12000 → "12k", 1.234 → "1.2k". */
export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1000) {
    const k = n / 1000
    const rounded = k < 100 ? (Math.round(k * 10) / 10).toString() : String(Math.round(k))
    return `${rounded.replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

/** Fecha corta en español: "12 oct 2026". */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}