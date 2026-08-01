# PRD 06 — Packaging, Pricing & Entitlements

> **Status:** `Draft for build` · **Release:** R1.6 (packaging + soft paywall), R2 (public launch) · **Persona:** all
> **Depends on:** existing `Subscription`, `UsageQuota`, `src/lib/entitlements.ts`, `src/lib/stripe.ts`, `src/actions/billing.ts` — **all already built.** This PRD changes the *packaging*, not the plumbing.

---

## 1. The pricing thesis

Two facts about this market drive every decision below:

1. **Job search is episodic.** A hunt lasts 6–12 weeks and then stops. Any plan priced for hunt intensity will be cancelled the week someone gets hired. Fighting this loses.
2. **Career maintenance is permanent.** Reviews, promos, market drift, and the log run forever, at low intensity.

So: **two products, deliberately different in churn posture.**

| | Career | Search |
|---|---|---|
| Priced | **Annually** | **Monthly** |
| Designed to be | Forgotten about | Switched off |
| Cancel friction | Low (but rarely triggered) | **Zero — we volunteer it** |
| Where LTV comes from | ✔ | Spikes |

The counter-intuitive move is making Search trivially cancellable and *reminding people to cancel it*. A user who trusts that they can leave will come back for their next hunt, and keeps paying for Career in between. Retention theater — dark-pattern cancel flows, guilt modals — would poison the one relationship that actually compounds.

---

## 2. The plans

### 2.1 Catalog

| | **Free** | **Career** | **Search** |
|---|---|---|---|
| **Price** | $0 | **$99/year** (or $15/mo) | **$29/month** |
| **Positioning** | "Keep a record" | "Stay ready" | "Run the hunt" |
| **Buyer** | Anyone | Maya (employed) | Dev (hunting) |
| Work log capture | ✓ | ✓ | ✓ |
| Log history | 90 days visible | Unlimited | Unlimited |
| Connected sources | 1 | 3 | 3 |
| Weekly digest | ✓ | ✓ | ✓ |
| Month in Review | ✗ | ✓ | ✓ |
| Review packets | 1 lifetime (brag doc) | 4/period | 4/period |
| Rubric mapping + readiness | ✗ | ✓ | ✓ |
| 1:1 prep | ✗ | ✓ | ✓ |
| Career Radar | teaser | ✓ | ✓ + on-demand |
| Master resume | 1 | 3 | Unlimited |
| Tailored generations | 3/month | 15/month | Unlimited |
| ATS score & fix | score only | ✓ | ✓ + auto-fix |
| Extension fit-score | ✓ | ✓ | ✓ |
| Extension autofill | ✓ | ✓ | ✓ |
| Multi-step apply orchestration | ✗ | ✗ | ✓ |
| Cover letters / outreach | ✗ | 3/month | Unlimited |
| Interview prep | ✗ | ✗ | ✓ |
| Negotiation mission (M4) | ✗ | ✗ | ✓ |
| Missions | M7 | M1, M3, M5, M6, M7 | All |
| Full export | ✓ | ✓ | ✓ |
| Support | Docs | Email, 2 business days | Email, 1 business day |

**Search is additive, not a replacement.** A Search subscriber has Career included. Internally: `Search = Career + hunt features`. This matters for the downgrade path — turning Search off leaves Career intact rather than dropping the user to Free.

### 2.2 Why these numbers

- **$99/year** ≈ $8.25/mo, below the monthly-consideration threshold where people re-evaluate, and it's a single decision per year made at a moment of intent. Annual also survives the "I got hired" churn event that kills monthly career products. (00 D3: launch at $99, grandfather cohort 1, revisit for cohort 2.)
- **$15/mo** monthly Career exists only to make annual look correct. Expect <15% of Career subscribers on monthly, and that's the design intent.
- **$29/mo** for Search sits under Jobscan ($49) and Final Round (~$96) while doing more, and is trivially justified against a single salary increment.
- **Career + Search together = $128 first year**, which is a rounding error against the outcome. Don't over-engineer the bundling math; the pricing page just says "$29/mo on top, while you're looking."

