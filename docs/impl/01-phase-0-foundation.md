# Implementation 01 — Phase 0: Foundation

> **Duration:** ~6–8 engineer-days · **Ships to users:** nothing · **Blocks:** every other phase
> **Design specs:** [`../design/00-foundations.md`](../design/00-foundations.md) · [`01-components.md`](../design/01-components.md) · [`02-screens.md`](../design/02-screens.md)
> **Exit criterion:** a scheduled job can fan out to N users, send a real email, call a model through the guarded helper, and be observed in SQL — end to end, on production, behind a flag.

Phase 0 is the one place where "we'll fix it later" is most expensive. Nine of these ten tasks are ≤1 day each and every subsequent phase assumes all of them.

---

## P0.1 — Stabilize the tree

**Why first:** 16 modified files and an unapplied migration are sitting on the `browser-extension` branch. Building on top of that makes every later failure ambiguous.

**Steps**
1. Review the working diff. Land or park it — do not carry it through Phase 0.
2. **Apply `20260704120000_v2_context_graph_billing`.** It creates `Evidence`, `ClaimLink`, `ImpactMetric`, `Subscription`, `UsageQuota` and promotes `applicationStatus` to the enum. Everything in R1 depends on it.
   - Verify on a Supabase branch/copy first; the status-string → enum conversion is the only non-additive change.
   - Confirm the `"discovered"` backfill: `SELECT applicationStatus, count(*) FROM "ApplicationWorkspace" GROUP BY 1;` before and after.
3. Add `prisma migrate status` to CI. A drifted schema must fail the build, not surprise someone at 2am.
4. Create the R1 branch off `main` after the merge.

**Done when:** `bunx prisma migrate status` is clean against production, and `Evidence`/`ClaimLink`/`ImpactMetric` accept a write from a scratch script.

---

## P0.2 — The job runner (ADR-1, ADR-2)

**Effort:** 1.5 days. **The highest-leverage code in the build** — six features depend on it.

**New files**
```
src/lib/jobs/types.ts        JobKind, JobHandler, JobContext, JobResult
src/lib/jobs/runner.ts       enqueue, registerHandler, drain, claim, backoff, recovery
src/lib/jobs/registry.ts     imports every handler module for side-effect registration
src/lib/jobs/handlers/       one file per JobKind (added by later phases)
src/app/api/cron/tick/route.ts
vercel.json                  the single cron entry
```

**Schema:** the `Job` model from ADR-1 §P-1. Migration `add_job_queue`.

**Implementation order**
1. `Job` model + migration.
2. `enqueue()` — insert with `dedupeKey`; catch the unique violation (`P2002`) and return `{deduped: true}` rather than throwing. Dedupe must be a normal outcome, not an error path.
3. `claim(batchSize)` — atomic `updateMany` where `status='pending' AND runAt <= now()`, ordered by `(priority, runAt)`, setting `status='running'`, `lockedAt`, `lockedBy = instanceId`. Follow the conditional-update idiom already in `src/lib/entitlements.ts:226`.
4. `drain(budgetMs, batchSize)` — claim, run with concurrency 4 (`Promise.allSettled` over chunks), record `durationMs`/`costUsd`/`result`, stop claiming when `elapsed > budgetMs`.
5. Failure path: `attempts++`, `runAt = now + min(2^attempts, 60) minutes`, `status='pending'`; at `maxAttempts` → `dead`.
6. Stuck recovery: at the top of every drain, reset `running` jobs with `lockedAt < now - 10min` to `pending`.
7. `/api/cron/tick` — bearer-secret check (constant-time, mirror `verifyTelegramWebhookSecret` at `src/lib/telegram.ts:33`), call `drain`, self-retrigger if work remains and chain depth < 10, return a JSON summary.

**`vercel.json`**
```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "0 * * * *" }] }
```
If on Hobby (daily cron only), configure cron-job.org at 15-minute intervals against the same endpoint. Note it in `.env.example`.

**Tests** (`src/lib/jobs/runner.test.ts`)
- Same `dedupeKey` twice → one row, second returns `deduped: true`
- Two concurrent `claim()` calls never return the same job
- A throwing handler increments `attempts` and reschedules with backoff
- `maxAttempts` exhausted → `dead`, never lost
- A job locked 11 minutes ago is reclaimed
- `drain` respects the time budget and returns before it

**Done when:** a `noop` job enqueued in production is picked up by the next tick and lands in `succeeded` with a duration.

---

## P0.3 — Email transport (ADR-4)

