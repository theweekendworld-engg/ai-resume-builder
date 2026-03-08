-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('pending', 'awaiting_clarification', 'generating', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('web', 'telegram', 'whatsapp', 'email');

-- CreateTable
CREATE TABLE "GenerationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobTargetId" TEXT,
    "jobDescription" TEXT NOT NULL,
    "parsedJD" JSONB,
    "matchedItems" JSONB,
    "clarifications" JSONB,
    "status" "GenerationStatus" NOT NULL DEFAULT 'pending',
    "resultResumeId" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationSession_userId_updatedAt_idx" ON "GenerationSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "GenerationSession_status_updatedAt_idx" ON "GenerationSession"("status", "updatedAt");
