-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('get_promoted', 'land_new_role', 'switch_domain', 'negotiate_offer', 'ic_to_manager', 'return_from_break', 'keep_warm');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('proposed', 'active', 'paused', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "MissionStepStatus" AS ENUM ('pending', 'active', 'done', 'skipped', 'blocked');

-- CreateEnum
CREATE TYPE "MissionStepKind" AS ENUM ('automatic', 'threshold', 'attested');

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MissionType" NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'proposed',
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionStep" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "MissionStepKind" NOT NULL,
    "status" "MissionStepStatus" NOT NULL DEFAULT 'pending',
    "condition" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedReason" TEXT,

    CONSTRAINT "MissionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mission_userId_status_updatedAt_idx" ON "Mission"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "MissionStep_missionId_order_idx" ON "MissionStep"("missionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MissionStep_missionId_key_key" ON "MissionStep"("missionId", "key");

-- AddForeignKey
ALTER TABLE "MissionStep" ADD CONSTRAINT "MissionStep_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
