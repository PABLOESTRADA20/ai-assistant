import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/app/lib/prisma'
import {
  MAX_CHANGES_PER_MINUTE,
  countRecentChanges,
  getChange,
  latestChange,
  markReverted,
  recordChange,
} from '@/app/lib/changelog'

/**
 * Integración del SQL crudo de `changelog.ts` contra Postgres.
 *
 * Reglas del harness (igual que en los otros tests de integración):
 *  - sin TEST_DATABASE_URL los tests se OMITEN;
 *  - todo lleva un marcador único y se borra en afterAll;
 *  - no se usa red ni la base de producción.
 */
const RUN = Boolean(process.env.TEST_DATABASE_URL)
const marker = `vitest-changelog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!RUN)('ChangeLog: SQL crudo (integración)', () => {
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "ChangeLog" WHERE "entityId" LIKE ${`${marker}%`}`
  })

  it('guarda antes/después como jsonb, lee la fila y la marca como revertida una sola vez', async () => {
    const entityId = `${marker}:memoria`
    const created = await recordChange({
      entity: 'memory',
      entityId,
      before: { importance: 0.5, tags: ['a'] },
      after: { importance: 0.9, tags: ['a', 'b'] },
      actor: 'vitest',
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.action).toBe('update')
    expect(created.actor).toBe('vitest')
    expect(created.before).toEqual({ importance: 0.5, tags: ['a'] })
    expect(created.after).toEqual({ importance: 0.9, tags: ['a', 'b'] })
    expect(created.revertedAt).toBeNull()
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false)

    const read = await getChange(created.id)
    expect(read?.entity).toBe('memory')
    expect(read?.entityId).toBe(entityId)
    expect(read?.after).toEqual(created.after)
    expect((await latestChange('memory', entityId))?.id).toBe(created.id)

    expect(await countRecentChanges('memory', entityId, 60)).toBe(1)
    expect(await markReverted(created.id)).toBe(true)
    expect(await markReverted(created.id)).toBe(false)
    expect((await getChange(created.id))?.revertedAt).not.toBeNull()
    expect(await latestChange('memory', entityId)).toBeNull()
    expect(await countRecentChanges('memory', entityId, 60)).toBe(0)
  })

  it('el contador respeta la ventana de tiempo y el tope por minuto', async () => {
    const entityId = `${marker}:ventana`
    await recordChange({ entity: 'note', entityId, before: 1, after: 2 })

    // Una fila antigua no debe contar aunque no esté revertida.
    await prisma.$executeRaw`
      INSERT INTO "ChangeLog" ("id","entity","entityId","action","before","after","actor","createdAt")
      VALUES (${randomUUID()}, 'note', ${entityId}, 'update',
              'null'::jsonb, 'null'::jsonb, 'vitest', now() - interval '10 minutes')
    `
    expect(await countRecentChanges('note', entityId, 60)).toBe(1)
    expect(await countRecentChanges('note', entityId, 900)).toBe(2)
    expect(MAX_CHANGES_PER_MINUTE).toBeGreaterThan(1)
  })

  it('null y undefined se guardan como NULL (no como la cadena "undefined")', async () => {
    const entityId = `${marker}:nulo`
    const created = await recordChange({ entity: 'memory', entityId, before: undefined, after: null })
    expect(created.before).toBeNull()
    expect(created.after).toBeNull()
  })
})
