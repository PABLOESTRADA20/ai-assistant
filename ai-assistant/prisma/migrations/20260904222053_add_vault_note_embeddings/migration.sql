-- pgvector extension required by vector(384) columns
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "VaultNote" (
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultNote_pkey" PRIMARY KEY ("path")
);
