/**
 * Codificación/decodificación base64 compartida.
 *
 * Antes vivía un espejo en github.ts (`decodeBase64`) y otro en
 * transcribe/route.ts (`toBase64`). En Cloudflare Workers no hay `Buffer`,
 * así que ambas usan la API web (`atob`/`btoa`); el guard de `Buffer` queda
 * solo para correr en Node (tests y herramientas locales).
 */

/** base64 → texto (UTF-8). Ignora espacios y saltos de línea. */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** ArrayBuffer → base64. */
export function encodeBase64(buf: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64')
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}