### 2.3 What stays free forever
ATS score, one master resume, manual export, extension fit-score and autofill, **and the work log capture loop with 90-day history.**

Gating capture would starve the graph — the asset. Free users generate the data that makes the product better and become Career subscribers at their next review cycle. Say the quiet part in the pricing page: *"Logging is free forever. We charge for what we do with it."*

---

## 3. Implementation against the existing code

The billing infrastructure exists. This is a **packaging** change, and the guiding rule is: **do not migrate the `Tier` enum on a live billing table.**

### 3.1 Tier mapping (00 D4 — decided)

| `Tier` enum value (unchanged) | Product name | Stripe prices |
|---|---|---|
| `free` | Free | — |
| `always_on` | **Career** | `career_annual`, `career_monthly` |
| `pro` | **Search** | `search_monthly` |
| `team` | Teams | (R3) |

Add `src/lib/plans.ts`:

```ts
export const PLAN_CATALOG = {
  [Tier.free]:      { name: 'Free',   blurb: 'Keep a record',  order: 0, prices: [] },
  [Tier.always_on]: { name: 'Career', blurb: 'Stay ready',     order: 1,
                      prices: [{ id: env.STRIPE_PRICE_CAREER_ANNUAL,  interval: 'year',  amount: 9900 },
                               { id: env.STRIPE_PRICE_CAREER_MONTHLY, interval: 'month', amount: 1500 }] },
  [Tier.pro]:       { name: 'Search', blurb: 'Run the hunt',   order: 2,
                      prices: [{ id: env.STRIPE_PRICE_SEARCH_MONTHLY, interval: 'month', amount: 2900 }] },
  [Tier.team]:      { name: 'Teams',  blurb: 'For coaches',    order: 3, prices: [] },
} as const;
```

**Never render a raw enum value in the UI.** All display goes through `PLAN_CATALOG`. One grep-able rule.

### 3.2 Extending `MeteredAction`

Current: `tailored_generation | auto_apply | context_interview | tier2_grounding`. Add:

```ts
| 'win_draft'        // 01 §10
| 'month_in_review'  // 01 §10
| 'review_packet'    // 03 §8
| 'rubric_upload'    // 03 §8
| 'radar_refresh'    // 04 §9
| 'cover_letter'
```

And extend `planLimits()` accordingly. Every new limit must be env-overridable following the existing `freeTailoredLimit()` pattern, so we can tune without a deploy.

### 3.3 Non-metered plan attributes

Some gates aren't counters (history depth, source count, feature on/off). These don't belong in `UsageQuota`. Add a sibling to the entitlement module:

```ts
export type PlanFeature =
  | 'log_history_unlimited' | 'month_in_review' | 'rubric_mapping'
  | 'radar_full' | 'one_on_one_prep' | 'apply_orchestration'
  | 'interview_prep' | 'negotiation_mission';

export function hasFeature(tier: Tier, feature: PlanFeature): boolean
export async function requireFeature(userId, feature): Promise<void>  // throws EntitlementError
```

Keep `PLAN_FEATURES` as one flat table in `plans.ts`. Feature checks are synchronous once the tier is resolved — do not add a DB round trip per check.

### 3.4 Numeric limits
`sourceLimit(tier)`, `logHistoryDays(tier)`, `masterResumeLimit(tier)` — same table, same module. Never inline a number at a call site.

---

## 4. Paywall moments

A paywall converts when it appears at peak intent, shows the user's *own* data, and states a specific price. Every one below satisfies all three.

