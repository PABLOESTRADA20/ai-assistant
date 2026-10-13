/**
 * Helpers numéricos compartidos.
 *
 * Antes cada módulo reimplementaba el mismo recorte/redondeo con variantes
 * sutiles: una versión recortaba sin redondear (importancia/confianza, que se
 * guardan en BD con su precisión original) y otras recortaban Y redondeaban a
 * 3 decimales (scores normalizados, que se muestran y se comparan contra
 * umbrales). Acá queda una sola fuente de verdad para las dos formas.
 */

/** Recorta a [0,1] sin redondear. Para valores que se persisten tal cual. */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Redondea a 3 decimales; los valores no finitos se llevan a 0. */
export function round3(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1000) / 1000
}

/**
 * Recorta a [0,1] y redondea a 3 decimales: el score normalizado estándar
 * (similitud, fusión, importancia normalizada). Antes vivía duplicado como
 * `roundScore`/`clamp01` en memory.ts, brain.ts y embeddings.ts.
 */
export function round01(value: number): number {
  return round3(clamp01(value))
}