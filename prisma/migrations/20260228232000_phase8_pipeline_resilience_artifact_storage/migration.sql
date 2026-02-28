-- CreateEnum
CREATE TYPE "PipelineStep" AS ENUM (
    'reuse_check',
    'jd_parsing',
    'semantic_search',
    'static_data_load',
    'awaiting_clarification',
    'paraphrasing',
    'resume_assembly',
    'claim_validation',
    'ats_scoring',
    'pdf_generation',
    'completed'
);

-- AlterTable
ALTER TABLE "GenerationSession"
ADD COLUMN "currentStep" "PipelineStep" NOT NULL DEFAULT 'reuse_check',
ADD COLUMN "matchedProjects" JSONB,
ADD COLUMN "matchedAchievements" JSONB,
ADD COLUMN "staticData" JSONB,
ADD COLUMN "paraphrasedContent" JSONB,
ADD COLUMN "draftResume" JSONB,
ADD COLUMN "validationResult" JSONB,
ADD COLUMN "atsScore" INTEGER,
ADD COLUMN "pdfBlobKey" TEXT,
ADD COLUMN "pdfUrl" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "errorStep" "PipelineStep",
ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "totalLatencyMs" INTEGER,
ADD COLUMN "totalTokensUsed" INTEGER,
ADD COLUMN "totalCostUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "GeneratedPdf" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "sessionId" TEXT,
    "blobKey" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'ats-simple',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GeneratedPdf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationSession_status_idx" ON "GenerationSession"("status");

-- CreateIndex
CREATE INDEX "GeneratedPdf_userId_createdAt_idx" ON "GeneratedPdf"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedPdf_resumeId_idx" ON "GeneratedPdf"("resumeId");

-- CreateIndex
CREATE INDEX "GeneratedPdf_sessionId_idx" ON "GeneratedPdf"("sessionId");
