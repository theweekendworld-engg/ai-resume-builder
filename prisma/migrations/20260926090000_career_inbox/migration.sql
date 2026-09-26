-- AlterEnum
ALTER TYPE "WinSource" ADD VALUE 'chat';

-- AlterTable
ALTER TABLE "ApplicationWorkspace" ADD COLUMN     "fitVerdict" TEXT,
ADD COLUMN     "scoutRunId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationWorkspace_scoutRunId_key" ON "ApplicationWorkspace"("scoutRunId");

