import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/prisma', () => ({
  prisma: { sessionContext: { create } },
}))

import { claimWhatsAppMessage } from '@/app/lib/whatsapp-dedupe'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

beforeEach(() => {
  create.mockReset()
})

describe('claimWhatsAppMessage', () => {
  it('crea una clave única con TTL de 7 días', async () => {
    create.mockResolvedValue({})
    const before = Date.now()

    expect(await claimWhatsAppMessage('wamid.1')).toBe(true)

    expect(create).toHaveBeenCalledTimes(1)
    const data = create.mock.calls[0][0].data as {
      key: string
      value: { messageId: string; claimedAt: string }
      expiresAt: Date
    }
    expect(data.key).toBe('whatsapp:msg:wamid.1')
    expect(data.value.messageId).toBe('wamid.1')
    expect(data.value.claimedAt).toBeTruthy()
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS)
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS + 1000)
  })

  it('devuelve false si la clave ya existe (P2002)', async () => {
    create.mockRejectedValue(Object.assign(new Error('duplicado'), { code: 'P2002' }))
    expect(await claimWhatsAppMessage('wamid.1')).toBe(false)
  })

  it('devuelve false si el error menciona unique constraint', async () => {
    create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`key`)'))
    expect(await claimWhatsAppMessage('wamid.1')).toBe(false)
  })

  it('devuelve true ante un error distinto: mejor duplicar que perder', async () => {
    create.mockRejectedValue(new Error('conexión caída'))
    expect(await claimWhatsAppMessage('wamid.1')).toBe(true)
  })

  it('no consulta la base si no hay messageId', async () => {
    expect(await claimWhatsAppMessage('')).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
})
