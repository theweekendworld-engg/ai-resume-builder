-- AlterTable
ALTER TABLE "ApplicationWorkspace"
ADD COLUMN "latestGenerationSessionId" TEXT;

-- CreateTable
CREATE TABLE "ReusableAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionFingerprint" TEXT NOT NULL,
    "canonicalQuestion" TEXT NOT NULL,
    "questionType" TEXT,
    "answerMode" TEXT,
    "answerText" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "autoUse" BOOLEAN NOT NULL DEFAULT false,
    "sourceQuestionId" TEXT,
    "metadata" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReusableAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInsight" (
    "id" TEXT NOT NULL,
    "normalizedCompanyName" TEXT NOT NULL,
    "website" TEXT,
    "employeeCount" INTEGER,
    "fundingTotal" TEXT,
    "revenueEstimateText" TEXT,
    "reviewSummary" TEXT,
    "engineeringSummary" TEXT,
    "alumniSignalSummary" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freshnessLabel" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReusableAnswer_userId_questionFingerprint_key"
ON "ReusableAnswer"("userId", "questionFingerprint");

-- CreateIndex
CREATE INDEX "ReusableAnswer_userId_updatedAt_idx"
ON "ReusableAnswer"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ReusableAnswer_userId_autoUse_updatedAt_idx"
ON "ReusableAnswer"("userId", "autoUse", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInsight_normalizedCompanyName_website_key"
ON "CompanyInsight"("normalizedCompanyName", "website");

-- CreateIndex
CREATE INDEX "CompanyInsight_normalizedCompanyName_updatedAt_idx"
ON "CompanyInsight"("normalizedCompanyName", "updatedAt");

-- CreateIndex
CREATE INDEX "CompanyInsight_updatedAt_idx"
ON "CompanyInsight"("updatedAt");
