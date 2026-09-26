-- CreateTable
CREATE TABLE "ChannelMessageReceipt" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessageReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelMessageReceipt_createdAt_idx" ON "ChannelMessageReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessageReceipt_channel_externalId_key" ON "ChannelMessageReceipt"("channel", "externalId");
