// app/lib/error-message.ts
/** Prefijo con el que ARIA marca sus mensajes de error (role assistant). */
export const ERROR_MESSAGE_PREFIX = '⚠️ **Error**:'

/** True si el contenido es un mensaje de error de ARIA (permite ofrecer "Reintentar"). */
export function isErrorContent(content: string): boolean {
  return content.startsWith(ERROR_MESSAGE_PREFIX)
}