-- Wave C — capture connectors, review packets, backfill interview
-- PRD 02 §5 · PRD 03 §6 · PRD 07 §5.2
--
-- Load-bearing constraint:
--   CaptureSignal_sourceId_externalId_key — one Win per capture signal.
--   It is what makes re-syncing safe and a duplicated cron harmless.

-- CreateEnum
CREATE TYPE "CaptureSourceKind" AS ENUM ('github', 'calendar', 'linear', 'jira');

-- CreateEnum
CREATE TYPE "CaptureSourceStatus" AS ENUM ('active', 'paused', 'error', 'revoked');

-- CreateEnum
CREATE TYPE "CaptureRunStatus" AS ENUM ('running', 'success', 'degraded', 'failed');

-- CreateEnum
CREATE TYPE "FrameworkSource" AS ENUM ('uploaded', 'template', 'default');

-- CreateEnum
CREATE TYPE "PacketType" AS ENUM ('performance_review', 'promotion_case', 'self_appraisal', 'brag_doc');

-- CreateEnum
CREATE TYPE "PacketStatus" AS ENUM ('generating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('active', 'paused', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "InterviewSubject" AS ENUM ('employer', 'project', 'competency', 'period');

-- CreateTable
CREATE TABLE "CaptureSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CaptureSourceKind" NOT NULL,
    "status" "CaptureSourceStatus" NOT NULL DEFAULT 'active',
    "externalAccountId" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "consentGrantedAt" TIMESTAMP(3) NOT NULL,
    "consentCopyVersion" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "groupKey" TEXT,
    "isNoise" BOOLEAN NOT NULL DEFAULT false,
    "noiseRule" TEXT,
    "processedAt" TIMESTAMP(3),
    "winId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "CaptureRunStatus" NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "itemsScanned" INTEGER NOT NULL DEFAULT 0,
    "itemsNoise" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "winsDrafted" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CaptureRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyFramework" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "sourceType" "FrameworkSource" NOT NULL,
    "companyName" TEXT,
    "levels" JSONB NOT NULL DEFAULT '[]',
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "rawSourceRef" TEXT,
    "isConfidential" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetencyFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewPacket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PacketType" NOT NULL,
    "status" "PacketStatus" NOT NULL DEFAULT 'generating',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "employerId" TEXT,
    "frameworkId" TEXT,
    "targetLevel" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'manager',
    "winIds" JSONB NOT NULL DEFAULT '[]',
    "content" JSONB,
    "userEdits" JSONB NOT NULL DEFAULT '{}',
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "exports" JSONB NOT NULL DEFAULT '[]',
    "generationMs" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectType" "InterviewSubject" NOT NULL,
    "subjectId" TEXT,
    "subjectLabel" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'active',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "askedTopics" JSONB NOT NULL DEFAULT '[]',
    "winIds" JSONB NOT NULL DEFAULT '[]',
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptureSource_status_lastSyncedAt_idx" ON "CaptureSource"("status", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSource_userId_kind_key" ON "CaptureSource"("userId", "kind");

-- CreateIndex
CREATE INDEX "CaptureSignal_userId_occurredAt_idx" ON "CaptureSignal"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "CaptureSignal_sourceId_processedAt_idx" ON "CaptureSignal"("sourceId", "processedAt");

-- CreateIndex
CREATE INDEX "CaptureSignal_groupKey_idx" ON "CaptureSignal"("groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSignal_sourceId_externalId_key" ON "CaptureSignal"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "CaptureRun_userId_startedAt_idx" ON "CaptureRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "CaptureRun_sourceId_startedAt_idx" ON "CaptureRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "CompetencyFramework_userId_idx" ON "CompetencyFramework"("userId");

-- CreateIndex
CREATE INDEX "CompetencyFramework_sourceType_companyName_idx" ON "CompetencyFramework"("sourceType", "companyName");

-- CreateIndex
CREATE INDEX "ReviewPacket_userId_createdAt_idx" ON "ReviewPacket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewPacket_userId_periodEnd_idx" ON "ReviewPacket"("userId", "periodEnd");

-- CreateIndex
CREATE INDEX "InterviewSession_userId_status_lastActiveAt_idx" ON "InterviewSession"("userId", "status", "lastActiveAt");

-- CreateIndex
CREATE INDEX "InterviewSession_expiresAt_idx" ON "InterviewSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "CaptureSignal" ADD CONSTRAINT "CaptureSignal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CaptureSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRun" ADD CONSTRAINT "CaptureRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CaptureSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

