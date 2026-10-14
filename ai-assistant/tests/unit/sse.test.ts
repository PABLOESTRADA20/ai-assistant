import { describe, expect, it } from 'vitest'
import { openAiDelta, readSseLines, sseData } from '@/app/lib/sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const lines: string[] = []
  await readSseLines(stream, (l) => lines.push(l))
  return lines
}

describe('sse — lectura de streams', () => {
  it('parte por líneas aunque los chunks corten a mitad', async () => {
    const lines = await collect(streamOf('data: {"a"', ':1}\n\ndata: [DO', 'NE]\n\n'))
    expect(lines).toEqual(['data: {"a":1}', '', 'data: [DONE]', ''])
  })

  it('procesa la última línea sin \\n final', async () => {
    const lines = await collect(streamOf('data: [DONE]'))
    expect(lines).toEqual(['data: [DONE]'])
  })

  it('sseData extrae el payload y descarta lo que no es data', () => {
    expect(sseData('data: {"x":1}')).toBe('{"x":1}')
    expect(sseData('event: ping')).toBeNull()
    expect(sseData('')).toBeNull()
  })

  it('openAiDelta extrae content/reasoning/finish_reason', () => {
    expect(openAiDelta('data: {"choices":[{"delta":{"content":"hola"}}]}')).toEqual({
      content: 'hola',
      reasoning: '',
      finishReason: null,
    })
    expect(
      openAiDelta('data: {"choices":[{"delta":{"reasoning":"pi"},"finish_reason":"stop"}]}'),
    ).toEqual({ content: '', reasoning: 'pi', finishReason: 'stop' })
    expect(openAiDelta('data: [DONE]')).toBeNull()
    expect(openAiDelta('data: {roto')).toBeNull()
    expect(openAiDelta('event: x')).toBeNull()
  })
})
