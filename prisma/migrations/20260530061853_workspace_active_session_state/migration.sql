-- AlterTable
ALTER TABLE "ApplicationWorkspace" ADD COLUMN     "activeSessionId" TEXT,
ADD COLUMN     "currentStepIndex" INTEGER,
ADD COLUMN     "currentStepLabel" TEXT,
ADD COLUMN     "sessionState" JSONB,
ADD COLUMN     "stepHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "totalSteps" INTEGER;

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ipHash" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "extVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunnelEvent_type_occurredAt_idx" ON "FunnelEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_sessionId_idx" ON "FunnelEvent"("sessionId");

-- CreateIndex
CREATE INDEX "FunnelEvent_userId_occurredAt_idx" ON "FunnelEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExtensionEvent_userId_occurredAt_idx" ON "ExtensionEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExtensionEvent_type_occurredAt_idx" ON "ExtensionEvent"("type", "occurredAt");
