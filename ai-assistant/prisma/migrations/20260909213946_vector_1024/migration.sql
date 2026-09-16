-- Cambiar embeddings de 384 → 1024 dims (multilingual-e5-small → @cf/baai/bge-m3).
-- Prisma no migra tipos Unsupported, así que se hace a mano.
-- Los vectores viejos se descartan (UNUSABLE con otras dimensiones) y se re-indexan con db:reindex.

UPDATE "VaultNote" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
ALTER TABLE "VaultNote" ALTER COLUMN "embedding" TYPE vector(1024) USING "embedding"::vector(1024);

UPDATE "Memory" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
ALTER TABLE "Memory" ALTER COLUMN "embedding" TYPE vector(1024) USING "embedding"::vector(1024);