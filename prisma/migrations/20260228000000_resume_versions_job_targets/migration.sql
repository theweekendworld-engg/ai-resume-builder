-- CreateEnum
CREATE TYPE "ResumeVersionSource" AS ENUM ('manual', 'ai', 'import');

-- AlterTable Resume: add currentVersionId, make content nullable, add unique on userId
ALTER TABLE "Resume" ADD COLUMN "currentVersionId" TEXT;
ALTER TABLE "Resume" ALTER COLUMN "content" DROP NOT NULL;
CREATE INDEX "Resume_userId_updatedAt_idx" ON "Resume"("userId", "updatedAt");
CREATE UNIQUE INDEX "Resume_currentVersionId_key" ON "Resume"("currentVersionId");

-- CreateTable ResumeVersion
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "source" "ResumeVersionSource" NOT NULL DEFAULT 'manual',
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ResumeVersion_userId_createdAt_idx" ON "ResumeVersion"("userId", "createdAt");
CREATE INDEX "ResumeVersion_resumeId_createdAt_idx" ON "ResumeVersion"("resumeId", "createdAt");
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable JobTarget
CREATE TABLE "JobTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTarget_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobTarget_userId_updatedAt_idx" ON "JobTarget"("userId", "updatedAt");