**Effort:** 1 day.

**New files**
```
src/lib/email/send.ts            sendEmail(), unsubscribe token, EmailSend logging
src/lib/email/layout.ts          shared table shell, dark-mode CSS, footer
src/lib/email/templates/         transactional.ts (the only one in Phase 0)
src/app/api/email/unsubscribe/route.ts
src/app/e/[token]/route.ts       open-tracking pixel + click passthrough (optional, cheap)
```

**Schema**
```prisma
model EmailSend {
  id          String    @id @default(cuid())
  userId      String
  template    String
  subject     String
  providerId  String?
  status      String    @default("queued")  // queued|sent|delivered|bounced|complained|failed
  openedAt    DateTime?
  clickedAt   DateTime?
  error       String?
  createdAt   DateTime  @default(now())
  @@index([userId, createdAt])
  @@index([template, createdAt])
}

model EmailPreference {
  userId          String  @id
  weeklyDigest    Boolean @default(true)
  monthlyReview   Boolean @default(true)
  radarDigest     Boolean @default(true)
  missionNudges   Boolean @default(true)
  productUpdates  Boolean @default(true)
  unsubscribedAll Boolean @default(false)
  unsubscribeToken String @unique
  timezone        String  @default("Etc/UTC")
  digestDay       Int     @default(5)   // 1=Mon … 7=Sun; Friday
  digestHour      Int     @default(16)
  updatedAt       DateTime @updatedAt
}
```

Putting timezone and digest schedule here (not `UserProfile.preferences` JSON) makes the "who is due this hour" query indexable — see P0.8.

