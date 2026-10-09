-- AlterTable
-- FASE 3: persistir por mensaje las fuentes del cerebro usadas (chips) y el
-- contexto estimado del turno (badge de compactación), para que sobrevivan a
-- la recarga. `tools` ya existía desde add_tools_json (no se tocaba en el PUT).
-- Aditiva e idempotente (IF NOT EXISTS): no rompe bases ya migradas.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "sources" JSONB;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "context" JSONB;