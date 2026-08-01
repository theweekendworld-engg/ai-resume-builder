-- Career OS v3 — platform primitives + the Work Log kernel
-- Depends on 20260704120000_v2_context_graph_billing (Evidence/ClaimLink/ImpactMetric)
-- and on the pre-existing "Channel" enum.
--
-- Load-bearing constraints (do not drop these without reading docs/impl/00):
--   Job_dedupeKey_key   — idempotency is a DB guarantee, not handler discipline.
--   Win_signalId_key    — guarantees one Win per capture signal (Wave C).
--   WeeklyDigest_userId_weekStart_key — a double-fired cron cannot double-send.

CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'dead');
CREATE TYPE "WinStatus" AS ENUM ('draft', 'confirmed', 'dismissed', 'archived');
CREATE TYPE "WinCategory" AS ENUM ('shipped', 'improved', 'fixed', 'led', 'influenced', 'grew', 'learned', 'saved');
CREATE TYPE "WinSensitivity" AS ENUM ('shareable', 'internal_only', 'confidential');
CREATE TYPE "WinSource" AS ENUM ('manual', 'github', 'calendar', 'linear', 'jira', 'ambient', 'backfill', 'import');
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "durationMs" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "providerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailPreference" (
    "userId" TEXT NOT NULL,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "monthlyReview" BOOLEAN NOT NULL DEFAULT true,
    "radarDigest" BOOLEAN NOT NULL DEFAULT true,
    "missionNudges" BOOLEAN NOT NULL DEFAULT true,
    "productUpdates" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribedAll" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribeToken" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Etc/UTC',
    "digestDay" INTEGER NOT NULL DEFAULT 5,
    "digestHour" INTEGER NOT NULL DEFAULT 16,
    "digestChannel" "Channel" NOT NULL DEFAULT 'email',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowUserIds" JSONB NOT NULL DEFAULT '[]',
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Win" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "category" "WinCategory" NOT NULL,
    "status" "WinStatus" NOT NULL DEFAULT 'draft',
    "sensitivity" "WinSensitivity" NOT NULL DEFAULT 'shareable',
    "source" "WinSource" NOT NULL,
    "sourceRef" TEXT,
    "signalId" TEXT,
    "employerId" TEXT,
    "projectId" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "collaborators" JSONB NOT NULL DEFAULT '[]',
    "impactMetricId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "dismissedReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "qdrantPointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Win_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeeklyDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "channel" "Channel" NOT NULL,
    "winIds" JSONB NOT NULL DEFAULT '[]',
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "firstActionAt" TIMESTAMP(3),
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "dismissedCount" INTEGER NOT NULL DEFAULT 0,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");
CREATE INDEX "Job_status_runAt_priority_idx" ON "Job"("status", "runAt", "priority");
CREATE INDEX "Job_kind_createdAt_idx" ON "Job"("kind", "createdAt");
CREATE INDEX "Job_status_lockedAt_idx" ON "Job"("status", "lockedAt");
CREATE INDEX "EmailSend_userId_createdAt_idx" ON "EmailSend"("userId", "createdAt");
CREATE INDEX "EmailSend_template_createdAt_idx" ON "EmailSend"("template", "createdAt");
CREATE UNIQUE INDEX "EmailSend_providerId_key" ON "EmailSend"("providerId");
CREATE UNIQUE INDEX "EmailPreference_unsubscribeToken_key" ON "EmailPreference"("unsubscribeToken");
CREATE INDEX "EmailPreference_weeklyDigest_digestDay_digestHour_idx" ON "EmailPreference"("weeklyDigest", "digestDay", "digestHour");
CREATE UNIQUE INDEX "Win_signalId_key" ON "Win"("signalId");
CREATE INDEX "Win_userId_occurredAt_idx" ON "Win"("userId", "occurredAt" DESC);
CREATE INDEX "Win_userId_status_createdAt_idx" ON "Win"("userId", "status", "createdAt");
CREATE INDEX "Win_userId_employerId_occurredAt_idx" ON "Win"("userId", "employerId", "occurredAt");
CREATE INDEX "Win_userId_category_occurredAt_idx" ON "Win"("userId", "category", "occurredAt");
CREATE INDEX "Win_userId_sensitivity_idx" ON "Win"("userId", "sensitivity");
CREATE UNIQUE INDEX "WeeklyDigest_token_key" ON "WeeklyDigest"("token");
CREATE INDEX "WeeklyDigest_userId_sentAt_idx" ON "WeeklyDigest"("userId", "sentAt");
CREATE UNIQUE INDEX "WeeklyDigest_userId_weekStart_key" ON "WeeklyDigest"("userId", "weekStart");
