-- AlterEnum
CREATE TYPE "ResumeImportStatus" AS ENUM ('pending', 'processing', 'ready', 'completed', 'failed');

-- AlterEnum
CREATE TYPE "ResumeImportStep" AS ENUM ('upload_received', 'pdf_text_extract', 'pdf_link_extract', 'ai_parse', 'ready', 'failed');

-- AlterTable
ALTER TABLE "GenerationSession"
ADD COLUMN "workflowRunId" TEXT,
ADD COLUMN "stepStartedAt" TIMESTAMP(3),
ADD COLUMN "lastNotifiedState" TEXT,
ADD COLUMN "fallbackResume" JSONB,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ResumeImportSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResumeImportStatus" NOT NULL DEFAULT 'pending',
    "currentStep" "ResumeImportStep" NOT NULL DEFAULT 'upload_received',
    "workflowRunId" TEXT,
    "blobKey" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "parsedData" JSONB,
    "errorMessage" TEXT,
    "stepStartedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdateReceipt" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdateReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeImportSession_userId_updatedAt_idx" ON "ResumeImportSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResumeImportSession_status_updatedAt_idx" ON "ResumeImportSession"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUpdateReceipt_updateId_key" ON "TelegramUpdateReceipt"("updateId");
