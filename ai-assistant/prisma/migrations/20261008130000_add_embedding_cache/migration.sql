-- Caché de embeddings (mismo vector(1024) que VaultNote/Memory).
-- Clave: hash FNV-1a del texto EXACTO embebido ("query: ..." o "passage: ...").
-- Evita volver a gastar neuronas de Workers AI por textos repetidos (queries
-- re-preguntadas, reinicios del reindexador del vault).
CREATE TABLE IF NOT EXISTS "EmbeddingCache" (
  "hash"      TEXT PRIMARY KEY,
  "embedding" vector(1024) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EmbeddingCache_usedAt_idx" ON "EmbeddingCache" ("usedAt");