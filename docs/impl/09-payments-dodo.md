# 09: Payments through Dodo Payments

Status: built and tested against doubles (2026-11-08), branch `payments`.
Migration `20261108120000_billing_provider_dodo`. Switched off for users: the
launch is still open (everything free), and only admins see checkout.

Owner decisions (2026-11-08): Dodo Payments is the provider, as Merchant of
Record (it handles tax, invoices and refunds, and onboards an individual in
India). Final prices come later. Until then the Dodo products are $1.00/month
TEST products, which is Dodo's subscription minimum. Users stay free until the
owner sets `ENTITLEMENT_LAUNCH_OPEN=false` after Dodo approves the account.

## 1. Owner checklist

### Before the first test purchase

1. **Sign up** at dodopayments.com as an **Individual**, with your PAN. Done.
2. **Create a TEST API key** (dashboard, test mode, Developer → API keys). Done:
   it is in the main checkout's `.env.local` as `DODO_PAYMENT_TEST_API_KEY`.
   The app reads `DODO_PAYMENTS_API_KEY` first and accepts
   `DODO_PAYMENT_TEST_API_KEY` as a fallback, **in test mode only**.
3. **Create two TEST subscription products at $1.00/month.** Done:
   - Career: `pdt_0NrTxDqepCJpadsXXk6aZ` ("Patronus Career (test)")
   - Search: `pdt_0NrTxDvj6LXvVtRzuRgOk` ("Patronus Search (test)")

   Both were read back from the test API: recurring, USD 100 cents, monthly,
   tax category `saas`, no trial.
4. **Add the webhook endpoint** in the TEST dashboard (Developer → Webhooks):
   `https://www.patronus.cv/api/dodo/webhook`. Subscribe to all
   `subscription.*` events (or all events; anything else is acknowledged and
   ignored). Copy its **signing secret** (`whsec_…`).
5. **Set the env vars in Vercel**, Production environment:

   | Name | Value |
   |---|---|
   | `DODO_PAYMENTS_API_KEY` | the TEST API key (or keep it as `DODO_PAYMENT_TEST_API_KEY`) |
   | `DODO_PAYMENTS_WEBHOOK_KEY` | the webhook signing secret from step 4 |
   | `DODO_PRODUCT_CAREER` | `pdt_0NrTxDqepCJpadsXXk6aZ` |
   | `DODO_PRODUCT_SEARCH` | `pdt_0NrTxDvj6LXvVtRzuRgOk` |
   | `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` |
   | `ADMIN_USER_IDS` | already set; your Clerk user id must be in it |

   Leave `ENTITLEMENT_LAUNCH_OPEN` unset. Do not give Preview deployments
   these keys: previews share the production database, and the webhook points
   at production anyway.
6. **Deploy.** Production deploys run `prisma migrate deploy`, which applies
   the migration (additive; it moves no data). `/admin/ops` → Billing should
   then read `Provider dodo · test`, `Checkout admins only (launch open)`, and
   the `dodo` config check should be gone from Config health.

### Running a test purchase as admin

1. Sign in with an admin account and open `/settings/plan`. You will see an
   **Admin preview** banner ("Test mode: no real card is charged") and the
   paid plans. Everyone else still sees "Free while we launch".
2. Click **Career**. The button shows the catalog's display price ($5/month);
   Dodo charges the product's price ($1.00). See §4 for why these differ.
3. Pay on Dodo's test checkout with a test card from Dodo's docs (Testing →
   test cards). Not verified here: the usual success card is
   `4242 4242 4242 4242`, any future expiry, any CVC.
4. You land on `/settings/plan?checkout=dodo&subscription_id=…&status=active`
   and should read "You're on Career. Thank you." with "Renews <date>".
5. Check `/admin/ops` → Billing: webhook deliveries counted, none ignored. If a
   delivery was ignored, `BillingEvent.outcome` says why (`ignored:no_user`,
   `ignored:unknown_product`, …).
6. Try the rest: **Update payment and invoices** opens Dodo's customer portal;
   **Cancel** sets cancel-at-period-end ("Ends <date>"); add **Search** and turn
   it off and back on.
7. Report back what Dodo actually sent (§6 lists what is still assumed). The
   webhook logs in the Dodo dashboard show each payload.

A comped plan (`/admin/<userId>` → Grant plan) does not block a test purchase:
the paid row replaces the comp in that slot.

### Going live

1. Dodo approves the account (KYC).
2. In **live** mode: create a live API key, the two live products at the final
   prices, and a live webhook endpoint (same URL) with its own signing secret.
3. Update the display prices in `src/lib/plans.ts` to match (§4), and deploy.
4. In Vercel Production set `DODO_PAYMENTS_API_KEY` (live key),
   `DODO_PAYMENTS_WEBHOOK_KEY` (live secret), the two live product ids, and
   `DODO_PAYMENTS_ENVIRONMENT=live_mode`. `DODO_PAYMENT_TEST_API_KEY` is ignored
   in live mode, so it cannot be used by mistake.
