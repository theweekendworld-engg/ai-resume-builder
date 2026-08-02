-- CreateEnum
CREATE TYPE "JobBoardProvider" AS ENUM ('greenhouse', 'lever', 'ashby');

-- CreateEnum
CREATE TYPE "JobSourceStatus" AS ENUM ('active', 'inactive', 'throttled');

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "provider" "JobBoardProvider" NOT NULL,
    "boardToken" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "status" "JobSourceStatus" NOT NULL DEFAULT 'active',
    "discoveredVia" TEXT NOT NULL DEFAULT 'seed',
    "discoveredByUserId" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "notFoundStreak" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "geoBucket" TEXT,
    "department" TEXT,
    "absoluteUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "updatedAtSource" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "compLow" INTEGER,
    "compHigh" INTEGER,
    "compCurrency" TEXT,
    "compPeriod" TEXT,
    "compAnnualLow" INTEGER,
    "compAnnualHigh" INTEGER,
    "compSource" TEXT,
    "compLabel" TEXT,
    "compBandEligible" BOOLEAN NOT NULL DEFAULT false,
    "compRejectReason" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillSignal" (
    "id" TEXT NOT NULL,
    "skillNorm" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "geoBucket" TEXT NOT NULL,
    "postingCount" INTEGER NOT NULL,
    "medianLow" INTEGER,
    "medianHigh" INTEGER,
    "currency" TEXT,
    "trendPercent" DOUBLE PRECISION,
    "seniorityMix" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferDataPoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "level" TEXT,
    "geoBucket" TEXT NOT NULL,
    "companyName" TEXT,
    "baseAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "equityAnnualized" INTEGER,
    "bonusAmount" INTEGER,
    "offeredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT,

    CONSTRAINT "OfferDataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobSource_status_lastFetchedAt_idx" ON "JobSource"("status", "lastFetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_provider_boardToken_key" ON "JobSource"("provider", "boardToken");

-- CreateIndex
CREATE INDEX "JobPosting_compBandEligible_geoBucket_postedAt_idx" ON "JobPosting"("compBandEligible", "geoBucket", "postedAt");

-- CreateIndex
CREATE INDEX "JobPosting_sourceId_closedAt_idx" ON "JobPosting"("sourceId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_sourceId_externalId_key" ON "JobPosting"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "SkillSignal_geoBucket_postingCount_idx" ON "SkillSignal"("geoBucket", "postingCount");

-- CreateIndex
CREATE UNIQUE INDEX "SkillSignal_skillNorm_window_geoBucket_key" ON "SkillSignal"("skillNorm", "window", "geoBucket");

-- CreateIndex
CREATE UNIQUE INDEX "OfferDataPoint_workspaceId_key" ON "OfferDataPoint"("workspaceId");

-- CreateIndex
CREATE INDEX "OfferDataPoint_roleTitle_geoBucket_offeredAt_idx" ON "OfferDataPoint"("roleTitle", "geoBucket", "offeredAt");

-- CreateIndex
CREATE INDEX "OfferDataPoint_userId_idx" ON "OfferDataPoint"("userId");

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
