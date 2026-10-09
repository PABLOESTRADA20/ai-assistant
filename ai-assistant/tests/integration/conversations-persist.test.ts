import { afterAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { hydrateMessages, persistMessages } from '@/app/lib/persist-messages'
import { GET as getOne, PUT } from '@/app/api/conversations/[id]/route'
import { GET as getList } from '@/app/api/conversations/route'

/**
 * Integración de la persistencia de fuentes/contexto/tools (FASE 3.4/durabilidad).
 *
 * Reglas del harness: sin TEST_DATABASE_URL los tests se omiten. En CI no hay
 * ARIA_ACCESS_TOKEN (app abierta) y las rutas pasan sin auth; en local, si
 * .env.local define el token, se manda como lo haría el cliente.
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)
const marker = `vitestpersist${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const auth: Record<string, string> = process.env.ARIA_ACCESS_TOKEN
  ? { Authorization: `Bearer ${process.env.ARIA_ACCESS_TOKEN}` }
  : {}

describe.skipIf(!RUN)('persistencia de fuentes y contexto (integración)', () => {
  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { title: { contains: marker } } })
  })

  it('persistMessages guarda sources/context/tools y hydrateMessages los devuelve', async () => {
    const conv = await prisma.conversation.create({ data: { title: marker, model: 'test/model' } })
    const sources = [{ kind: 'memory', id: 'm1', score: 0.9 }]
    const context = { budget: 4000, promptTokens: 120, summarizedCount: 0, hasSummary: false }

    await persistMessages(conv.id, [
      { id: `${marker}a1`, role: 'user', content: 'hola' },
      {
        id: `${marker}a2`,
        role: 'assistant',
        content: 'respuesta',
        tools: [{ name: 'web_search', args: {}, result: 'x' }],
        sources,
        context,
      },
    ])

    const rows = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } })
    expect(rows).toHaveLength(2)

    // tools es columna conocida por el cliente Prisma: se lee normal.
    expect((rows[1].tools as { name: string }[])[0].name).toBe('web_search')

    // sources/context no los conoce el cliente commiteado: se leen hidratando.
    const hydrated = (await hydrateMessages(rows)) as Array<
      { sources?: unknown; context?: unknown } & (typeof rows)[number]
    >
    expect(hydrated[1].sources).toEqual(sources)
    expect(hydrated[1].context).toEqual(context)
    // Un mensaje sin extras no se modifica.
    expect(hydrated[0].sources).toBeUndefined()
  })

  it('PUT persiste y devuelve la conversación con sources/context hidratados', async () => {
    const conv = await prisma.conversation.create({ data: { title: marker, model: 'test/model' } })
    const sources = [{ kind: 'note', id: 'n1', score: 0.7, title: 'nota' }]
    const context = { budget: 8000, promptTokens: 90, summarizedCount: 2, hasSummary: true }

    const req = new NextRequest(`http://x/api/conversations/${conv.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        title: marker,
        model: 'test/model',
        messages: [
          { id: `${marker}b1`, role: 'user', content: 'pregunta', createdAt: new Date().toISOString() },
          {
            id: `${marker}b2`,
            role: 'assistant',
            content: 'respuesta con fuentes',
            createdAt: new Date().toISOString(),
            sources,
            context,
          },
        ],
      }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: conv.id }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    const assistant = body.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.sources).toEqual(sources)
    expect(assistant.context).toEqual(context)
  })

  it('GET [id] y GET lista devuelven sources/context al recargar', async () => {
    const conv = await prisma.conversation.create({ data: { title: marker, model: 'test/model' } })
    const context = { budget: 4000, promptTokens: 50, summarizedCount: 0, hasSummary: false }

    await persistMessages(conv.id, [
      { id: `${marker}c1`, role: 'user', content: 'x' },
      { id: `${marker}c2`, role: 'assistant', content: 'y', context },
    ])

    const one = await getOne(new NextRequest(`http://x/api/conversations/${conv.id}`, { headers: auth }), {
      params: Promise.resolve({ id: conv.id }),
    })
    expect(one.status).toBe(200)
    const oneBody = await one.json()
    expect(oneBody.messages[1].context).toEqual(context)

    const all = await getList(new NextRequest('http://x/api/conversations', { headers: auth }))
    expect(all.status).toBe(200)
    const allBody = await all.json()
    const found = allBody.find((c: { id: string }) => c.id === conv.id)
    expect(found.messages[1].context).toEqual(context)
  })
})