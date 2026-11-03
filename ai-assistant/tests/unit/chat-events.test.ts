import { describe, expect, it } from 'vitest'
import { contextEvent, modelSwitchEvent, sourcesEvent } from '@/app/lib/chat-events'

describe('modelSwitchEvent', () => {
  it('no emite nada si el modelo no cambió', () => {
    expect(
      modelSwitchEvent({
        from: 'openai/gpt-oss-20b',
        to: 'openai/gpt-oss-20b',
        reason: 'quota',
        until: '2026-11-03T00:00:00.000Z',
      }),
    ).toBeNull()
  })

  it('emite el bloque exacto con until una sola vez', () => {
    const until = '2026-11-03T00:00:00.000Z'
    const out = modelSwitchEvent({
      from: 'openai/gpt-oss-120b',
      to: 'workers-ai/deepseek',
      reason: 'quota',
      until,
    })

    expect(out).toBe(
      `data: ${JSON.stringify({
        type: 'model_switch',
        from: 'openai/gpt-oss-120b',
        to: 'workers-ai/deepseek',
        reason: 'quota',
        until,
      })}\n\n`,
    )
    expect(out!.match(/"until"/g)).toHaveLength(1)
  })

  it('omite until si no tiene valor', () => {
    const out = modelSwitchEvent({
      from: 'deepseek',
      to: 'openai/gpt-oss-20b',
      reason: 'no_tools',
      until: '',
    })

    expect(out).toBe(
      `data: ${JSON.stringify({
        type: 'model_switch',
        from: 'deepseek',
        to: 'openai/gpt-oss-20b',
        reason: 'no_tools',
      })}\n\n`,
    )
    expect(out).not.toContain('until')
  })
})

describe('contextEvent', () => {
  it('emite el bloque exacto', () => {
    expect(
      contextEvent({
        budget: 12_000,
        promptTokens: 345,
        summarizedCount: 7,
        hasSummary: true,
      }),
    ).toBe(
      `data: ${JSON.stringify({
        type: 'context',
        context: {
          budget: 12_000,
          promptTokens: 345,
          summarizedCount: 7,
          hasSummary: true,
        },
      })}\n\n`,
    )
  })
})

describe('sourcesEvent', () => {
  it('no emite nada si no hay fuentes', () => {
    expect(sourcesEvent([])).toBeNull()
    expect(sourcesEvent(null)).toBeNull()
    expect(sourcesEvent(undefined)).toBeNull()
  })

  it('emite el bloque exacto si hay fuentes', () => {
    const sources = [
      {
        kind: 'memory' as const,
        id: 'mem-1',
        title: 'Memoria · info/general',
        snippet: 'algo',
        score: 0.9,
        source: 'memory',
      },
    ]
    expect(sourcesEvent(sources)).toBe(
      `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`,
    )
  })
})
