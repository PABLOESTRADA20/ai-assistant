-- Índice de código (FASE 3): trozos por función/clase/archivo con búsqueda
-- por significado (HNSW) y por coincidencia léxica (GIN).
--
-- Aditiva y con IF NOT EXISTS: no toca datos existentes. El `embedding` lo
-- escribe el script local `db:index-code` (mismo patrón que Memory/VaultNote),
-- no Prisma.
--
-- Por qué HNSW y no IVFFlat: el catálogo de código crece por inserciones
-- incrementales y HNSW no necesita fase de entrenamiento; además la
-- reindexación completa de un fichero solo añade/reescribie filas.

CREATE TABLE IF NOT EXISTS "CodeChunk" (
  "id"          TEXT NOT NULL,
  "repo"        TEXT NOT NULL,
  "path"        TEXT NOT NULL,
  "symbol"      TEXT,
  "kind"        TEXT NOT NULL,
  "lang"        TEXT,
  "startLine"   INTEGER NOT NULL,
  "endLine"     INTEGER NOT NULL,
  "content"     TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "fileHash"    TEXT NOT NULL,
  "embedding"   vector(1024),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CodeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CodeChunk_repo_path_idx" ON "CodeChunk" ("repo", "path");
CREATE INDEX IF NOT EXISTS "CodeChunk_fileHash_idx" ON "CodeChunk" ("fileHash");
CREATE INDEX IF NOT EXISTS "CodeChunk_kind_idx" ON "CodeChunk" ("kind");

CREATE INDEX IF NOT EXISTS "CodeChunk_embedding_hnsw_idx"
  ON "CodeChunk" USING hnsw ("embedding" vector_cosine_ops);

-- Configuración 'simple' (sin stemming): el código se busca por identificadores
-- literales, así `saveNote` sigue casando con `saveNote` en vez de con una raíz
-- recortada. La expresión DEBE coincidir exactamente con la de
-- app/lib/code-index.ts, o Postgres no podrá usar este índice.
CREATE INDEX IF NOT EXISTS "CodeChunk_fts_idx"
  ON "CodeChunk" USING GIN (
    to_tsvector('simple', COALESCE("symbol", '') || ' ' || "path" || ' ' || "content")
  );
