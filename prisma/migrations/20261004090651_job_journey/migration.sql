-- CreateEnum
CREATE TYPE "JobEmailKind" AS ENUM ('recruiter_outreach', 'application_received', 'interview_request', 'assessment', 'rejection', 'offer', 'scheduling', 'other_job', 'not_job');

-- CreateEnum
CREATE TYPE "JobEmailStatus" AS ENUM ('pending', 'processed', 'failed', 'ignored');

-- CreateEnum
CREATE TYPE "ApplicationEventKind" AS ENUM ('status_change', 'email', 'interview', 'follow_up_due', 'note');

-- CreateTable
CREATE TABLE "EmailInbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "forwardingCode" TEXT,
    "forwardingConfirmUrl" TEXT,
    "forwardingSeenAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "textBody" TEXT NOT NULL,
    "status" "JobEmailStatus" NOT NULL DEFAULT 'pending',
    "kind" "JobEmailKind",
    "summary" TEXT,
    "company" TEXT,
    "role" TEXT,
    "workspaceId" TEXT,
    "previousStatus" "ApplicationStatus",
    "appliedStatus" "ApplicationStatus",
    "draftSubject" TEXT,
    "draftBody" TEXT,
    "draftedAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ApplicationEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT NOT NULL,
    "refId" TEXT,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "scopes" TEXT[],
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT,
    "calendarSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailInbox_userId_key" ON "EmailInbox"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailInbox_token_key" ON "EmailInbox"("token");

-- CreateIndex
CREATE INDEX "JobEmail_userId_receivedAt_idx" ON "JobEmail"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "JobEmail_workspaceId_idx" ON "JobEmail"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "JobEmail_userId_messageId_key" ON "JobEmail"("userId", "messageId");

-- CreateIndex
CREATE INDEX "ApplicationEvent_userId_occurredAt_idx" ON "ApplicationEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_workspaceId_occurredAt_idx" ON "ApplicationEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEvent_workspaceId_kind_refId_key" ON "ApplicationEvent"("workspaceId", "kind", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConnection_userId_key" ON "GoogleConnection"("userId");

-- AddForeignKey
ALTER TABLE "JobEmail" ADD CONSTRAINT "JobEmail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ApplicationWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ApplicationWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
