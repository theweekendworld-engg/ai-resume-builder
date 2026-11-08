-- Dodo Payments (Merchant of Record) beside Stripe, 2026-11-08.
--
-- Additive only. The provider-neutral field names in the Prisma schema
-- (`customerRef`, `subscriptionRef`) are @map'd onto the existing
-- "stripeCustomerId" / "stripeSubId" columns, so no column is renamed and no
-- data moves. Safe to deploy before any code reads the new columns.

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('stripe', 'dodo', 'admin_grant');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "provider" "SubscriptionProvider" NOT NULL DEFAULT 'stripe',
ADD COLUMN     "providerEventAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "customerRef" TEXT NOT NULL,
    "pendingCheckoutRef" TEXT,
    "pendingCheckoutKey" TEXT,
    "pendingCheckoutUrl" TEXT,
    "pendingCheckoutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_userId_provider_key" ON "BillingCustomer"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_provider_customerRef_key" ON "BillingCustomer"("provider", "customerRef");

-- CreateIndex
CREATE INDEX "BillingEvent_receivedAt_idx" ON "BillingEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_eventId_key" ON "BillingEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubId_idx" ON "Subscription"("stripeSubId");


-- Backfill: comped plans written from /admin carry an `admin_grant:` customer
-- id (src/actions/admin.ts). Every other existing row was written by Stripe and
-- keeps the column default.
UPDATE "Subscription" SET "provider" = 'admin_grant' WHERE "stripeCustomerId" LIKE 'admin\_grant:%';