**`sendEmail()` responsibilities**
1. Check `EmailPreference` for the template's category; skip and log if opted out.
2. Render HTML + **plain-text alternative** (required, not optional).
3. Set `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
4. Send via Resend; store `providerId`.
5. Write `EmailSend`.
6. Never throw into the caller — return a result. A failed email must not fail a job.

**Deliverability setup (do this on day one, it takes 24h to propagate)**
- Sending subdomain `mail.<domain>` — never the root
- SPF, DKIM, DMARC (`p=none` initially, tighten after two weeks of clean reports)
- Resend webhook → `/api/email/webhook` updating `EmailSend.status` for bounces and complaints
- Hard-bounce → set `unsubscribedAll` automatically

**Tests:** opted-out user is skipped · unsubscribe token is single-purpose and idempotent · plain-text is generated for every template · a provider 500 records `failed` without throwing.

**Done when:** a real email arrives in Gmail and Outlook web, renders correctly in light and dark, and one-click unsubscribe works from the client's own header.

---

## P0.4 — The guarded AI helper (ADR-6)

**Effort:** 1.5 days. **This is the code that makes "we never fabricate" true.**

**New files**
```
src/lib/ai/structured.ts     generateStructured()
src/lib/ai/guard.ts          numeric + quantity guard
src/lib/ai/tasks.ts          TaskKey union, mapped to config.ts model map
src/lib/ai/features.ts       FeatureTag union
```

**Steps**
1. Extend the model map in `src/lib/config.ts` with the new task keys: `winDraft`, `winStructure`, `digestCompose`, `monthReview`, `packetThemes`, `packetMap`, `packetCompose`, `interviewTurn`, `interviewExtract`, `radarNormalize`, `radarReason`. Every one env-overridable, following the existing pattern at `config.ts:21-29`.
2. `generateStructured()` — wraps AI SDK `generateObject`: resolve model from `task`, call, zod-validate, one retry with the validation error appended to the prompt, then log to `ApiUsageLog` with `metadata.feature`, `metadata.task`, latency, and computed cost via the existing `calculateOpenAiCostUsd` (`src/lib/usageTracker.ts:63`).
3. **The numeric guard** (`guard.ts`):
   ```ts
   type NumericGuard = { sourceText: string; fields: string[] }
   ```
   - Extract from each guarded output field: digit sequences, percentages, currency amounts, multipliers (`3x`), and written quantities (`doubled`, `halved`, `tripled`).
   - Normalize both sides: strip separators, unify `K`/`M`/`k`, `%`, currency symbols, and `800ms`/`0.8s` equivalences.
   - Every extracted quantity must appear in `sourceText`. On failure → one corrective retry → strip the field, set `degraded: true`, and log a `ai_guard_violation` event.
4. Enforcement: ESLint `no-restricted-imports` blocking `openai` and `ai`'s `generateObject` outside `src/lib/ai/**`.

**Tests** (`src/lib/ai/guard.test.ts`) — a table-driven suite, and it must be thorough because everything trusts it:
- `"cut latency 77%"` vs source containing `77%` → pass
- source has `800ms → 180ms`, output says `77%` → **fail** (derived, not stated — this is the subtle case that matters most)
- `"$1.2M"` vs `"1,200,000"` → pass after normalization
- `"3x faster"` vs `"three times"` → pass
- `"reduced by roughly a third"` with no number in source → **fail**
- unicode digits, ranges (`10-15`), years (`2024` should not be treated as a metric) → correct classification

**Done when:** the guard suite is green, and a deliberately-fabricating prompt in a scratch test is caught and degraded rather than returned.

---

## P0.5 — Feature flags (ADR-7)

**Effort:** 0.5 day.

```prisma
model FeatureFlag {
  key            String   @id
  enabled        Boolean  @default(false)
  allowUserIds   Json     @default("[]")
  rolloutPercent Int      @default(0)
  updatedAt      DateTime @updatedAt
}
```

`src/lib/flags.ts` → `isEnabled(userId, key)` with a 60-second in-process cache. Rollout by `hash(userId + key) % 100 < rolloutPercent` — stable per user, no flapping.

Seed: `work_log`, `github_capture`, `weekly_digest`, `review_packet`, `backfill`, all `false`.

Admin toggle: extend the existing admin surface (`src/actions/admin.ts`). One table, two controls. Do not build a flag UI beyond that.

---

## P0.6 — Embedding dimension cutover (ADR-5)

**Effort:** 1 day. **Do it now; the cost of doing it later grows weekly.**

**Steps**
1. **Validate first.** `scripts/eval-embedding-dims.ts`: embed 200 existing `KnowledgeItem`/`UserProject` records at 3072 and 1024, run 30 representative retrieval queries against both, report overlap@10 and mean rank delta. Proceed only if overlap@10 ≥ 0.90.
2. Create Qdrant collection `knowledge_base_v2` at 1024 dims (dimension is immutable after creation).
3. `resolveEmbeddingSize` (`src/lib/config.ts:3`) returns 1024 for `text-embedding-3-large`, overridable via `OPENAI_EMBEDDING_DIMENSIONS`.
4. Pass `dimensions` to the embedding call in `src/actions/embed.ts`.
5. Backfill job (`kind: 'reembed_user'`, one per user, via the new runner — a good first real load test): re-embed every `UserProject`, `UserExperience`, `KnowledgeItem` into v2, update `qdrantPointId`.
6. Cutover flag `QDRANT_COLLECTION` env var; flip after backfill completes; keep v1 for 7 days, then drop.
7. `reconcile_qdrant` job: find DB rows marked `embedded` with no live point, and points with no row. Run weekly.

**Done when:** retrieval quality is verified equivalent, all users are on v2, and storage is measurably ~3× smaller.

---

## P0.7 — Theme work + design patterns (ADR-9)

**Effort:** 2 days (1 theme, 1 components). **Full specs:** [`../design/00-foundations.md`](../design/00-foundations.md) and [`../design/01-components.md`](../design/01-components.md).

**P0.7a — Theme fixes** *(1d)*, per design foundations §11. Three things must change before dense surfaces get built on the current theme:
- **Add light mode.** `:root` today holds dark values with no light counterpart (`globals.css:16-40`). Move them to `.dark`, add the light block, set `next-themes` to `attribute="class"` with light as the `(app)` default. Packets and logs are documents people read in bright offices and screen-share to managers — light isn't a preference here.
- **Add `.surface-work`.** `Card` applies `backdrop-blur-sm shadow-lg` and `Button` carries `patronus-glow-sm`. On a 500-row list that's both visually exhausting and a compositing cost against the 400ms p95 budget. Glow becomes a reward signal, not a default.
- **Replace the Google Fonts `@import`** (`globals.css:1-2`, render-blocking) with `next/font/google`; five weights total instead of eleven.

**P0.7b — Six components** *(1d)* in `src/components/patterns/`: `SourceChip`, `GroundChip`, `WinCard`, `ReviewQueue`, `EmptyState`, `StatTile`, plus the thin atoms (`CategoryChip`, `MetricChip`, `StreakBadge`, `QuotaMeter`, `ProgressStages`). Build order in design 01 §"Component build order".

**Build them against fixtures, before the features exist.** A Storybook-less route at `/dev/patterns` (dev-only, gated) rendering every component in every state — loading, empty, error, long content, dark mode. This costs half a day and saves repeated re-styling across three phases.

**`ReviewQueue` owns the keyboard model** and it's the one with real interaction design in it:
| Key | Action |
|---|---|
| `j` / `k` or `↓` / `↑` | move |
| `y` / `Enter` | confirm |
| `n` | dismiss |
| `e` | edit inline |
| `u` | undo last |
| `?` | shortcut help |

Focus must be visible, actions must be announced to screen readers via a live region, and the whole queue must be operable without a mouse (PRD 08 §8.2). This is also the fastest path for power users, which is how the 20-second bar is met.

---

## P0.8 — Timezone & schedule capture

**Effort:** 0.5 day.

1. On first authenticated app load, if `EmailPreference.timezone` is `Etc/UTC` and untouched, write `Intl.DateTimeFormat().resolvedOptions().timeZone` via a server action. Silent, no prompt.
2. `src/lib/time.ts` → `localHourFor(tz)`, `localDayFor(tz)`, `weekStartFor(tz, date)`. **`Intl` only — no date library.** `weekStart` = Monday 00:00 in the user's tz, stored as UTC.
3. Settings UI (deferred to Phase 3, but the schema lands now): day, hour, per-category toggles.

**Test:** `weekStartFor` across DST boundaries in `America/New_York` and `Asia/Kolkata` (a +5:30 offset catches integer-hour assumptions — the classic bug).

---

## P0.9 — Telemetry & the ops page

**Effort:** 0.5 day.

1. `src/lib/track.ts` → `track(userId, type, payload)` writing `FunnelEvent`. One import, used everywhere.
2. **`/admin/ops`** — one server-rendered page, no charting library, just tables:
   - Jobs by kind × status, last 24h; the `dead` list with errors
   - `v_feature_cost_daily` — cost per feature per day vs. the PRD 08 §4.3 tripwires
   - Email sends by template with delivered/bounced/opened
   - The R1 funnel: signups → source connected → first Win confirmed → 3 Wins by day 21
3. SQL views live in a migration so they're versioned, not typed into a console.

**This page is the observability strategy for R1.** It replaces a monitoring vendor and it is enough at this scale — but only if someone actually opens it, so put it in the weekly routine.

---

## P0.10 — Environment & docs

**Effort:** 0.5 day.

New env vars, all added to `.env.example` with comments:
```
CRON_SECRET=
JOB_BATCH_SIZE=25
CRON_TIME_BUDGET_MS=45000
RESEND_API_KEY=
EMAIL_FROM="Patronus <hello@mail.example.com>"
EMAIL_REPLY_TO=
APP_URL=
QDRANT_COLLECTION=knowledge_base_v2
OPENAI_EMBEDDING_DIMENSIONS=1024
WIN_MAGIC_LINK_SECRET=
OPENAI_MODEL_WIN_DRAFT=
OPENAI_MODEL_PACKET=
OPENAI_MODEL_INTERVIEW=
```

Update `CLAUDE.md` (or create it) with: the job-runner contract, the "no model IDs at call sites" rule, the "no direct OpenAI import" rule, and the sensitivity-filter rule. These are the four conventions a new contributor will otherwise violate on day one.

---

## Phase 0 exit checklist

- [ ] Migration applied; `prisma migrate status` clean; CI enforces it
- [ ] A job enqueued in production runs on the next tick and is visible in `/admin/ops`
- [ ] Duplicate `dedupeKey` produces exactly one job
- [ ] A killed mid-run job is reclaimed after 10 minutes and completes
- [ ] Real email delivered to Gmail + Outlook, light and dark, with working one-click unsubscribe
- [ ] `generateStructured` logs cost with a feature tag; the guard suite is green
- [ ] ESLint blocks direct OpenAI imports outside `src/lib/ai/`
- [ ] Embedding eval passed; all users re-embedded at 1024; v1 collection scheduled for deletion
- [ ] Light mode added; every existing screen audited in light (expect hardcoded dark assumptions)
- [ ] Fonts served via `next/font`; no render-blocking `@import` remains
- [ ] `.surface-work` applied to list surfaces; no `backdrop-blur` in any scrolling list
- [ ] Six patterns render correctly at `/dev/patterns` in both themes, all three densities, keyboard-operable
- [ ] Contrast verified with a checker on `--muted-foreground` and `--primary`, both themes
- [ ] `weekStartFor` correct across DST and a +5:30 timezone
- [ ] `/admin/ops` shows jobs, cost, email, and funnel
- [ ] All five feature flags exist and default to off