5. Set `ENTITLEMENT_LAUNCH_OPEN=false` and redeploy. Checkout appears for
   everyone and the paid packaging in `plans.ts` is enforced. `/admin/ops`
   raises `paid_plans_without_checkout` (an error) if the launch is closed
   while no provider can take money.
6. Before live, look at `mandate_min_amount_inr_paise` on checkout sessions
   (SDK field, not set by this code). For Indian cards on recurring plans Dodo
   authorises an e-mandate up to that ceiling, ₹15,000 by default; customers
   see that figure.

## 2. Design as built

**Provider selection** (`src/lib/billing/provider.ts`). `billingProvider()`
returns `dodo` when `dodoConfigured()` (API key, webhook key, both product
ids), else Stripe, else Razorpay. `CHECKOUT_IMPLEMENTED` has `dodo` and
`stripe`. `dodoEnvironment()` is `test_mode` unless the variable is exactly
`live_mode`; the SDK's own default is live, so unset or mistyped never charges
real cards. `dodoKeyConfigured()` (the key alone) is enough to manage an
existing subscription.

**Client** (`src/lib/dodo.ts`). `getDodo()` builds the SDK client with the
environment above. `DodoClient` is the slice of the SDK the app calls,
written as plain promises of the SDK's own types; the real client is assigned
to it, so an SDK upgrade that changes a signature fails the type-check. The
test seam is `__setDodoClientForTests`; the double is `src/__mocks__/dodo.ts`.

**Schema.** Additive, and no data moves:

- `Subscription.provider` (`SubscriptionProvider` enum: `stripe | dodo |
  admin_grant`, default `stripe`). The migration backfills `admin_grant` for
  rows whose customer id starts with `admin_grant:`.
- `Subscription.customerRef` and `subscriptionRef`: provider-neutral names
  `@map`ped onto the existing `stripeCustomerId` / `stripeSubId` columns. Every
  code reference was renamed; Stripe paths read and write the same columns.
- `Subscription.providerEventAt`: the timestamp of the webhook event that
  produced the row. An older event never overwrites it.
- `BillingCustomer(userId, provider, customerRef, pendingCheckout*)`, unique on
  `(userId, provider)` and `(provider, customerRef)`. The Dodo customer is
  created and stored when the user first starts checkout, before any payment.
- `BillingEvent(provider, eventId, type, outcome)`, unique on
  `(provider, eventId)`: webhook idempotency.

Admin grants now write `provider = admin_grant`; Stripe writes
`provider = stripe`, and Stripe lookups are scoped to Stripe rows (Dodo
customer ids also start with `cus_`).

**Plans** (`src/lib/plans.ts`). Each catalog price carries `dodoEnvVar`
(`DODO_PRODUCT_CAREER`, `DODO_PRODUCT_SEARCH`). `priceKeyForDodoProduct()`
maps a product back to its price, and tier and slot are read from the catalog
entry that holds the price. The two-slot model (Career, plus Search on top) is
unchanged.

**Checkout** (`startCheckout` → `createDodoCheckout`). Order: Clerk auth →
plan key check → launch gate (`checkoutOfferedTo`: a provider can sell, and the
launch is over or the user is an admin) → Search requires Career → a slot
already paid for is refused (a comp does not count) → Dodo customer
(created once, stored) → `checkoutSessions.create` with
`product_cart: [{ product_id, quantity: 1 }]`, `customer: { customer_id }`,
`metadata: { userId, slot, priceKey }`, `return_url
${APP_URL}/settings/plan?checkout=dodo`, `cancel_url …?checkout=cancelled` →
the session id and URL are stored on `BillingCustomer` → `checkout_started`.
Dodo has no idempotency key, so a second click for the same plan within the
hour gets the same session back.

**Return redirect** (`/settings/plan` → `reconcileDodoCheckout`). Dodo appends
`subscription_id` and `status` to the return URL; it has no session-id
placeholder. Both are hints. The reconcile retrieves the subscription from
Dodo with our key, requires its customer to be this user's stored Dodo
customer, and applies it through the same function the webhook uses. With no
`subscription_id`, it follows the stored session: session → `payment_id` →
payment → subscription. An unpaid session grants nothing. If Dodo appends its
parameters with a second `?`, the page parses them out of `checkout`.

