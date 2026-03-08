-- CreateTable
CREATE TABLE "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_externalId_key" ON "ChannelIdentity"("channel", "externalId");

-- CreateIndex
CREATE INDEX "ChannelIdentity_userId_idx" ON "ChannelIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelLinkToken_token_key" ON "ChannelLinkToken"("token");

-- CreateIndex
CREATE INDEX "ChannelLinkToken_userId_channel_createdAt_idx" ON "ChannelLinkToken"("userId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelLinkToken_channel_token_idx" ON "ChannelLinkToken"("channel", "token");
