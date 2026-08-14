-- CreateTable
CREATE TABLE "ApplicationWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourcePlatform" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "companyName" TEXT,
    "roleTitle" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "compensationText" TEXT,
    "jobDescription" TEXT,
    "applicationStatus" TEXT NOT NULL DEFAULT 'discovered',
    "fitScore" INTEGER,
    "fitSummary" TEXT,
    "companySnapshot" JSONB,
    "linkedJobTargetId" TEXT,
    "selectedResumeId" TEXT,
    "selectedGeneratedPdfId" TEXT,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationWorkspace_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ApplicationQuestion"
ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationWorkspace_userId_sourceUrl_key" ON "ApplicationWorkspace"("userId", "sourceUrl");

-- CreateIndex
CREATE INDEX "ApplicationWorkspace_userId_updatedAt_idx" ON "ApplicationWorkspace"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationWorkspace_userId_companyName_roleTitle_updatedAt_idx" ON "ApplicationWorkspace"("userId", "companyName", "roleTitle", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationQuestion_workspaceId_updatedAt_idx" ON "ApplicationQuestion"("workspaceId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ApplicationQuestion"
ADD CONSTRAINT "ApplicationQuestion_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "ApplicationWorkspace"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