**Webhook** (`src/app/api/dodo/webhook/route.ts`, logic in
`src/lib/billing/dodoSync.ts`). Raw body → `standardwebhooks`
`Webhook(DODO_PAYMENTS_WEBHOOK_KEY).verify` (HMAC plus a five-minute timestamp
window) → insert `BillingEvent(dodo, webhook-id)`; a unique violation means
duplicate, answered 200 → map the event → record the outcome → 200. If
applying throws, the `BillingEvent` row is deleted, operators get a Telegram
alert (`alertOperators`, no user content), and the route answers 500 so Dodo
retries. Unknown event types get 200 and are ignored. The route is in
`src/proxy.ts`'s self-authenticated list and is not rate-limited.

User resolution, most reliable first: a row this subscription already wrote →
the stored `BillingCustomer` for `customer.customer_id` → `userId` in the
subscription's metadata, then in the customer's metadata (both set by us, and
inside a signed payload).

Writes go through a conditional `updateMany` (`providerEventAt <= eventAt`) for
the same subscription, so a late retry cannot undo newer state. A late
non-granting event for an older Dodo subscription does not end a newer live
one in the same slot (`ignored:superseded`). Funnel events: `plan_changed` on
any tier or status change (with `provider: dodo`), and `checkout_completed`
once each time a subscription starts granting access.

**Managing** (`src/actions/billing.ts`, by the row's `provider`):

| Action | Dodo call |
|---|---|
| `cancelPlan` | `subscriptions.update(id, { cancel_at_next_billing_date: true })`, row → `canceling` |
| `turnOffSearch` / `reactivateSearch` | same flag on the Search subscription, `true` / `false` |
| `createBillingPortalSession` | `customers.customerPortal.create(customer_id, { return_url })` → `link` |
| `requestRefund` | `payments.list({ subscription_id, status: 'succeeded' })` → `refunds.create({ payment_id })` → `subscriptions.update(id, { status: 'cancelled' })` |

`requestRefund` is only reachable inside the annual 14-day window, and no
annual price exists, so today it is wired and tested but not shown. Admin
grants touch no provider. Stripe rows keep the Stripe code paths. If Dodo is
unreachable the action returns plain copy and logs the provider's message.

**Launch switch.** `getPlanPageData` returns `billingConfigured =
checkoutOfferedTo(user)`, plus `adminCheckoutPreview` and `checkoutTestMode`.
Members during the launch see "Free while we launch" and no prices. Admins see
the paid plans under a banner. `startCheckout` enforces the same gate, since
the page is not where money is taken.

**Health** (`src/lib/health.ts`, `/admin/ops`). Check `dodo` (warn) lists the
missing variable names and the mode. `payments` counts Dodo. A new error,
`paid_plans_without_checkout`, fires when the launch is closed and nothing can
sell. `/admin/ops` has a Billing section: provider and mode, who sees
checkout, webhook deliveries in the window (and how many were ignored), and
the last delivery time.

## 3. Event → state

`next_billing_date` is the period end. Statuses in **bold** grant access.

| Dodo event (payload status) | Row status | `currentPeriodEnd` |
|---|---|---|
| `subscription.active`, `.renewed`, `.plan_changed`, `.updated`, `.unpaused` (`active`) | **active** | `next_billing_date`; tier from `product_id` |
| any of the above with `cancel_at_next_billing_date: true` | **canceling** | `next_billing_date` |
| `subscription.past_due` (`past_due`) | **past_due** | `past_due_ends_at`; else a grace end already parked; else now + 14 days |
| `subscription.on_hold` (`on_hold`) | **past_due** | same rule. A second failure never extends the grace |
| `subscription.cancelled`, `cancel_at_next_billing_date` and the period still ahead | **canceling** | `next_billing_date` |
| `subscription.cancelled`, otherwise | canceled | `cancelled_at` or now |
| `subscription.failed`, `subscription.expired` (whatever the status) | canceled | `cancelled_at` or now |
| `subscription.paused` (`paused`) | paused | `next_billing_date` |
| `pending` | incomplete | `next_billing_date` |
| product not in the catalog | ignored (`unknown_product`); an existing row for that subscription is kept at tier Free | — |
| any other event type | ignored, 200 | — |

The grace rule is the Stripe one (PRD 06 §5.5, `GRACE_PERIOD_DAYS = 14`),
parked in `currentPeriodEnd` so the ordinary period check closes it with no
cron.

## 4. Display prices are not charged amounts

`PlanPrice.amountCents` and `label` in `plans.ts` are what the UI says. What a
customer pays is the Dodo product's price: checkout sends only a product id.
While the $1 TEST products are in use, the plan page still shows $5 and $2. A
price change takes both halves: the product in the Dodo dashboard (or a new
product with the env var pointed at it), and the label in `plans.ts`.

**Adding a single "Pro" plan later** is configuration. Add a price to the
plan's `prices` in `PLAN_CATALOG` with its own `dodoEnvVar` (say
`DODO_PRODUCT_PRO`), add its key to the `PriceKey` union, and set the env
var. Checkout, webhook and reconcile resolve product → price → tier and slot
from the catalog. Moving an existing subscriber between products would use
`subscriptions.changePlan` with `proration_billing_mode:
'prorated_immediately'`. That is not wired: the two-slot model never changes
plans in place. The webhook already handles `subscription.plan_changed`.

