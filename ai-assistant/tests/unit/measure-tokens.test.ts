import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTokenReport, formatReport } from '@/scripts/measure-tokens'

/**
 * El script de medición es la herramienta de "cero costo": estima tokens en
 * local (chars/3.5) para revisar el ahorro de la FASE 1 sin gastar ni un token
 * real. Estos tests garantizan que nunca llama a la API y que el contexto
 * compactado baja del historial completo y del presupuesto del modelo barato.
 */
describe('scripts/measure-tokens', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('no llama a ninguna API (sin fetch)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    buildTokenReport()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('el contexto compactado baja del historial completo', () => {
    const report = buildTokenReport()
    expect(report.contextTotal).toBeLessThan(report.fullHistoryTotal)
    expect(report.saved).toBeGreaterThan(0)
    expect(report.savedPercent).toBeGreaterThan(0)
    expect(report.contextTotal).toBe(report.system + report.memory + report.summary + report.visibleWindow)
  })

  it('el contexto final cabe en el presupuesto del modelo barato', () => {
    const report = buildTokenReport()
    expect(report.budget).toBeGreaterThan(0)
    expect(report.contextTotal).toBeLessThanOrEqual(report.budget)
    expect(report.withinBudget).toBe(true)
  })

  it('desglosa system, memoria y ventana, y formatea en texto', () => {
    const report = buildTokenReport()
    expect(report.system).toBeGreaterThan(0)
    expect(report.visibleWindow).toBeGreaterThan(0)
    expect(report.rows.length).toBeGreaterThan(0)
    const text = formatReport(report)
    expect(text).toContain('Ahorro')
    expect(text).toContain('presupuesto')
  })
})
