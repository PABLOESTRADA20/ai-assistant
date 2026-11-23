import { describe, expect, it, vi } from 'vitest'
import {
  completeWithGroq,
  DEFAULT_PILOT_MAX_TOKENS,
  DEFAULT_PILOT_MODEL,
  DEFAULT_PILOT_RETRIES,
  parsePilotArgs,
  pilotTaskLabel,
  retryDelayMs,
} from '@/app/lib/pilot-llm'

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

describe('parsePilotArgs', () => {
  it('por defecto no habilita el modo real', () => {
    expect(parsePilotArgs([])).toEqual({
      live: false,
      model: DEFAULT_PILOT_MODEL,
      verdict: 'needs-review',
      score: null,
      maxTokens: DEFAULT_PILOT_MAX_TOKENS,
      retries: DEFAULT_PILOT_RETRIES,
      ref: null,
    })
  })

  it('lee --live, modelo, veredicto y score', () => {
    expect(
      parsePilotArgs([
        '--live',
        '--model=openai/gpt-oss-120b',
        '--verdict=ci-passed',
        '--score=4',
        '--max-tokens=600',
        '--retries=1',
        '--ref=3530f64',
      ]),
    ).toEqual({
      live: true,
      model: 'openai/gpt-oss-120b',
      verdict: 'ci-passed',
      score: 4,
      maxTokens: 600,
      retries: 1,
      ref: '3530f64',
    })
  })

  it('rechaza un veredicto inventado', () => {
    expect(() => parsePilotArgs(['--verdict=bueno'])).toThrow(/Veredicto inválido/)
  })

  it('un score no numérico queda como null', () => {
    expect(parsePilotArgs(['--score=abc']).score).toBeNull()
  })
})

describe('completeWithGroq', () => {
  it('envía el prompt al endpoint y devuelve el contenido', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({ choices: [{ message: { content: 'respuesta del modelo' } }] }),
    ) as unknown as typeof fetch

    const out = await completeWithGroq('prompt de prueba', {
      apiKey: 'gsk_clave_de_prueba',
      model: 'modelo-de-prueba',
      fetchImpl,
    })

    expect(out).toBe('respuesta del modelo')
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('api.groq.com')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer gsk_clave_de_prueba',
    )
    const body = JSON.parse(init.body as string) as {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('modelo-de-prueba')
    expect(body.max_tokens).toBe(DEFAULT_PILOT_MAX_TOKENS)
    expect(body.messages[0]).toEqual({ role: 'user', content: 'prompt de prueba' })
  })

  it('propaga el error HTTP sin filtrar la clave', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ error: 'rate limit' }, 429)) as
      unknown as typeof fetch

    await expect(
      completeWithGroq('prompt', { apiKey: 'gsk_secreto', fetchImpl }),
    ).rejects.toThrow(/Groq respondió 429/)
  })

  it('reintenta un 429 y usa el tiempo que pide Groq', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ error: 'Please try again in 0.01s' }, 429))
      .mockResolvedValueOnce(
        fakeResponse({ choices: [{ message: { content: 'ok tras reintentar' } }] }),
      ) as unknown as typeof fetch
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const out = await completeWithGroq('prompt', {
      apiKey: 'x',
      retries: 2,
      fetchImpl,
      sleepImpl,
    })

    expect(out).toBe('ok tras reintentar')
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledWith(500)
  })

  it('rechaza respuestas vacías', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ choices: [] })) as unknown as typeof fetch
    await expect(completeWithGroq('prompt', { apiKey: 'x', fetchImpl })).rejects.toThrow(
      /sin contenido/,
    )
  })

  it('sin clave no llega a llamar a fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(completeWithGroq('prompt', { apiKey: '  ', fetchImpl })).rejects.toThrow(
      /Falta GROQ_API_KEY/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('retryDelayMs', () => {
  it('respeta el tiempo de Groq y lo acota', () => {
    expect(retryDelayMs('Please try again in 22.62s')).toBe(22_620)
    expect(retryDelayMs('Please try again in 0.01s')).toBe(500)
    expect(retryDelayMs('sin pista')).toBe(1_000)
    expect(retryDelayMs('Please try again in 999s')).toBe(30_000)
  })
})

describe('pilotTaskLabel', () => {
  it('etiqueta las dos tareas', () => {
    expect(pilotTaskLabel('test-generation')).toBe('generador de tests')
    expect(pilotTaskLabel('pr-summary')).toBe('resumidor de PR')
  })
})
