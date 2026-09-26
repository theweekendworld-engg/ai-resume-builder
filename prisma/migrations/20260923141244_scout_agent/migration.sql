-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'awaiting_input', 'succeeded', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('running', 'succeeded', 'unavailable', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('linkedin_export', 'extension', 'manual');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "kind" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'queued',
    "channel" "Channel" NOT NULL DEFAULT 'web',
    "channelRef" JSONB,
    "workflowRunId" TEXT,
    "pendingQuestion" JSONB,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "output" JSONB,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "url" TEXT,
    "author" TEXT,
    "title" TEXT NOT NULL,
    "takeaways" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "profileUrl" TEXT,
    "email" TEXT,
    "company" TEXT,
    "normalizedCompany" TEXT,
    "position" TEXT,
    "connectedOn" TIMESTAMP(3),
    "source" "ContactSource" NOT NULL DEFAULT 'linkedin_export',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agent_status_createdAt_idx" ON "AgentRun"("agent", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_userId_inputKey_key" ON "AgentRun"("userId", "inputKey");

-- CreateIndex
CREATE INDEX "AgentStep_name_status_startedAt_idx" ON "AgentStep"("name", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_name_attempt_key" ON "AgentStep"("runId", "name", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCache_key_key" ON "ResearchCache"("key");

-- CreateIndex
CREATE INDEX "ResearchCache_kind_expiresAt_idx" ON "ResearchCache"("kind", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedInsight_runId_key" ON "SavedInsight"("runId");

-- CreateIndex
CREATE INDEX "SavedInsight_userId_createdAt_idx" ON "SavedInsight"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_userId_normalizedCompany_idx" ON "Contact"("userId", "normalizedCompany");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_userId_profileUrl_key" ON "Contact"("userId", "profileUrl");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
