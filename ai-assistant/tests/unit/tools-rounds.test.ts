import { afterEach, describe, expect, it, vi } from 'vitest'
import { callGroqWithTools } from '@/app/lib/tools'
import { STUB_MARKER } from '@/app/lib/truncate'

interface ReqMessage {
  role: string
  content: string
  tool_call_id?: string
}

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const toolCallTurn = (id: string, name: string, args = '{}') => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
      },
    },
  ],
})

const finalText = () =>
  new Response('data: {"choices":[{"delta":{"content":"fin"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
  })

afterEach(() => vi.unstubAllGlobals())

describe('callGroqWithTools', () => {
  it('conserva completas las últimas rondas y recorta (no borra) las viejas', async () => {
    const sent: Array<{ messages: ReqMessage[]; stream?: boolean }> = []
    const bigFile = 'C'.repeat(9000)
    const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        // Las herramientas github_* usan el mismo fetch global: se sirve un
        // archivo grande para forzar el recorte de la ronda antigua.
        if (url.includes('api.github.com')) {
          return json({ content: Buffer.from(bigFile).toString('base64'), encoding: 'base64', size: bigFile.length, type: 'file' })
        }
        const body = JSON.parse(String(init?.body)) as { messages: ReqMessage[]; stream?: boolean }
        sent.push(body)
        if (body.stream) return finalText()

        // 4 rondas distintas (paths distintos: no las bloquea la guarda anti-bucle).
        const toolMsgs = body.messages.filter((m) => m.role === 'tool').length
        if (toolMsgs < paths.length) {
          return json(toolCallTurn(`c${toolMsgs + 1}`, 'github_read_file', `{"repo":"o/r","path":"${paths[toolMsgs]}"}`))
        }
        return json({ choices: [{ message: { role: 'assistant', content: 'listo' } }] })
      }),
    )

    const { stream, toolCalls } = await callGroqWithTools(
      'test-key',
      [{ role: 'user', content: 'revisa mi código' }],
      'openai/gpt-oss-120b',
      256,
      0.6,
    )

    expect(stream).toBeTruthy()
    expect(toolCalls.map((t) => t.name)).toEqual([
      'github_read_file',
      'github_read_file',
      'github_read_file',
      'github_read_file',
    ])

    const finalReq = sent[sent.length - 1]
    expect(finalReq.stream).toBe(true)
    const toolMsgs = finalReq.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.length).toBe(4)
    // Ronda más vieja: recortada a su cabecera, marcada y CON contenido.
    expect(toolMsgs[0].content).toContain(STUB_MARKER)
    expect(toolMsgs[0].content).toContain('C'.repeat(100))
    // Las últimas dos rondas: completas (conservan todo el archivo).
    expect(toolMsgs[2].content).not.toContain(STUB_MARKER)
    expect(toolMsgs[3].content).not.toContain(STUB_MARKER)
    expect(toolMsgs[3].content).toContain(bigFile.slice(0, 100))
  })

  it('corta si una ronda repite llamadas ya hechas (guarda anti-bucle)', async () => {
    let groqCalls = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { messages: ReqMessage[]; stream?: boolean }
        groqCalls++
        if (body.stream) return finalText()
        // Siempre pide la misma herramienta con los mismos argumentos.
        return json(toolCallTurn('same', 'get_time', '{}'))
      }),
    )

    const { stream, toolCalls } = await callGroqWithTools(
      'test-key',
      [{ role: 'user', content: 'hola' }],
      'openai/gpt-oss-120b',
      256,
      0.6,
    )

    expect(stream).toBeTruthy()
    // Solo se ejecutó una vez: la segunda ronda idéntica se descarta.
    expect(toolCalls.map((t) => t.name)).toEqual(['get_time'])
    // 2 rondas (la 2.ª se descarta por repetida) + 1 stream final = 3 llamadas.
    expect(groqCalls).toBe(3)
  })
})
