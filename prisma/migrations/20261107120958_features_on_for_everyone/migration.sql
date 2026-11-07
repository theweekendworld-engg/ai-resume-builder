-- AlterTable
ALTER TABLE "FeatureFlag" ALTER COLUMN "enabled" SET DEFAULT true,
ALTER COLUMN "rolloutPercent" SET DEFAULT 100;

-- Launch: every feature on for every user (owner decision 2026-11-07).
-- Rows stay as kill switches; /admin can turn one off.
UPDATE "FeatureFlag" SET "enabled" = true, "rolloutPercent" = 100;
