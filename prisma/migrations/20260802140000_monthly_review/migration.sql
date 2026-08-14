-- Month in Review: a real home for the composed document.
-- Replaces storage in Job.result, which is not queryable and is pruned
-- by job retention. Recomposing on demand is not an option: the artefact
-- must be stable across refreshes.

-- CreateTable
CREATE TABLE "MonthlyReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "paragraph" TEXT,
    "observation" TEXT,
    "mixSentence" TEXT,
    "receipt" TEXT NOT NULL,
    "winIds" JSONB NOT NULL DEFAULT '[]',
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "quantifiedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyReview_userId_createdAt_idx" ON "MonthlyReview"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReview_userId_period_key" ON "MonthlyReview"("userId", "period");

