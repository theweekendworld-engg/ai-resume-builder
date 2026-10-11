-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('watching', 'not_found');

-- CreateEnum
CREATE TYPE "JobMatchStatus" AS ENUM ('new', 'alerted', 'tracked', 'dismissed');

-- AlterEnum
ALTER TYPE "JobBoardProvider" ADD VALUE 'smartrecruiters';

-- AlterTable
ALTER TABLE "EmailPreference" ADD COLUMN     "jobAlerts" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "description" TEXT,
ADD COLUMN     "parsed" JSONB,
ADD COLUMN     "parsedKey" TEXT;

-- CreateTable
CREATE TABLE "WatchedCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "WatchStatus" NOT NULL DEFAULT 'watching',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "score" INTEGER,
    "verdict" TEXT NOT NULL,
    "matchedVia" TEXT NOT NULL,
    "qualifies" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "fit" JSONB NOT NULL,
    "people" JSONB,
    "status" "JobMatchStatus" NOT NULL DEFAULT 'new',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "alertedAt" TIMESTAMP(3),
    "workspaceId" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchedCompany_sourceId_idx" ON "WatchedCompany"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedCompany_userId_companyKey_key" ON "WatchedCompany"("userId", "companyKey");

-- CreateIndex
CREATE INDEX "JobMatch_userId_qualifies_status_score_idx" ON "JobMatch"("userId", "qualifies", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatch_userId_postingId_key" ON "JobMatch"("userId", "postingId");

-- AddForeignKey
ALTER TABLE "WatchedCompany" ADD CONSTRAINT "WatchedCompany_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

