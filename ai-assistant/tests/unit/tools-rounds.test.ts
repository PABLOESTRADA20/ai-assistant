import { afterEach, describe, expect, it, vi } from 'vitest'
import { callGroqWithTools } from '@/app/lib/tools'

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

afterEach(() => vi.unstubAllGlobals())

describe('callGroqWithTools', () => {
  it('solo la última ronda de herramientas viaja completa al stream final', async () => {
    const sent: Array<{ messages: ReqMessage[]; stream?: boolean }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: ReqMessage[]
          stream?: boolean
        }
        sent.push(body)

        const toolMsgs = body.messages.filter((m) => m.role === 'tool').length
        // Turno 1: pide get_time. Turno 2: pide calculate. Después: responde.
        if (toolMsgs === 0) return json(toolCallTurn('c1', 'get_time'))
        if (toolMsgs === 1) return json(toolCallTurn('c2', 'calculate', '{"expression":"1+1"}'))
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"fin"}}]}\n\ndata: [DONE]\n\n',
            { status: 200 },
          )
        }
        return json({ choices: [{ message: { role: 'assistant', content: 'listo' } }] })
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
    expect(toolCalls.map((t) => t.name)).toEqual(['get_time', 'calculate'])

    const finalReq = sent[sent.length - 1]
    expect(finalReq.stream).toBe(true)

    const toolMsgs = finalReq.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.length).toBe(2)
    // La ronda anterior se stubbea; la última conserva el resultado completo.
    expect(toolMsgs[0].content).toContain('omitido')
    expect(toolMsgs[1].content).not.toContain('omitido')
  })
})
