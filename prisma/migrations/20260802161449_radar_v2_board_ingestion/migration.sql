-- DropIndex
DROP INDEX "JobPosting_compBandEligible_geoBucket_postedAt_idx";

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "bandKey" TEXT,
ADD COLUMN     "roleFamily" TEXT,
ADD COLUMN     "seniority" TEXT;

-- CreateIndex
CREATE INDEX "JobPosting_bandKey_compBandEligible_postedAt_idx" ON "JobPosting"("bandKey", "compBandEligible", "postedAt");