## 5. Tests

- `src/lib/billing/provider.test.ts`: provider precedence, half configs, mode
  default, test-key fallback only in test mode.
- `src/lib/billing/dodoSync.test.ts`: every cell of §3 as a pure function.
- `src/lib/billing/dodoWebhook.integration.test.ts` (live Postgres, real
  signatures): 503 with no key, 400 on missing headers, forged signature and a
  replay outside the window; activation via stored customer and via metadata;
  the same `webhook-id` applied once; unattributable, unknown-type and
  unknown-product deliveries ignored; Search slot; paid replaces comp; a full
  lifecycle (cancel at period end, un-cancel, renew, past_due, on_hold without
  extension, recovery, pause, unpause, immediate cancel); failed and expired;
  out-of-order and superseded events; a failed apply answers 500 and the retry
  applies.
- `src/actions/billing.dodo.integration.test.ts`: checkout (customer first,
  product only, metadata, return URL, stored session, funnel event), reuse
  within the hour, Search reuses the customer and needs Career, no double sale,
  provider errors as values; launch gate for members and admins, admin buying
  over a comp, live mode; cancel at period end; Search off and on; portal;
  comp has no portal; refund and refund with no payment; return reconcile by
  URL and by stored session, someone else's subscription refused, unpaid
  pending, malformed id refused.
- `PlanScreen.test.tsx`: admin banner in test and live mode; members during
  the launch see no banner and no buy button.
- `src/lib/billing/proxyAllowList.test.ts`: the route is allow-listed and not
  rate-limited.
- Stripe paths: `billing.integration.test.ts` (now pinned to launch-closed for
  checkout, plus the launch gate and no-double-sale) and the J4 money-loop
  journey pass unchanged in behaviour.

## 6. Verified vs assumed

**Verified against the live TEST API (2026-11-08)**, read-only plus harmless
calls: one test customer (`patronus-sdk-verify@example.com`) and one unpaid
checkout session were created.

- `new DodoPayments({ bearerToken, environment: 'test_mode' })` authenticates
  with the owner's test key against `https://test.dodopayments.com`.
- `products.retrieve` returns both products as recurring $1.00/month USD.
- `customers.create({ email, name, metadata })` returns `customer_id`
  (`cus_…`). `customers.list({ email })` filters.
- `checkoutSessions.create` with `customer: { customer_id }`, `metadata`, and a
  `return_url` that already has a query string returns `{ session_id: 'cks_…',
  checkout_url: 'https://test.checkout.dodopayments.com/session/cks_…' }`.
- `checkoutSessions.retrieve` on an unpaid session returns
  `payment_id: null, payment_status: null`.
- `customers.customerPortal.create(customer_id, { return_url })` returns
  `{ link }` on `test.customer.dodopayments.com`.
- `payments.list({ subscription_id, status, page_size })` accepts those filters.
- `subscriptions.retrieve`, `subscriptions.update({ cancel_at_next_billing_date })`
  and `refunds.create({ payment_id })` exist and answer 404 `NotFoundError` for
  unknown ids. Error messages are long, so the UI shows plain copy and the
  log keeps the provider's message.

**Verified in the SDK types only** (`dodopayments` 2.61.1): the webhook union
and the subscription payload fields (`subscription_id`, `status`, `product_id`,
`next_billing_date`, `cancel_at_next_billing_date`, `customer.customer_id`,
`metadata`, `cancelled_at`, `past_due_ends_at`, and `payment_id` on renewals);
`SubscriptionStatus`; `Payment.subscription_id` / `subscription_ids`;
`changePlan` and its proration modes. The SDK defaults to `live_mode`, which
is why this code always passes the environment.

**Assumed, not yet seen live.** The owner's first test purchase settles all of
these:

- That Dodo sends the subscription events for a checkout, with these payload
  shapes, and that the event `timestamp` is the event time rather than the
  delivery time.
- **Whether checkout `metadata` is copied onto the subscription.** Dodo's docs
  do not say. The code does not depend on it: the user is resolved from the
  stored customer id first.
- That the return redirect appends `subscription_id` and `status` (docs say
  so), and how it joins them to a URL that already has `?checkout=dodo`. Both
  the `&` and the `?` forms are handled.
- Whether setting `cancel_at_next_billing_date` emits `subscription.updated`
  right away, and whether `subscription.cancelled` then fires at the period
  end. Either order maps correctly.
- That `on_hold` follows the end of a `past_due` window, and that
  `past_due_ends_at` is empty by then.
- That `payments.list` returns the newest payments first. The code sorts by
  `created_at` anyway.
- The test card number.
