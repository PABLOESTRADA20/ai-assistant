import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRetrievalEvalReport,
  formatRetrievalReport,
  mrr,
  recallAtK,
  type RankedHit,
} from '@/scripts/retrieval-eval'

/**
 * La evaluación de recuperación es la herramienta de "cero costo" de la FASE 2:
 * mide Recall@k y MRR de la pipeline de scoring real (funciones puras de
 * brain.ts) sobre fixtures sintéticos, sin red, API ni BD. Estos tests
 * garantizan las métricas y que el reporte pinte la mejora de `normalizeLexical`
 * (2.1) sin llamar a ningún modelo.
 */
describe('scripts/retrieval-eval', () => {
  afterEach(() => vi.unstubAllGlobals())

  const ranked: RankedHit[] = [
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.7 },
    { id: 'c', score: 0.5 },
    { id: 'd', score: 0.3 },
  ]

  it('no llama a ninguna API (sin fetch)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    buildRetrievalEvalReport()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recallAtK: fracción de relevantes presentes en el top-k', () => {
    expect(recallAtK(ranked, ['a'], 3)).toBe(1)
    expect(recallAtK(ranked, ['a', 'z'], 3)).toBe(0.5)
    expect(recallAtK(ranked, ['z'], 3)).toBe(0)
    expect(recallAtK(ranked, ['a'], 10)).toBe(1)
    expect(recallAtK(ranked, ['a'], 0)).toBe(0)
    expect(recallAtK([], ['a'], 3)).toBe(0)
    expect(recallAtK(ranked, [], 3)).toBe(0)
  })

  it('mrr: recíproco de la primera posición relevante', () => {
    expect(mrr(ranked, ['a'])).toBe(1)
    expect(mrr(ranked, ['b'])).toBe(0.5)
    expect(mrr(ranked, ['c'])).toBe(1 / 3)
    expect(mrr(ranked, ['z'])).toBe(0)
    expect(mrr(ranked, [])).toBe(0)
  })

  it('el reporte demuestra la mejora de normalizeLexical (antes vs después)', () => {
    const report = buildRetrievalEvalReport()
    expect(report.cases.length).toBeGreaterThan(1)
    expect(report.before.recallAt3).toBeLessThan(report.after.recallAt3)
    expect(report.before.mrr).toBeLessThan(report.after.mrr)
    expect(report.improved).toBe(true)
    for (const c of report.cases) {
      expect(c.after.mrr).toBeGreaterThan(c.before.mrr)
    }
  })

  it('formatea el reporte legible', () => {
    const text = formatRetrievalReport(buildRetrievalEvalReport())
    expect(text).toContain('antes')
    expect(text).toContain('después')
    expect(text).toContain('R@3')
    expect(text).toContain('MRR')
  })
})