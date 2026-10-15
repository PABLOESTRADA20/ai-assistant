import { prisma } from '@/app/lib/prisma'
import { Prisma } from '../generated/prisma/wasm.js'

/**
 * Auditoría de cambios de datos (FASE 4).
 *
 * Cada vez que ARIA modifica una memoria (`update_memory`) o una nota
 * (`update_cloud_note`) se apunta aquí el valor **anterior** completo y el
 * **nuevo**. Con eso, un cambio es reversible: `revert_change` reaplica
 * `before` y marca `revertedAt` para que nadie lo revierta dos veces.
 *
 * ¿Por qué SQL crudo y no `prisma.changeLog`? Igual que con `Note`: el cliente
 * que se ejecuta en el Worker es el generado y no incluye el modelo `ChangeLog`
 * (regenerarlo arrastraría decenas de ficheros). La tabla existe por la
 * migración `20261015120000_add_change_log` y el SQL va parametrizado.
 */

export type ChangeEntity = 'memory' | 'note'

export interface ChangeRecord {
  id: string
  entity: string
  entityId: string
  action: string
  before: unknown
  after: unknown
  actor: string
  revertedAt: string | null
  createdAt: string
}

/**
 * Tope de cambios automáticos por minuto y por registro. Frena una edición
 * masiva (p. ej. el modelo en bucle) sin molestar al uso normal.
 */
export const MAX_CHANGES_PER_MINUTE = 12

interface Row {
  id: string
  entity: string
  entityId: string
  action: string
  before: unknown
  after: unknown
  actor: string
  revertedAt: Date | string | null
  createdAt: Date | string
}

const FIELDS = Prisma.sql`"id","entity","entityId","action","before","after","actor","revertedAt","createdAt"`

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toRecord(row: Row): ChangeRecord {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    before: row.before ?? null,
    after: row.after ?? null,
    actor: row.actor,
    revertedAt: row.revertedAt ? toIso(row.revertedAt) : null,
    createdAt: toIso(row.createdAt),
  }
}

/** Serializa a jsonb; `null` para valores ausentes. */
function jsonParam(value: unknown): Prisma.Sql {
  if (value === undefined || value === null) return Prisma.sql`NULL`
  return Prisma.sql`${JSON.stringify(value)}::jsonb`
}

/**
 * Cambios **sin revertir** sobre un registro en los últimos `seconds`
 * segundos. Es el contador del límite anti edición masiva.
 */
export async function countRecentChanges(
  entity: ChangeEntity,
  entityId: string,
  seconds = 60,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM "ChangeLog"
    WHERE "entity" = ${entity}
      AND "entityId" = ${entityId}
      AND "revertedAt" IS NULL
      AND "createdAt" > now() - (${seconds}::int * interval '1 second')
  `)
  return rows[0]?.count ?? 0
}

/** Registra un cambio ya aplicado y devuelve la fila creada. */
export async function recordChange(input: {
  entity: ChangeEntity
  entityId: string
  before: unknown
  after: unknown
  actor?: string
}): Promise<ChangeRecord> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    INSERT INTO "ChangeLog" ("id","entity","entityId","action","before","after","actor","createdAt")
    VALUES (
      ${crypto.randomUUID()},
      ${input.entity},
      ${input.entityId},
      'update',
      ${jsonParam(input.before)},
      ${jsonParam(input.after)},
      ${input.actor ?? 'aria'},
      now()
    )
    RETURNING ${FIELDS}
  `)
  return toRecord(rows[0])
}

export async function getChange(id: string): Promise<ChangeRecord | null> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT ${FIELDS} FROM "ChangeLog" WHERE "id" = ${id} LIMIT 1
  `)
  return rows[0] ? toRecord(rows[0]) : null
}

/** Último cambio sin revertir de un registro, o `null` si no hay. */
export async function latestChange(
  entity: ChangeEntity,
  entityId: string,
): Promise<ChangeRecord | null> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT ${FIELDS} FROM "ChangeLog"
    WHERE "entity" = ${entity} AND "entityId" = ${entityId} AND "revertedAt" IS NULL
    ORDER BY "createdAt" DESC
    LIMIT 1
  `)
  return rows[0] ? toRecord(rows[0]) : null
}

/**
 * Marca un cambio como revertido. Devuelve `true` solo si lo marcó ahora (si ya
 * estaba revertido, `false`), para que `revert_change` pueda avisar en vez de
 * revertir dos veces.
 */
export async function markReverted(id: string): Promise<boolean> {
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "ChangeLog" SET "revertedAt" = now()
    WHERE "id" = ${id} AND "revertedAt" IS NULL
  `)
  return count > 0
}
