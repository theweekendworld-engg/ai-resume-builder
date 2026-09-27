-- The vector store moves into Postgres (pgvector).
--
-- Every statement is idempotent on purpose: `src/lib/pgVectorClient.ts`
-- creates the same objects on first use (the way a Qdrant collection was
-- created on first use), so production works the moment the code deploys, and
-- this migration is then a no-op when `migrate deploy` catches up.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "VectorCollection" (
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "distance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VectorCollection_pkey" PRIMARY KEY ("name")
);

CREATE TABLE IF NOT EXISTS "VectorPoint" (
    "collection" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT,
    "sourceId" TEXT,
    "payload" JSONB NOT NULL,
    "embedding" vector NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VectorPoint_pkey" PRIMARY KEY ("collection", "id")
);

CREATE INDEX IF NOT EXISTS "VectorPoint_collection_userId_type_idx" ON "VectorPoint"("collection", "userId", "type");
CREATE INDEX IF NOT EXISTS "VectorPoint_collection_type_idx" ON "VectorPoint"("collection", "type");
