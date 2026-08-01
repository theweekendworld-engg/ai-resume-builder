# Implementation 00 — Architecture Decisions & Shared Primitives

> **Status:** `Decided` · **Date:** 2026-08-01 · **Audience:** the engineers building R1
> **Posture:** validation stage. **Optimize for quality of experience and speed of learning. Do not optimize for scale.**
> **Companion docs:** [`01-phase-0-foundation.md`](01-phase-0-foundation.md) · [`02-phase-plan.md`](02-phase-plan.md) · PRDs in [`../prd/`](../prd/)

---

## 0. The operating constraint

We are validating whether people will keep a work log and pay for what it produces. Everything below follows from three rules:

1. **No new infrastructure unless a feature is impossible without it.** Each new service is a bill, a secret, an outage surface, and a thing to learn. At <1,000 users, Postgres does what a queue service does.
2. **Quality of the user-visible surface is the priority.** Draft accept rate, digest confirm time, and packet usefulness are the metrics. Infra elegance is not.
3. **Every shortcut must be a shortcut we can reverse.** Cheap now is fine; cornered later is not. Each ADR below names its exit path.

**Current stack (all retained, nothing replaced):** Next.js 16 · React 19 · Bun 1.3 · Prisma 6 / Postgres (Supabase) · Qdrant · Clerk · Vercel Blob · Upstash Redis (rate limit) · Stripe · `workflow` SDK · AI SDK 6 + OpenAI.

**Total new third-party services in R1: one** (transactional email).

---

## ADR-1 — Background work: two tiers, no queue service

**Context.** R1 needs background execution for connector syncs, weekly digests, monthly reviews, packet generation, embedding, and Radar. Today only user-initiated generation runs in the background, via the `workflow` SDK (`src/lib/generationQueue.ts`, with a `setTimeout` inline path in dev).

**Options considered**
| Option | Verdict |
|---|---|
| Inngest / Trigger.dev / QStash | Rejected — a new bill, a new dashboard, a new failure mode, for a problem Postgres solves at this scale |
| `workflow` SDK for everything | Rejected for scheduled fan-out — it's built for one durable run, not for "do a thing for 800 users on a schedule" |
| Postgres job table + cron drain | **Chosen** for scheduled work |

**Decision — two tiers:**

| Tier | Use for | Mechanism |
|---|---|---|
| **A. Durable run** | User-initiated, long, resumable, progress visible to the user | Existing `workflow` SDK — resume generation (built), **review packet generation** (new) |
| **B. Job table** | Scheduled fan-out, connector syncs, embedding, anything the user isn't watching | New `Job` table + one hourly cron that drains it |

