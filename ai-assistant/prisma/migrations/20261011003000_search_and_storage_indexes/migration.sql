-- Índices baratos para que el cerebro no recorra tablas completas al crecer.
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx"
  ON "Message" ("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Memory_isCompressed_updatedAt_idx"
  ON "Memory" ("isCompressed", "updatedAt");

CREATE INDEX IF NOT EXISTS "SessionContext_expiresAt_idx"
  ON "SessionContext" ("expiresAt");

-- Las expresiones coinciden exactamente con app/lib/brain.ts para que
-- PostgreSQL pueda usar los GIN en la recuperación léxica en español.
CREATE INDEX IF NOT EXISTS "Memory_content_fts_idx"
  ON "Memory" USING GIN (to_tsvector('spanish', "content"));

CREATE INDEX IF NOT EXISTS "Message_content_fts_idx"
  ON "Message" USING GIN (to_tsvector('spanish', "content"));

CREATE INDEX IF NOT EXISTS "VaultNote_title_content_fts_idx"
  ON "VaultNote" USING GIN (
    to_tsvector('spanish', COALESCE("title", '') || ' ' || "content")
  );

CREATE INDEX IF NOT EXISTS "Note_title_content_fts_idx"
  ON "Note" USING GIN (to_tsvector('spanish', "title" || ' ' || "content"));
