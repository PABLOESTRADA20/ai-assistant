-- AlterTable
-- Compactación incremental: nº de mensajes ya plegados en `Conversation.summary`.
-- Aditiva e idempotente (IF NOT EXISTS): no rompe bases ya migradas.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "summarizedCount" INTEGER NOT NULL DEFAULT 0;
