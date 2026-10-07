-- Cerebro: índices HNSW (pgvector) para la búsqueda semántica sin escaneo
-- secuencial.
--
-- Aditivo: no toca esquema ni datos. Las columnas `embedding` se siguen
-- escribiendo con SQL crudo (son Unsupported en Prisma), así que el índice se
-- declara a mano igual que la migración vector_1024.
--
-- Por qué HNSW y no IVFFlat: el catálogo de memoria/notas crece de forma
-- incremental y HNSW no necesita fase de entrenamiento; además, `db:reindex`
-- descarta y recalcula embeddings (los vectores viejos quedarían huérfanos en
-- un IVFFlat con listas sesgadas). El índice HNSW se construye en el momento
-- de crearse y acepta inserciones nuevas sin mantenimiento.

CREATE INDEX IF NOT EXISTS "Memory_embedding_hnsw_idx"
  ON "Memory" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "VaultNote_embedding_hnsw_idx"
  ON "VaultNote" USING hnsw ("embedding" vector_cosine_ops);