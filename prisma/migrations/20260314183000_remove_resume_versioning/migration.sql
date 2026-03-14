ALTER TABLE "Resume"
DROP CONSTRAINT IF EXISTS "Resume_currentVersionId_fkey";

DROP INDEX IF EXISTS "Resume_currentVersionId_key";

ALTER TABLE "Resume"
DROP COLUMN IF EXISTS "currentVersionId";

DROP TABLE IF EXISTS "ResumeVersion";

DROP TYPE IF EXISTS "ResumeVersionSource";