| # | Trigger | Surface | Copy (spec) |
|---|---|---|---|
| **PW1** | Free user finishes their brag doc and scrolls to the greyed competency section | Inline, in-document | *"You have 47 wins and no gaps analysis. See what's missing for Staff — Career, $99/year."* |
| **PW2** | Free user's log hits 90 days | Log surface, non-blocking | *"+41 older wins are saved but hidden. Unlock your full record."* — **never** "your data will be deleted" |
| **PW3** | Free user hits 3 tailored generations | Generation flow, at submit | *"You've used your 3 free tailored resumes. The next role you actually care about — let's make it perfect."* (existing v2 copy, keep it) |
| **PW4** | Radar band delta ≥12% or a ≥90% match | Monthly digest + `/radar` | *"Want to test the market? Turn Search on for a month — $29, off whenever you stop."* |
| **PW5** | Career user starts M2 (land a new role) | Mission start | *"This mission uses unlimited tailoring and apply automation. Add Search — $29/mo, cancel any time."* |
| **PW6** | T-90 review nudge for a Free user | Email | *"Your review is 3 months out. Here's the one gap worth working on — [see it]"* → PW1 |
| **PW7** | Free user tries to connect a 2nd source | Settings | *"Career connects up to 3 sources — GitHub, calendar, and your tracker."* |

**Anti-patterns, banned:** countdown timers, "limited offer," fake scarcity, interstitials before a user has produced value, paywalls that appear before the user has any data of their own to show.

**Soft mode (R1.6 → R2):** `ENTITLEMENTS_ENFORCE=false` in production during R1. Paywalls **render** but the action still completes, with a "you're over your limit — we're not enforcing this yet, but we will" note. This is Trap-1 mitigation from the master plan: accumulate real per-feature usage before turning enforcement on, and never surprise an existing user.

---

## 5. Lifecycle flows

### 5.1 Upgrade
Stripe Checkout (already built). On `checkout.session.completed`, set tier + `currentPeriodEnd`. **Grant entitlements optimistically on redirect** and reconcile on webhook — a user who just paid must not wait on a webhook. Guard with an idempotency key.

### 5.2 Adding Search on top of Career
Stripe: a second subscription item, or a separate subscription — **use a separate subscription.** Simpler proration, independent cancellation, and it matches the mental model ("turn Search off"). Effective tier = `max(order)` across active subscriptions.

### 5.3 Turning Search off — the trust-building flow

**We proactively offer this.** Triggers:
- User marks an `ApplicationWorkspace` as `offer` or `accepted`
- User completes M2 with outcome "hired"
- No apply/tailor activity for 30 days on a Search subscription

```
  Congratulations. 🎉

  You don't need Search any more — want us to turn it off?
  Your Career plan keeps everything: your log, your record,
  your packets, and Radar.

  [ Turn off Search ]        [ Keep it for now ]

  You can turn it back on in one click whenever you need it.
```

Cancels at period end (never mid-period; they paid for it). Sets a `winBack` flag so the next hunt's re-activation is one click with their config preserved.

**Measure this.** `proactive_downgrade_offered → accepted` and 12-month reactivation rate of users who accepted. The bet is that volunteering the downgrade *increases* lifetime revenue. If it doesn't, we'll know — but we ship it either way, because it's the honest thing and it's the product's whole posture.

### 5.4 Downgrade / cancellation of Career
- Effective at period end.
- **No data deletion, ever.** Wins beyond 90 days become hidden, not deleted, and the UI says so explicitly.
- Export offered in the cancel flow, unconditionally, with no attempt to use it as a retention lever.
- One optional question: "what changed?" — five options plus free text. Skippable in one click.
- **No retention modal, no discount ambush, no "are you sure" chain.** One confirm.

### 5.5 Failed payment
`invoice.payment_failed` → `status = past_due`. Grace period **14 days** with full access (a card expiring is not a churn decision). In-app banner + two emails (day 1, day 10). At day 14 → `canceled`, drop to Free, data intact.

### 5.6 Refunds
14-day no-questions refund on annual Career, self-serve from billing settings. The support cost of a manual policy exceeds the refund cost, and the trust dividend is real.

