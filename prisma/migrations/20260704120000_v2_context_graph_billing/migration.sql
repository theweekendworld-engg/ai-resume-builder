-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('repo', 'metric_confirmed', 'document', 'url', 'interview_assertion', 'import');

-- CreateEnum
CREATE TYPE "GroundState" AS ENUM ('grounded', 'needs_confirmation', 'unsupported');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('free', 'always_on', 'pro', 'team');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('discovered', 'analyzed', 'drafting', 'in_progress', 'submitted', 'applied', 'in_review', 'interview', 'offer', 'rejected', 'ghosted', 'archived');

-- AlterTable: promote ApplicationWorkspace.applicationStatus String -> ApplicationStatus enum.
-- All existing values (discovered/analyzed/in_progress/applied/archived) are members
-- of the new enum, so the USING cast migrates every row cleanly.
ALTER TABLE "ApplicationWorkspace" ALTER COLUMN "applicationStatus" DROP DEFAULT;
ALTER TABLE "ApplicationWorkspace" ALTER COLUMN "applicationStatus" TYPE "ApplicationStatus" USING ("applicationStatus"::"ApplicationStatus");
ALTER TABLE "ApplicationWorkspace" ALTER COLUMN "applicationStatus" SET DEFAULT 'discovered';

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimRefId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "groundState" "GroundState" NOT NULL DEFAULT 'needs_confirmation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "baseline" TEXT,
    "result" TEXT,
    "delta" TEXT,
    "timeframe" TEXT,
    "scope" TEXT,
    "source" TEXT NOT NULL,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "qdrantPointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImpactMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubId" TEXT,
    "tier" "Tier" NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Evidence_userId_kind_idx" ON "Evidence"("userId", "kind");

-- CreateIndex
CREATE INDEX "ClaimLink_userId_claimType_claimRefId_idx" ON "ClaimLink"("userId", "claimType", "claimRefId");

-- CreateIndex
CREATE INDEX "ClaimLink_evidenceId_idx" ON "ClaimLink"("evidenceId");

-- CreateIndex
CREATE INDEX "ImpactMetric_userId_subjectType_subjectId_idx" ON "ImpactMetric"("userId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "UsageQuota_userId_action_idx" ON "UsageQuota"("userId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "UsageQuota_userId_periodStart_action_key" ON "UsageQuota"("userId", "periodStart", "action");

-- AddForeignKey
ALTER TABLE "ClaimLink" ADD CONSTRAINT "ClaimLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
