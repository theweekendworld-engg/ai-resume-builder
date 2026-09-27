-- AlterTable
ALTER TABLE "GenerationSession" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "baseResumeId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "PendingScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingScore_expiresAt_idx" ON "PendingScore"("expiresAt");

-- CreateIndex
CREATE INDEX "Resume_workspaceId_idx" ON "Resume"("workspaceId");