### 5.7 Grandfathering
`Subscription.metadata.priceLockedUntil`. Cohort-1 annual subscribers keep $99 for **3 renewal cycles**. Any price change notifies 30 days ahead. Never silently reprice.

---

## 6. Billing settings surface

`/settings/plan`:
- Current plan(s), renewal date, amount, next charge
- **Usage against limits, always visible** — *"Tailored resumes: 4 of 15 this period"* with a reset date. Users should never be surprised by a limit.
- Change plan · Turn off Search · Update payment (Stripe portal) · Invoices
- **Export everything** — placed here deliberately, on the page where someone considers leaving
- Cancel, one click away, not buried

---

## 7. Telemetry

| Event | Payload |
|---|---|
| `paywall_shown` | `{code: 'PW1'..'PW7', tier, feature, hasOwnData: bool}` |
| `paywall_cta_clicked` | `{code, targetTier}` |
| `checkout_started` / `completed` / `abandoned` | `{tier, interval, amount}` |
| `plan_changed` | `{from, to, reason: 'upgrade'\|'downgrade'\|'proactive'\|'failed_payment'}` |
| `proactive_downgrade_offered` / `accepted` / `declined` | `{trigger}` |
| `search_reactivated` | `{daysSinceOff}` ← **the thesis metric for §1** |
| `cancel_flow_entered` / `completed` | `{tier, reason, exportedFirst: bool}` |
| `quota_exhausted` | `{action, tier}` |
| `entitlement_soft_allowed` | `{action, tier, overBy}` ← soft-mode instrumentation |

**Report weekly:** paywall conversion by code (kill any below 2%), Career annual retention, Search attach rate, and reactivation rate.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| User on Career monthly upgrades to annual | Prorate via Stripe; extend `currentPeriodEnd` |
| Search active, Career expires | Search implies Career features — resolve effective tier by max order, don't strip capability |
| Chargeback | Immediate downgrade to Free, data intact, account flagged, no auto-ban |
| Quota consumed but the action failed | `gateMeteredAction` runs at entry; **refund the unit on a terminal failure.** Add `refundMeteredAction(userId, action)` — this is missing today and users will notice. |
| Clock skew across period boundary | `getCurrentBillingPeriod()` is the single source of truth (already exists); never compute periods inline |
| User in a currency Stripe doesn't support locally | USD default; localized pricing is R3 |
| Free user with 400 wins | All retained, 90 days visible, count shown. Never delete. |
| Two devices upgrade simultaneously | Stripe idempotency key on checkout session creation |
| Enforcement flips on with users over quota | On the flip date, reset all `UsageQuota.used` to 0 and email affected users a week before. Nobody wakes up locked out. |

---

## 9. Acceptance criteria

- [ ] No raw `Tier` enum value is rendered anywhere in the UI (grep gate in CI)
- [ ] All limits resolve through `plans.ts`; no numeric limit literal at a call site (lint rule or review gate)
- [ ] `hasFeature` adds zero DB queries beyond the existing tier resolution
- [ ] Adding Search to an active Career account creates a second Stripe subscription; effective tier resolves to `pro`
- [ ] Turning Search off preserves Career; verified end to end
- [ ] Proactive downgrade fires within 24h of an `offer` status change
- [ ] Cancelling never deletes a Win, an Evidence row, or a packet — asserted in an integration test
- [ ] Export is reachable in ≤2 clicks from the cancel flow
- [ ] Soft mode records `entitlement_soft_allowed` and does not block
- [ ] Failed payment retains full access for exactly 14 days
- [ ] Every paywall shows the user's real data (win count, gap name, band `n`)
- [ ] Usage vs. limits visible on `/settings/plan` for every metered action
- [ ] `refundMeteredAction` restores the unit when a generation fails terminally

---

## 10. Out of scope

Team/seat billing · usage-based overage pricing · regional pricing · coupons and referral credits · one-off purchases (the negotiation unlock idea from 05 §M4 is noted, not built) · in-app purchase on mobile.
