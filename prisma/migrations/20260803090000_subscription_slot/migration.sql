-- Subscription.slot — replaces the `${userId}::search` row-key convention.
--
-- Order is load-bearing. The unique index on `userId` must go BEFORE the
-- backfill: stripping the suffix turns `alice::search` into `alice`, which
-- collides with alice's existing Career row while that index still stands.

-- CreateEnum
CREATE TYPE "SubscriptionSlot" AS ENUM ('career', 'search');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "slot" "SubscriptionSlot" NOT NULL DEFAULT 'career';

-- DropIndex  (must precede the backfill — see above)
DROP INDEX "Subscription_userId_key";

-- Backfill: every suffixed row becomes a real userId plus slot='search'.
UPDATE "Subscription"
SET    "slot"   = 'search',
       "userId" = left("userId", length("userId") - length('::search'))
WHERE  "userId" LIKE '%::search';

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_slot_key" ON "Subscription"("userId", "slot");
