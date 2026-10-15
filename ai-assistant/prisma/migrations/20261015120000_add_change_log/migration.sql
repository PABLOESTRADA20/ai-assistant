-- Auditoría de cambios de datos (FASE 4).
--
-- Permite revertir una edición hecha por ARIA sobre una memoria o una nota:
-- guarda el valor anterior completo (`before`) y el nuevo (`after`), quién lo
-- hizo y cuándo. `revert_change` reaplica `before` y marca `revertedAt`.
--
-- Aditiva y con IF NOT EXISTS: no toca datos existentes. Se accede por SQL
-- crudo desde app/lib/changelog.ts (el cliente Prisma generado no incluye este
-- modelo, igual que pasa con `Note`).

CREATE TABLE IF NOT EXISTS "ChangeLog" (
  "id"         TEXT NOT NULL,
  "entity"     TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "actor"      TEXT NOT NULL DEFAULT 'aria',
  "revertedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- Consultas típicas: "último cambio de esta entidad" y "cambios recientes"
-- (límite anti edición masiva).
CREATE INDEX IF NOT EXISTS "ChangeLog_entity_entityId_createdAt_idx"
  ON "ChangeLog" ("entity", "entityId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChangeLog_createdAt_idx" ON "ChangeLog" ("createdAt");
