import { afterAll, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/quota/route'
import { deleteContext, setContext } from '@/app/lib/memory'
import { FALLBACK_BUDGET_KEY, FALLBACK_NEURON_BUDGET, utcDayKey } from '@/app/lib/quota'

/**
 * Integración del endpoint de saldo de cuota (FASE 3.3).
 *
 * Reglas del harness (igual que memory.test.ts): sin TEST_DATABASE_URL los
 * tests se omiten; la key `quota:fallback` es exclusiva de este archivo, así
 * que no pisa ni compite con los otros workers paralelos.
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)

describe.skipIf(!RUN)('endpoint /api/quota (integración)', () => {
  afterAll(async () => {
    await deleteContext(FALLBACK_BUDGET_KEY)
  })

  it('devuelve el saldo de neuronas del día calculado desde SessionContext', async () => {
    await setContext(FALLBACK_BUDGET_KEY, { day: utcDayKey(), neurons: 3000 }, 60)

    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.neurons.used).toBe(3000)
    expect(body.neurons.budget).toBe(FALLBACK_NEURON_BUDGET)
    expect(body.neurons.remaining).toBe(FALLBACK_NEURON_BUDGET - 3000)
  })

  it('nunca devuelve neuronas negativas', async () => {
    // Gasto mayor al tope (p.ej. residuos de un día pasado): el saldo se clampa a 0.
    await setContext(FALLBACK_BUDGET_KEY, { day: utcDayKey(), neurons: FALLBACK_NEURON_BUDGET + 500 }, 60)

    const res = await GET()
    const body = await res.json()
    expect(body.neurons.remaining).toBe(0)
  })

  it('incluye el resumen de Groq con la forma esperada', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body.groq.total).toBeGreaterThanOrEqual(1)
    expect(typeof body.groq.available).toBe('number')
    expect(Array.isArray(body.groq.exhausted)).toBe(true)
    expect('until' in body.groq).toBe(true)
  })
})