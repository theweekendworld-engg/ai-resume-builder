ALTER TABLE "JobTarget"
ADD COLUMN "resumeId" TEXT;

CREATE INDEX "JobTarget_userId_resumeId_updatedAt_idx"
ON "JobTarget"("userId", "resumeId", "updatedAt");

ALTER TABLE "UserExperience"
ADD COLUMN "embedded" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GenerationSession"
ADD COLUMN "sourceResumeId" TEXT;
