-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "focus" JSONB,
ADD COLUMN     "focusAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "workspaceId" TEXT,
    "parentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "format" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "toEmail" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "instruction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageDraft_userId_createdAt_idx" ON "MessageDraft"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageDraft_parentId_idx" ON "MessageDraft"("parentId");
