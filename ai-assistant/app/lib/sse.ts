/**
 * Lectura de streams SSE (Server-Sent Events).
 *
 * El bucle exacto de lectura — `getReader()` + `TextDecoder` + `split('\n')`
 * con buffer — vivía duplicado en 6 sitios: aria-reply.ts, chat-client.ts,
 * workers-ai.ts y las 3 variantes de drenado en api/chat/route.ts. Acá queda
 * una sola implementación del bucle; cada sitio conserva su handler de líneas.
 */

/** Lee un stream en líneas (sin el `\n` final) y las pasa a `onLine`. */
export async function readSseLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) onLine(line)
  }
  // Línea final sin `\n` (stream cortado a mitad): se procesa igual.
  if (buffer) onLine(buffer)
}

/** `"data: X"` → `"X"`, o `null` si la línea no es un evento data. */
export function sseData(line: string): string | null {
  if (!line.startsWith('data: ')) return null
  return line.slice(6)
}

export interface OpenAiDelta {
  content: string
  reasoning: string
  finishReason: string | null
}

/**
 * Extrae el delta de una línea `data:` en el formato OpenAI de streaming:
 * `choices[0].delta.content` / `.reasoning` y `choices[0].finish_reason`.
 * Líneas no-data, `[DONE]` o JSON inválido → `null`.
 */
export function openAiDelta(line: string): OpenAiDelta | null {
  const data = sseData(line)
  if (!data || data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data)
    const choice = parsed.choices?.[0]
    const delta = choice?.delta ?? {}
    return {
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoning: typeof delta.reasoning === 'string' ? delta.reasoning : '',
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    }
  } catch {
    return null
  }
}