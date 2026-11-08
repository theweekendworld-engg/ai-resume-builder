-- UserMemory: long-term memory (docs/impl/08-memory.md). Additive only: one
-- new table and its indexes; nothing existing is altered.

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sensitivity" TEXT NOT NULL DEFAULT 'shareable',
    "status" TEXT NOT NULL DEFAULT 'active',
    "supersededById" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id"),
    -- The closed vocabularies, held by the database as well as the code.
    CONSTRAINT "UserMemory_source_check" CHECK ("source" IN ('clarification_answer', 'chat', 'scout_answer', 'consolidation', 'user_edit')),
    CONSTRAINT "UserMemory_sensitivity_check" CHECK ("sensitivity" IN ('shareable', 'private')),
    CONSTRAINT "UserMemory_status_check" CHECK ("status" IN ('active', 'superseded', 'deleted'))
);

-- CreateIndex
CREATE INDEX "UserMemory_userId_status_key_idx" ON "UserMemory"("userId", "status", "key");

-- CreateIndex
CREATE INDEX "UserMemory_updatedAt_idx" ON "UserMemory"("updatedAt");

-- At most one ACTIVE memory per (userId, key). Superseded and deleted rows
-- are history and may repeat. Prisma 6 cannot express a partial unique index,
-- so it lives here; idempotency is a DB constraint (CLAUDE.md).
CREATE UNIQUE INDEX "UserMemory_userId_key_active_key" ON "UserMemory"("userId", "key") WHERE "status" = 'active';
