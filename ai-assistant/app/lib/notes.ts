import { prisma } from '@/app/lib/prisma'
import { Prisma } from '../generated/prisma/wasm.js'

/**
 * "Carpeta ARIA": notas guardadas en la nube.
 *
 * El Worker de Cloudflare no puede escribir en el disco del PC, así que la
 * carpeta vive en la base de datos (tabla `Note`) y se exporta a Obsidian cuando
 * el usuario quiera, desde el celular o el PC. Es la opción que no necesita
 * tener el ordenador encendido ni abrir túneles.
 *
 * ¿Por qué SQL directo y no `prisma.note`? Porque el cliente que se ejecuta en
 * el Worker es el generado con `prisma-client-js` (`wasm.js`, parcheado a mano
 * para workerd) y no conoce el modelo `Note`. La tabla existe igual (migración
 * `20261002195000_add_note`) y el SQL va parametrizado con `Prisma.sql`, así que
 * es igual de seguro. El modelo del `schema.prisma` queda para las migraciones.
 */

export interface NoteRecord {
  id: string
  title: string
  content: string
  tags: string[]
  source: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface NoteRow {
  id: string
  title: string
  content: string
  tags: unknown
  source: string
  pinned: boolean
  createdAt: Date | string
  updatedAt: Date | string
}

const FIELDS = Prisma.sql`"id","title","content","tags","source","pinned","createdAt","updatedAt"`

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parseTags(value: unknown): string[] {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = null
    }
  }
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : []
}

function toRecord(n: NoteRow): NoteRecord {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    tags: parseTags(n.tags),
    source: n.source,
    pinned: n.pinned,
    createdAt: toIso(n.createdAt),
    updatedAt: toIso(n.updatedAt),
  }
}

/** Normaliza los tags a un JSON válido para jsonb, o null si no hay. */
function tagsJson(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null
  const clean = tags
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
    .slice(0, 12)
  return clean.length ? JSON.stringify(clean) : null
}

export async function listNotes(query?: string): Promise<NoteRecord[]> {
  const q = query?.trim()
  const where = q
    ? Prisma.sql`WHERE ("title" ILIKE ${'%' + q + '%'} OR "content" ILIKE ${'%' + q + '%'})`
    : Prisma.empty

  const rows = await prisma.$queryRaw<NoteRow[]>(
    Prisma.sql`SELECT ${FIELDS} FROM "Note" ${where} ORDER BY "pinned" DESC, "updatedAt" DESC LIMIT 500`,
  )
  return rows.map(toRecord)
}

export async function getNote(id: string): Promise<NoteRecord | null> {
  try {
    const rows = await prisma.$queryRaw<NoteRow[]>(
      Prisma.sql`SELECT ${FIELDS} FROM "Note" WHERE "id" = ${id} LIMIT 1`,
    )
    return rows[0] ? toRecord(rows[0]) : null
  } catch {
    return null
  }
}

/**
 * Busca por id si parece un uuid, o por título (case-insensitive, primero
 * exacto y luego parcial). Se usa desde la herramienta de lectura para aceptar
 * "lee la nota X".
 */
export async function findNote(titleOrId: string): Promise<NoteRecord | null> {
  const value = titleOrId?.trim()
  if (!value) return null

  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  if (looksLikeUuid) {
    const byId = await getNote(value)
    if (byId) return byId
  }

  try {
    const exact = await prisma.$queryRaw<NoteRow[]>(
      Prisma.sql`SELECT ${FIELDS} FROM "Note" WHERE "title" ILIKE ${value} ORDER BY "updatedAt" DESC LIMIT 1`,
    )
    if (exact[0]) return toRecord(exact[0])

    const partial = await prisma.$queryRaw<NoteRow[]>(
      Prisma.sql`SELECT ${FIELDS} FROM "Note" WHERE "title" ILIKE ${'%' + value + '%'} ORDER BY "updatedAt" DESC LIMIT 1`,
    )
    return partial[0] ? toRecord(partial[0]) : null
  } catch {
    return null
  }
}

/**
 * Guarda o actualiza una nota. Si ya existe una con el mismo título (sin
 * distinguir mayúsculas), se actualiza: así "guarda X" repetido no crea
 * duplicados.
 */
export async function saveNote(input: {
  title: string
  content: string
  tags?: unknown
  source?: string
}): Promise<NoteRecord> {
  const title = input.title?.trim().slice(0, 200) || 'Nota sin título'
  const content = input.content ?? ''
  const tags = tagsJson(input.tags)

  const existing = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Note" WHERE "title" ILIKE ${title} ORDER BY "updatedAt" DESC LIMIT 1`,
  )

  if (existing[0]) {
    const rows = await prisma.$queryRaw<NoteRow[]>(
      Prisma.sql`
        UPDATE "Note"
        SET "content" = ${content}, "tags" = ${tags}::jsonb, "updatedAt" = now()
        WHERE "id" = ${existing[0].id}
        RETURNING ${FIELDS}
      `,
    )
    return toRecord(rows[0])
  }

  const rows = await prisma.$queryRaw<NoteRow[]>(
    Prisma.sql`
      INSERT INTO "Note" ("id","title","content","tags","source","pinned","createdAt","updatedAt")
      VALUES (${crypto.randomUUID()}, ${title}, ${content}, ${tags}::jsonb, ${input.source ?? 'aria'}, false, now(), now())
      RETURNING ${FIELDS}
    `,
  )
  return toRecord(rows[0])
}

export async function updateNote(
  id: string,
  data: { title?: string; content?: string; tags?: unknown; pinned?: boolean },
): Promise<NoteRecord | null> {
  const sets: Prisma.Sql[] = []
  if (typeof data.title === 'string' && data.title.trim()) {
    sets.push(Prisma.sql`"title" = ${data.title.trim().slice(0, 200)}`)
  }
  if (typeof data.content === 'string') {
    sets.push(Prisma.sql`"content" = ${data.content}`)
  }
  if (typeof data.pinned === 'boolean') {
    sets.push(Prisma.sql`"pinned" = ${data.pinned}`)
  }
  if (Array.isArray(data.tags)) {
    sets.push(Prisma.sql`"tags" = ${tagsJson(data.tags)}::jsonb`)
  }
  sets.push(Prisma.sql`"updatedAt" = now()`)

  try {
    const rows = await prisma.$queryRaw<NoteRow[]>(
      Prisma.sql`UPDATE "Note" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id} RETURNING ${FIELDS}`,
    )
    return rows[0] ? toRecord(rows[0]) : null
  } catch {
    return null
  }
}

export async function deleteNote(id: string): Promise<boolean> {
  try {
    const count = await prisma.$executeRaw(Prisma.sql`DELETE FROM "Note" WHERE "id" = ${id}`)
    return count > 0
  } catch {
    return false
  }
}