**Why a job table is right here:** it is inspectable with SQL (a table you can query beats a dashboard you can't), trivially idempotent via unique keys, costs nothing, and gives per-job cost/latency/error history for free — which we need anyway for the cost tripwires in PRD 08 §4.3.

**Exit path.** The `enqueue()` / handler-registry interface (§P-1) is deliberately transport-agnostic. Swapping the drain for QStash or Inngest later changes one file and zero handlers.

---

## ADR-2 — One cron, bounded drain

**Context.** Vercel serverless functions have a hard max duration (60s Hobby, 300s Pro). Digest generation for 800 users cannot happen in one invocation. Vercel Hobby also restricts cron frequency to daily.

**Decision**
- **Exactly one cron entry:** `POST /api/cron/tick`, hourly. It is a dispatcher, not a worker.
- The tick handler runs a **bounded drain**: claim up to `JOB_BATCH_SIZE` (default 25) due jobs, process with concurrency 4, return. **It never loops until the queue is empty.** Leftover work is picked up by the next tick, or by a self-retrigger (below).
- **Self-retrigger:** if jobs remain and elapsed time is under budget, the handler fires a non-awaited `fetch` to itself before returning. Cheap horizontal drain without a worker process. Capped at 10 chained ticks to prevent runaway.
- **Time budget:** the handler stops claiming new work at 45s (Hobby) / 240s (Pro), read from `CRON_TIME_BUDGET_MS`.

**If on Vercel Hobby** (daily cron only): point a free external pinger (cron-job.org) at `/api/cron/tick` every 15 minutes with the shared secret. Documented in `.env.example`; costs nothing and removes the plan dependency.

**Auth:** `Authorization: Bearer ${CRON_SECRET}`, constant-time compare. Same pattern as the existing Telegram webhook secret check (`src/lib/telegram.ts:33`).

**Consequence for every handler:** must be *chunked and resumable*. A handler that needs 3 minutes is a handler that needs to become three jobs.

---

## ADR-3 — Scheduling is derived, not stored

**Context.** Weekly digests must fire at each user's local time. The naive design stores a "next run at" timestamp per user and updates it — which drifts, double-fires on retry, and is a pain to reason about.

**Decision.** The hourly tick **computes** who is due:

```
for each user with digestEnabled:
    localHour = hour in user's timezone right now
    if localHour == user.digestHour and localDay == user.digestDay:
        enqueue('weekly_digest', { userId, weekStart }, dedupeKey = `digest:${userId}:${weekStart}`)
```

Idempotency lives in the **unique dedupe key on `Job`**, plus the `@@unique([userId, weekStart])` on `WeeklyDigest`. A double-fired cron is a no-op at two independent layers.

**Timezone source:** `UserProfile.preferences.timezone`, captured on first app load from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Default `Etc/UTC`. Use `Intl` for conversion — **no date library.**

---

## ADR-4 — Email: Resend, hand-rolled HTML

**Context.** No email provider exists in the codebase. The weekly digest is the most-seen surface in the product; it is a first-class UI, not a notification.

**Decision.** `resend` SDK. 3,000 emails/month free, then $20/month — covers validation comfortably.

**Templates: hand-written table-based HTML strings in `src/lib/email/templates/`.** No React Email, no MJML.
*Rationale:* email HTML must be hand-tuned for Gmail/Outlook regardless; a framework adds a build step and a dependency to produce output we'd still hand-fix. Three templates in R1 (digest, month-in-review, transactional) do not justify a system.

**Required from day one:**
- Plain-text alternative on every send (deliverability, not politeness)
- `List-Unsubscribe` header + one-click unsubscribe link
- Domain auth: SPF, DKIM, DMARC on a **subdomain** (`mail.patronus.app`) so a deliverability problem never touches the root domain
- Every send logged to a `EmailSend` row: template, user, status, provider id — needed for the digest open/action funnel in PRD 01 §11

**Deliberately deferred:** marketing email, drip sequences, an ESP with a visual builder.

---

## ADR-5 — Embedding dimensions: 1024, decided now

**Context.** `text-embedding-3-large` at 3072 dims = 12.3 KB/vector. The log adds ~100 vectors per user per year. Changing dimensions later requires a full re-embed of every user's graph — cost and risk grow every week.

**Decision.** Move to **1024 dimensions** via the OpenAI `dimensions` parameter, before the log ships.

- `resolveEmbeddingSize` (`src/lib/config.ts:3`) returns 1024 for `text-embedding-3-large` unless `OPENAI_EMBEDDING_DIMENSIONS` overrides.
- **Validate before committing:** a one-off script embeds 200 existing knowledge items at 3072 and 1024, runs the app's real retrieval queries against both, and reports overlap@10. Ship 1024 if overlap@10 ≥ 0.9 — expected, since 3-large is Matryoshka-trained and our texts are short.
- Requires a **new Qdrant collection** (dimension is fixed at creation) + a backfill script + a cutover flag. Specced in Phase 0.

**Payoff:** 3× reduction on the largest infra line in the product, permanently. This is the highest-value cost decision available and it has nothing to do with model choice (PRD 08 §4.4).

---

## ADR-6 — One structured-AI helper, no call sites doing their own thing

**Context.** R1 adds ~10 new model call sites. Left alone they will each hand-roll retry, validation, cost logging, and model selection — and the no-fabrication guarantee will be enforced inconsistently.

**Decision.** Every new AI call goes through **one** helper:

```ts
// src/lib/ai/structured.ts
export async function generateStructured<T extends z.ZodType>(opts: {
  task: TaskKey;            // -> model resolved from config.ts map. NEVER a model id here.
  feature: FeatureTag;      // -> ApiUsageLog.metadata.feature, for cost tripwires
  userId: string;
  schema: T;
  system: string;
  prompt: string;
  maxRetries?: number;      // default 1
  guard?: NumericGuard;     // no-fabrication post-validation, see below
}): Promise<{ data: z.infer<T>; usage: Usage; degraded: boolean }>
```

It owns: model resolution from the per-task map, `generateObject` via AI SDK, zod validation with one retry, `ApiUsageLog` write with the feature tag, latency capture, and — critically — **the numeric guard.**

**The numeric guard** implements PRD 08 §5.1 once, for everything:
> Extract every digit sequence and quantity phrase from the model's output. Assert each appears in the declared source text. On failure: retry once with an explicit correction; on second failure, strip the offending field and mark `degraded: true`.

This is the single most important piece of shared code in the build. It is why "no fabricated numbers" is an architectural property rather than a prompt aspiration.

**Rule with teeth:** a lint rule (or PR-review gate) forbids importing the OpenAI client or `generateObject` outside `src/lib/ai/`. One grep to enforce.

---

## ADR-7 — Feature flags in Postgres

**Context.** R1 ships to a small validation cohort. We need per-user gating that isn't the billing tier.

**Decision.** A `FeatureFlag` table (`key`, `enabled`, `allowUserIds[]`, `rolloutPercent`) + `isEnabled(userId, key)` with a 60s in-process cache. No LaunchDarkly, no PostHog flags.

Flags in R1: `work_log`, `github_capture`, `weekly_digest`, `review_packet`, `backfill`. Every phase ships behind one, defaulted off, enabled for the team first.

---

## ADR-8 — Sensitivity enforcement is a query concern

**Context.** PRD 01 §4.3: confidential Wins must never reach a resume. Prompt instructions are not enforcement.

**Decision.** A single exported constant and one helper:

```ts
// src/lib/graph/visibility.ts
export const EXTERNAL_SAFE = { sensitivity: WinSensitivity.shareable } as const;
export function externalRetrievalFilter(userId: string): Prisma.WinWhereInput
export function qdrantExternalFilter(userId: string): QdrantFilter
```

Every retrieval feeding an *external* artifact (resume, cover letter, apply answer) uses these. Qdrant payload carries `sensitivity` so the vector filter matches the SQL filter. **Test asserts the filter, not the output** — a test that checks "the resume didn't mention it" is a test that passes by luck.

---

## ADR-9 — Design system: extend the 21 primitives, add 6

**Context.** `src/components/ui/` has 21 shadcn/Radix primitives. The log, review queue, and packet editor need consistent higher-order pieces.

**Decision.** Add exactly six, in `src/components/patterns/`:

| Component | Used by |
|---|---|
| `WinCard` | log rows, review queue, digest preview, packet appendix |
| `ReviewQueue` | draft triage — owns the `j/k/y/n/e` keyboard model |
| `EmptyState` | every empty surface (one illustration slot, exactly one action) |
| `StatTile` | log summary, readiness, radar |
| `SourceChip` | evidence attribution, used everywhere a claim shows provenance |
| `GroundChip` | ✓ grounded / ⚠ needs confirmation / ✗ unsupported — extend the existing `TruthfulnessPanel` treatment |

**Rule:** no feature ships a bespoke card. If a surface needs a seventh pattern, it gets added here, not inlined.

**Tokens:** reuse existing Tailwind theme. Do not introduce a second color scale. Dark mode via existing `next-themes`.

---

## ADR-10 — Testing posture for validation

**Decision.** Depth over coverage. Four categories, in priority order:

1. **The three thesis tests** (PRD 08 §10) — non-negotiable, written before the feature they protect:
   - Confirm a Win → exactly one `Evidence` + one `ClaimLink(grounded)`; un-confirm reverses completely including the Qdrant point.
   - A `confidential` Win never appears in external retrieval — asserted at the query layer.
   - No generated artifact contains a number absent from source (the ADR-6 guard, tested directly).
2. **Idempotency tests** — every scheduled job, run twice, produces one effect.
3. **AI eval fixtures** — `bun test` over labeled corpora (200 PRs, 20 packets). Zero-fabrication is the pass condition. Runs on prompt change.
4. **Everything else** — best effort. No UI snapshot tests, no coverage target.

Test data lives in `src/__fixtures__/`, following the existing extension parser-fixture pattern.

---

## Shared primitives — the contracts every phase uses

### P-1 The job runner

```ts
// src/lib/jobs/types.ts
export type JobKind =
  | 'capture_sync' | 'draft_wins' | 'weekly_digest' | 'month_in_review'
  | 'embed_win' | 'radar_snapshot' | 'reconcile_qdrant' | 'email_send';

// src/lib/jobs/runner.ts
export async function enqueue(kind: JobKind, payload: object, opts?: {
  runAt?: Date;
  dedupeKey?: string;      // unique; a duplicate enqueue is a silent no-op
  priority?: number;       // lower runs first, default 100
  maxAttempts?: number;    // default 3
}): Promise<{ jobId: string; deduped: boolean }>

export function registerHandler(kind: JobKind, fn: JobHandler): void
export async function drain(budgetMs: number, batchSize: number): Promise<DrainResult>
```

```prisma
enum JobStatus { pending running succeeded failed dead }

model Job {
  id          String    @id @default(cuid())
  kind        String
  payload     Json      @default("{}")
  dedupeKey   String?   @unique
  status      JobStatus @default(pending)
  priority    Int       @default(100)
  runAt       DateTime  @default(now())
  attempts    Int       @default(0)
  maxAttempts Int       @default(3)
  lockedAt    DateTime?
  lockedBy    String?
  lastError   String?
  result      Json?
  durationMs  Int?
  costUsd     Float     @default(0)
  createdAt   DateTime  @default(now())
  finishedAt  DateTime?

  @@index([status, runAt, priority])
  @@index([kind, createdAt])
}
```

**Claiming is atomic** — a conditional `updateMany` setting `status='running'`, `lockedAt`, `lockedBy`, exactly the race-safe pattern already used in `gateMeteredAction` (`src/lib/entitlements.ts:226`). Reuse the idiom; don't invent a second one.

**Stuck-job recovery:** on each tick, any job `running` with `lockedAt` older than 10 minutes resets to `pending` and increments `attempts`. Exhausting `maxAttempts` → `dead` (never silently dropped; `dead` rows are the alerting surface).

**Backoff:** `runAt = now + 2^attempts minutes`, capped at 60.

### P-2 Handler contract

```ts
type JobHandler = (payload: unknown, ctx: JobContext) => Promise<JobResult>
type JobContext = {
  jobId: string;
  attempt: number;
  deadline: Date;              // handler MUST return before this
  enqueue: typeof enqueue;     // fan-out to child jobs
  log: (msg, meta?) => void;
}
```

**The fan-out rule.** A handler that would process N users enqueues N child jobs and returns. It never loops over users itself. `weekly_digest_dispatch` → N × `weekly_digest`. This is what keeps every invocation inside the function timeout, and it is not optional.

### P-3 Server action shape

Every new action in `src/actions/` follows the existing convention (see `src/actions/github.ts`):
1. `auth()` from Clerk → `userId`, throw if absent
2. zod-parse the input (never trust the client)
3. `gateMeteredAction` if metered — **at entry, once**, never inside a loop
4. Do the work
5. Emit a `FunnelEvent`
6. Return a discriminated result (`src/lib/result.ts`), never throw for expected failures

### P-4 Telemetry

One helper, `track(userId, type, payload)` → `FunnelEvent`. Every event named in the PRDs is emitted from exactly one place. Extension events keep using `ExtensionEvent`.

### P-5 Cost tagging

Every `generateStructured` call passes `feature`. `ApiUsageLog.metadata.feature` becomes the group-by for the tripwire query in PRD 08 §4.3. One saved SQL view, `v_feature_cost_daily`, checked weekly.

---

## What we are explicitly not building in R1

| Not building | Why | When to revisit |
|---|---|---|
| Queue service (Inngest/QStash) | Postgres suffices below ~10k jobs/day | >5k jobs/day or multi-region |
| Separate worker process | Cron + bounded drain covers it | When a handler genuinely needs >4 min |
| Redis caching layer | Postgres + in-process memo is enough; Upstash stays for rate limits only | Measured DB pressure |
| Observability SaaS (Datadog/Sentry) | Vercel logs + `Job`/`ApiUsageLog` tables + one dashboard page | First paying cohort |
| Analytics SaaS | `FunnelEvent` + SQL | When non-engineers need self-serve |
| CDN/image pipeline, i18n, mobile app, SSO | Not on the validation path | — |
| Multi-region, read replicas, sharding | Actively harmful now | Never at this scale |

**The cost ceiling for all of R1 infra: under $150/month** — Vercel Pro, Supabase, Qdrant, Upstash, Resend, and inference for a few hundred users combined.
