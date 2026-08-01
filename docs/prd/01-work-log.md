# PRD 01 — The Work Log (the kernel)

> **Status:** `Draft for build` · **Release:** R1.1 / R1.3 / R1.4 · **Persona:** P1 Maya (primary), P2 Dev (downstream)
> **Depends on:** existing `Evidence` / `ClaimLink` / `ImpactMetric` models, `ChannelIdentity` + Telegram infra, Qdrant embed path (`src/actions/embed.ts`)
> **Blocks:** 02 (auto-capture), 03 (packets), 07 (backfill)

---

## 1. The problem, in the user's words

> *"Every March I sit down to write my self-review and I genuinely cannot remember January. I scroll Slack. I scroll Jira. I find maybe 60% of it, and the 40% I lose is usually the ambient stuff — the incident I handled at 2am, the design doc that unblocked another team, the junior I unblocked for three weeks. So I write a review about the features I shipped, which is the least differentiated thing I did, and my manager reads a list of tickets."*

Three distinct failures:
1. **Recall failure** — the work happened, the memory didn't survive.
2. **Framing failure** — what gets remembered is what's in a ticket tracker (output), not what mattered (impact, influence, judgment).
3. **Evidence failure** — even remembered wins have no numbers attached, because nobody measured at the time.

The Work Log fixes all three, at the moment the work happens, in exchange for ~20 seconds a week.

## 2. Value proposition

| Stakeholder | Value |
|---|---|
| **User (employed)** | Walks into every review with a complete, quantified, evidence-linked record. Concretely: a better packet, a stronger promo case, a defensible raise ask. |
| **User (searching)** | A resume assembled from 3 years of dated, evidenced Wins instead of memory. Nothing else on the market can do this. |
| **Product** | Every confirmed Win writes `Evidence(confirmedByUser=true)` — the moat compounds passively, and the truthfulness guarantee gets real substrate instead of inference. |

---

## 3. User stories

**Capture**
- As Maya, I want the product to notice what I did without me writing anything, so logging costs me almost nothing.
- As Maya, I want to add a win in under 15 seconds from wherever I am (browser, phone, Telegram) when something good happens.
- As Maya, I want to log something that happened three weeks ago and have it filed on the right date, not today.
- As Maya, I want to mark a win as confidential so it helps my review but never appears on a resume.

**Review & correct**
- As Maya, I want to see what the AI drafted and fix its framing in one tap, because it will get the "so what" wrong sometimes.
- As Maya, I want to dismiss noise (dependabot PRs, recurring standups) permanently, not weekly.

**Payoff**
- As Maya, after three weeks I want to see something that makes the habit feel worth it, without asking for it.
- As Maya, I want to browse my log by time, by employer, by skill, and by project.
- As Dev, I want every resume bullet the product generates to be traceable to a Win I confirmed.

---

## 4. The Win object

### 4.1 Anatomy

A Win answers five questions. The AI drafts all five; the user corrects any of them.

| Field | Question | Example |
|---|---|---|
| `title` | What happened? | "Cut checkout p95 latency from 800ms to 180ms" |
| `narrative` | How, and why did it matter? | "Rewrote the pricing lookup to a single batched query and added a read-through cache. Checkout timeouts during peak dropped to near zero — this had been the top support complaint for two quarters." |
| `occurredAt` | When? | 2026-07-14 (the *work's* date, never the logging date) |
| `category` | What kind of contribution? | `improved` |
| `evidence` | How do we know? | PR #482, the Grafana screenshot, the incident ticket |

Plus classification: `employerId`, `skills[]`, `collaborators[]`, `sensitivity`, and an optional linked `ImpactMetric`.

### 4.2 Categories

A fixed, small taxonomy. It exists because **category is what makes a packet readable** — a review organized by "shipped / led / improved / influenced" is dramatically better than a chronological list, and it's how competency rubrics are written.

| Category | Definition | Typical rubric mapping |
|---|---|---|
| `shipped` | Delivered something new that users or systems now depend on | Execution / Delivery |
| `improved` | Made an existing thing measurably better | Technical excellence |
| `fixed` | Resolved an incident, bug, or risk | Reliability / Ownership |
| `led` | Owned a project, drove a decision, ran a process | Leadership |
| `influenced` | Changed what someone else did — design review, doc, mentoring, cross-team | Influence / Scope |
| `grew` | Developed a person or the team | People / Mentorship |
| `learned` | Acquired a skill or domain that expanded your range | Growth |
| `saved` | Reduced cost, time, or headcount need | Business impact |

The AI must pick exactly one. Ties are resolved toward the *rarer* category (`influenced` beats `shipped`) because rare categories are what's missing from most people's reviews.

### 4.3 Sensitivity — a first-class field, not a checkbox afterthought

| Value | Meaning | Where it may appear |
|---|---|---|
| `shareable` *(default)* | Ordinary work, safe to describe externally | Resume, packet, portfolio, Qdrant embeddings for tailoring |
| `internal_only` | Fine for your manager, not for outsiders (internal metrics, org details) | Packet, 1:1 prep. **Never** resume, cover letter, or apply answers. |
| `confidential` | Unreleased product, security incident, personnel matter, NDA'd client | Packet only, and flagged there. **Never** embedded in Qdrant. Excluded from all generation. |

**Enforcement is at the query layer, not the prompt layer.** Every retrieval used for external artifacts filters `sensitivity = 'shareable'` in the database query. Never rely on an instruction telling the model to skip confidential items.

The AI proposes sensitivity from signals (private repo → `internal_only`; keywords like "incident", "layoff", "acquisition", "customer name" → suggest `confidential`) but **the user's setting always wins and is never auto-downgraded.**

### 4.4 Lifecycle

```
                    ┌──────────┐
   AI drafts ──────▶│  draft   │
                    └────┬─────┘
        user edits ──────┤
                         │ confirm                        ┌───────────┐
                         ├───────────────────────────────▶│ confirmed │
                         │                                └─────┬─────┘
                         │ dismiss                              │ archive
                         ▼                                      ▼
                   ┌───────────┐                          ┌──────────┐
                   │ dismissed │                          │ archived │
                   └───────────┘                          └──────────┘
```

Rules:
- Only `confirmed` Wins produce `Evidence` + `ClaimLink(grounded)` and get embedded.
- `dismissed` Wins are retained (not deleted) — they train the noise filter (02 §6.4) and prevent re-drafting the same signal.
- Un-confirming is allowed (`confirmed → draft`): it revokes the `ClaimLink` (sets `groundState = needs_confirmation`) and removes the Qdrant point. This must be transactional.
- `archived` hides from the default log view but stays in packets and exports.
- Drafts older than **45 days** with no action are auto-dismissed with `dismissedReason = 'expired'`, so the inbox never becomes a graveyard. Notify once at 30 days ("12 unreviewed wins from July are about to expire").

### 4.5 Employer attribution

`employerId` points at a `UserExperience` row and is resolved by date: the experience whose `[startDate, endDate ?? now]` contains `occurredAt`. If none matches (gap, or missing experience row), set `employerId = null` and surface an inline prompt: *"Which job was this? [dropdown] [+ add a job]"*. Never silently guess when the date is ambiguous (overlapping roles) — ask.

---

## 5. Capture surfaces

Four ways in. Ranked by expected volume.

### 5.1 Auto-draft (≈70% of volume) — specced in [02](02-auto-capture.md)

### 5.2 The Weekly Ritual — the habit engine

This is the most important interaction in the product. If it fails, nothing else matters.

**Trigger:** a scheduled job, per user, at their configured time. Default **Friday 16:00 in the user's local timezone**, configurable to any day/hour. Rationale: end of work week, work is fresh, and Friday afternoon attention is cheap. Users with no timezone set default to Friday 16:00 UTC and we prompt for timezone on first digest open.

**Content:** up to **5** drafted Wins from the past 7 days (highest confidence first), plus one free-text line.

**Email version** — the layout is the spec:

```
Subject: 3 things you did this week
Preheader: Confirm in 20 seconds — Friday, Jul 31

  ─────────────────────────────────────────
  YOUR WEEK · Jul 25 – Jul 31
  ─────────────────────────────────────────

  ① Cut checkout p95 latency 800ms → 180ms
     Rewrote the pricing lookup as a batched query
     with a read-through cache.
     From: PR #482 · patronus/api
     [ ✓ Yes, log it ]   [ ✎ Edit ]   [ ✕ Not a win ]

  ② Unblocked the payments team on webhook retries
     Design review comment that changed their approach.
     From: PR review · patronus/payments
     [ ✓ Yes, log it ]   [ ✎ Edit ]   [ ✕ Not a win ]

  ③ …

  ─────────────────────────────────────────
  Anything we missed?
  [ Add a win → ]              (one-tap to a prefilled compose page)
  ─────────────────────────────────────────
  14 wins logged · 6 weeks running 🔥
  Change when you get this · Unsubscribe
```

Every button is a **signed magic link** (`GET /w/:token`) that performs the action and lands on a confirmation page — no login required, no app open required. That is how we hit 20 seconds. Token spec in §9.3.

**Telegram version:** same content as a message with inline keyboard buttons (`answerTelegramCallbackQuery` already exists in `src/lib/telegram.ts`); confirm happens in-chat with zero navigation. This is the better UX and we should push users toward it after their second digest.

**Empty-week handling.** If zero signals were found, do **not** send a "nothing this week" email — that's the fastest path to unsubscribe. Instead send at most **one** nudge every 3 empty weeks: *"Quiet week on GitHub? Reviews, mentoring and design work don't show up there. What's one thing you'd want your manager to know about? [reply here]"* — with a one-line reply capture.

**Frequency guardrails:** never more than one digest per 6 days. If a user hasn't opened 4 consecutive digests, drop to biweekly automatically and tell them ("we'll check in every other week instead"). Auto-degrade beats unsubscribe.

### 5.3 Quick capture — for when something good just happened

Available from three places, all hitting the same action:

| Surface | Entry | Notes |
|---|---|---|
| Web | Persistent "+ Log a win" button in the app header; keyboard shortcut `⌘K → "log"` | |
| Extension | Side-panel top action, always visible | Reuses the existing bearer-token auth |
| Telegram | Just send a message to the bot | Free-text → AI structures it → confirm inline |

**The compose interaction:**
1. A single textarea. Placeholder: *"What happened? Rough notes are fine — 'fixed the checkout timeout thing, latency way down'"*.
2. On blur or after 800ms idle, call the structuring model. Show a skeleton, then the structured Win with all five fields filled and editable inline.
3. Date defaults to today with a one-tap "earlier…" chip offering *Yesterday · This week · Last week · Pick a date*.
4. Sensitivity defaults to `shareable` with a lock icon toggle.
5. `⌘↵` confirms. Toast: *"Logged. 15 wins this quarter."* with an Undo for 8 seconds.

**Latency budget:** structuring returns in <2.5s p95. If it exceeds 4s, save the raw text as a Win draft with `title` = first 80 chars and structure it asynchronously — never block the user on the model.

### 5.4 Ambient capture — harvesting from other product surfaces

The product already generates text about the user's accomplishments in places the log doesn't know about. Each of these gets a lightweight "add to log?" affordance:

| Source surface | Trigger | Offer |
|---|---|---|
| Tailored resume generation | A bullet was *edited by the user* to add a specific detail or number | "You added 'reduced onboarding time 40%' — should we log that as a win with a date?" |
| Apply question answers | An answer describes a specific accomplishment | Same |
| Truthfulness chip confirmation | User confirms a `needs_confirmation` claim | Auto-create a confirmed Win from the claim + the confirming evidence |
| Backfill interview (07) | Every extracted accomplishment | Direct write |

Ambient offers are **non-modal and dismissible**, max one per session. Never interrupt a generation flow.

---

## 6. The Log surface (web)

Route: `/log`. This becomes a primary nav item alongside Resumes and Applications.

### 6.1 Layout

```
┌─ Work Log ──────────────────────────── [ + Log a win ] ─┐
│                                                          │
│  ┌ Needs review (3) ──────────────────────────────────┐ │  ← only when >0
│  │  ① Cut checkout p95 latency…      ✓  ✎  ✕          │ │
│  │  ② Unblocked the payments team…   ✓  ✎  ✕          │ │
│  │  ③ …                              ✓  ✎  ✕          │ │
│  │                      [ Confirm all ]  [ Dismiss all ]│ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  [ All ▾ ]  [ 2026 ▾ ]  [ All employers ▾ ]  [ Search ] │
│  ─────────────────────────────────────────────────────── │
│  JULY 2026                                    8 wins     │
│   ● Jul 14 · improved · Acme                             │
│     Cut checkout p95 latency 800ms → 180ms               │
│     🔗 PR #482   ⚡ -77%   #performance #postgres          │
│   ● Jul 09 · influenced · Acme         🔒 internal only   │
│     Unblocked the payments team on webhook retries       │
│  ─────────────────────────────────────────────────────── │
│  JUNE 2026                                    11 wins    │
│   …                                                      │
└──────────────────────────────────────────────────────────┘
```

**Right rail (desktop ≥1280px):**
- Streak + counts: *"19 weeks · 74 wins · 61 with evidence"*
- Category distribution bar — this is quietly a coaching tool: a log that is 90% `shipped` and 0% `influenced` is a promo case that will fail, and we say so: *"You have no `influenced` wins this quarter. Senior-level reviews usually need 2–3."*
- **[ Generate review packet → ]** (03)

### 6.2 States

| State | Treatment |
|---|---|
| **Empty (new user)** | Not a blank page. Show the connector CTA ("Connect GitHub — we'll find your last 30 days") + a 3-example illustrative log with a "sample" watermark, so the user sees what they're building toward. |
| **Empty (connected, no signals yet)** | "We're scanning your last 30 days — this takes about a minute." Poll; show drafts as they land. |
| **Drafts pending** | The "Needs review" block pins to the top and shows a count badge in nav. |
| **Loading** | Skeleton rows matching the final layout. Never a spinner. |
| **Error** | Inline, per-section, with retry. A failed connector sync never blanks the log. |
| **Filtered to zero** | "No wins match — clear filters" |

### 6.3 The Win detail / edit view

A right-side drawer, not a page navigation (preserves scroll position in the log).

Contents: all five fields inline-editable · sensitivity selector · employer selector · skills as removable chips with autocomplete from the user's existing skill set · **evidence list** (each with source icon, excerpt, and a link out) · linked `ImpactMetric` with a "quantify this" prompt if absent · audit line ("Drafted from PR #482 on Jul 14, confirmed by you on Jul 18").

**The quantify prompt** is high-leverage: for any confirmed Win with no `ImpactMetric`, show one inline question generated from the narrative — *"Roughly how much faster?"* with a text input. Answering writes an `ImpactMetric` and upgrades the Win. This is the Context Interview mechanic, delivered one question at a time, for free, in context.

### 6.4 Month in Review — the 3-week payoff (R1.4)

Sent on the 1st of each month to any user with ≥3 confirmed Wins in the prior month. Also viewable at `/log/review/:yyyy-mm`.

Contents:
1. **The headline** — *"July: 8 wins, 5 with hard numbers."*
2. **Your month in one paragraph** — AI-written, in the user's voice if a `VoiceProfile` exists. This is the artifact people screenshot.
3. **Category balance** — with the coaching observation if skewed.
4. **The one thing missing** — the single highest-value gap ("none of your wins mention business impact — for a Staff case that's usually required").
5. **CTA** — "Add these to your resume" (if searching) or "Start your review packet" (if within 60 days of a configured review date).

This is the deliverable that converts a logging habit into a paid subscription. Treat its copy quality as a launch blocker.

---

## 7. Data model

```prisma
enum WinStatus     { draft confirmed dismissed archived }
enum WinCategory   { shipped improved fixed led influenced grew learned saved }
enum WinSensitivity{ shareable internal_only confidential }
enum WinSource     { manual github calendar linear jira ambient backfill import }

model Win {
  id             String          @id @default(cuid())
  userId         String
  title          String          // ≤ 120 chars, enforced in app layer
  narrative      String          @default("")
  occurredAt     DateTime        // date the work happened
  periodEnd      DateTime?       // set for multi-week efforts; occurredAt is the start
  category       WinCategory
  status         WinStatus       @default(draft)
  sensitivity    WinSensitivity  @default(shareable)
  source         WinSource
  sourceRef      String?         // PR url, calendar event id, telegram msg id
  signalId       String?         @unique   // -> CaptureSignal, enforces one Win per signal
  employerId     String?         // -> UserExperience.id
  projectId      String?         // -> UserProject.id
  skills         Json            @default("[]")   // normalized skill slugs
  collaborators  Json            @default("[]")
  impactMetricId String?         // -> ImpactMetric.id
  confidence     Float           @default(0.5)    // AI's drafting confidence
  dismissedReason String?        // not_a_win | noise | duplicate | expired | user
  confirmedAt    DateTime?
  embedded       Boolean         @default(false)
  qdrantPointId  String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@index([userId, occurredAt(sort: Desc)])
  @@index([userId, status, createdAt])
  @@index([userId, employerId, occurredAt])
  @@index([userId, category, occurredAt])
}

model WeeklyDigest {
  id             String   @id @default(cuid())
  userId         String
  weekStart      DateTime           // Monday 00:00 in user's tz, stored UTC
  channel        Channel            // reuse existing enum
  winIds         Json     @default("[]")
  token          String   @unique   // signed action token root
  sentAt         DateTime?
  openedAt       DateTime?
  firstActionAt  DateTime?
  confirmedCount Int      @default(0)
  dismissedCount Int      @default(0)
  skipped        Boolean  @default(false)   // empty week, intentionally not sent
  createdAt      DateTime @default(now())

  @@unique([userId, weekStart])
  @@index([userId, sentAt])
}
```

### 7.1 Relationship to the existing evidence layer

No new evidence tables. On confirm:

```
Win.confirm(winId):
  tx:
    win.status = confirmed; win.confirmedAt = now()
    for each source artifact:
      Evidence.create({
        userId, kind: <see map>, sourceRef: win.sourceRef,
        excerpt: <PR title + body excerpt | user's own text>,
        confidence: win.confidence,
        confirmedByUser: true            ← the whole point
      })
      ClaimLink.create({
        userId, claimType: 'win', claimRefId: win.id,
        evidenceId, groundState: 'grounded'
      })
    if win has quantified impact:
      ImpactMetric.create({ subjectType: 'win', subjectId: win.id, source: <win.source>, ... })
  after commit (async):
    enqueue embed(win)  → Qdrant, only if sensitivity = 'shareable'
```

`EvidenceKind` map: `github → repo`, `manual/telegram → metric_confirmed` (user assertion), `calendar/linear/jira → document`, `backfill → interview_assertion`, `import → import`. The existing enum covers all cases; no migration needed.

`claimType = 'win'` is a new value in the existing free-string `ClaimLink.claimType` field — no schema change.

### 7.2 Embedding

Reuse `src/actions/embed.ts`. Payload text = `title + "\n" + narrative + "\n" + skills.join(", ")`. Qdrant payload adds `{ type: 'win', occurredAt, category, employerId, sensitivity }` so tailoring retrieval can filter by recency and relevance and **must** filter `sensitivity = 'shareable'`.

Un-confirming or deleting a Win must delete the Qdrant point. Add a reconciliation job (weekly) that finds orphaned points.

---

## 8. AI contracts

All calls go through `src/lib/aiProvider.ts` with a per-task model entry in `src/lib/config.ts`. All outputs are zod-validated; a validation failure retries once, then falls back to a degraded path (never an error shown to the user).

### 8.1 `structureWin` — free text → Win draft

**Model tier:** start on `gpt-5-mini`, but **evaluate `gpt-5` and default to whichever wins on accept rate** — the cost delta is ~$0.004/call and draft quality is the R1 north-star input (08 §4.2). Choose on quality; the budget is not the constraint. **Budget:** <2.5s p95, ~$0.001–0.006/call.

```ts
const WinDraftSchema = z.object({
  title: z.string().max(120),
  narrative: z.string().max(600),
  category: z.enum([...WIN_CATEGORIES]),
  occurredAtHint: z.enum(['today','yesterday','this_week','last_week','earlier','explicit']),
  explicitDate: z.string().date().nullable(),
  skills: z.array(z.string()).max(8),
  collaborators: z.array(z.string()).max(6),
  suggestedSensitivity: z.enum(['shareable','internal_only','confidential']),
  quantified: z.boolean(),
  impact: z.object({
    metric: z.string(), baseline: z.string().nullable(),
    result: z.string().nullable(), delta: z.string().nullable(),
    scope: z.string().nullable(), timeframe: z.string().nullable(),
  }).nullable(),
  clarifyingQuestion: z.string().nullable(),   // asked only when quantified === false
  confidence: z.number().min(0).max(1),
});
```

**Prompt rules (non-negotiable, these are the truthfulness invariant applied to capture):**
1. *Never invent a number.* If the user didn't state a quantity, `impact` is `null` and `quantified` is `false`. Do not estimate, infer, or use a typical value.
2. *Never invent a scope or an outcome.* Rephrase only what's present.
3. Title is a factual statement, not a brag. No "successfully", "spearheaded", "leveraged".
4. `clarifyingQuestion` must be answerable in under five words ("How much faster?" not "Can you describe the performance improvement in detail?").
5. If the input is ambiguous or too thin to be a Win, return `confidence < 0.3` and let the app keep the raw text as-is.

### 8.2 `composeMonthInReview`

**Model tier:** strong conversational. **Input:** the month's confirmed Wins (title, narrative, category, metrics), plus `VoiceProfile.styleDescriptor` if present. **Output:** `{ headline, paragraph, categoryObservation, biggestGap }`, each length-capped. Same no-invention rules. Must reference only supplied Wins.

### 8.3 `generateQuantifyPrompt`

Given one Win with no metric, produce a single ≤8-word question and the expected answer unit. Cheap model, cached per Win.

---

## 9. Interfaces

### 9.1 Server actions (`src/actions/wins.ts`)
| Action | Signature | Notes |
|---|---|---|
| `createWinFromText` | `(text, opts) → Win` | Runs `structureWin`, returns a `draft` |
| `confirmWin` | `(winId, patch?) → Win` | Transactional per §7.1; idempotent |
| `updateWin` | `(winId, patch) → Win` | Re-embeds if title/narrative/skills/sensitivity changed |
| `dismissWin` | `(winId, reason) → void` | Feeds the noise filter |
| `unconfirmWin` | `(winId) → Win` | Revokes ClaimLink + Qdrant point |
| `listWins` | `(filters, cursor) → Page<Win>` | Cursor pagination on `(occurredAt, id)` |
| `bulkConfirm` | `(winIds[]) → {ok, failed}` | Partial success allowed |
| `getLogSummary` | `(range) → counts, streak, categoryMix, gaps` | Cached 5 min |

### 9.2 REST (extension + email actions)
| Route | Method | Auth |
|---|---|---|
| `/api/extension/wins` | POST, GET | Bearer (existing `ExtensionAccessToken`) |
| `/w/:token` | GET | Signed token, no session |
| `/api/wins/:id/confirm` | POST | Clerk session |

### 9.3 Magic-link action tokens

The email-confirm path must be safe without a session.

- Token = `base64url(HMAC-SHA256(secret, `${digestId}:${winId}:${action}`)) + payload`, 64 chars.
- **Single-use**, recorded against `WeeklyDigest`; replay returns the already-done confirmation page, never an error.
- **Expiry: 30 days** (people read email late; expiring at 7 days breaks the flow).
- Scope: exactly one `(win, action)`. A leaked token can confirm or dismiss one Win — acceptable blast radius. It **cannot** read the log, edit content, or authenticate a session.
- The landing page shows the result plus *"Was this you? [undo]"* and a login CTA.
- Rate limit per token root: 20 actions/minute (Upstash, existing `src/lib/rateLimit.ts`).

### 9.4 Scheduling

Weekly digest and monthly review run as scheduled jobs. Implementation: a Vercel Cron hitting `/api/cron/digests` hourly; the handler selects users whose local send-hour matches the current UTC hour and who have no digest row for the current `weekStart`. Idempotent via the `@@unique([userId, weekStart])` constraint — a double-fire cannot double-send.

Batching: process in chunks of 50 users with a concurrency cap of 5 to protect the model provider and the DB. p95 per user < 90s (guardrail metric).

---

## 10. Entitlements

Add to `MeteredAction` in `src/lib/entitlements.ts`:

| Action | Free | Career | Search | Rationale |
|---|---|---|---|---|
| `win_draft` (per AI structuring call) | 30/mo | UNLIMITED | UNLIMITED | Prevents abuse; 30 is far above real weekly usage |
| `month_in_review` | 0 | UNLIMITED | UNLIMITED | The payoff artifact — a Career-tier hook |

**Log history depth** is a plan attribute, not a quota: Free = rolling 90 days visible (older Wins are retained, not deleted, and are restored on upgrade — say this explicitly in the UI, it builds trust and makes upgrading obvious). Career/Search = unlimited.

Free users still get the weekly digest and can confirm unlimited Wins. **We never gate capture.** Gating capture would starve the graph, which is the asset.

---

## 11. Telemetry

Emit to `FunnelEvent` (web) / `ExtensionEvent` (extension), with `payload.feature = 'work_log'`.

| Event | Payload |
|---|---|
| `win_drafted` | `{source, confidence, hasMetric}` |
| `win_confirmed` | `{source, surface: 'email'\|'telegram'\|'web'\|'extension', secondsFromDraft, edited: bool}` |
| `win_dismissed` | `{source, reason}` |
| `win_edited_field` | `{field}` — tells us which field the AI gets wrong most |
| `digest_sent` / `digest_opened` / `digest_action` | `{digestId, channel, winCount}` |
| `quick_capture_opened` / `submitted` | `{surface, charCount}` |
| `quantify_prompt_shown` / `answered` | `{winId}` |
| `month_in_review_sent` / `opened` | `{winCount}` |

**The two that drive product decisions:** `win_edited_field` (drafting quality by field — if `category` is edited >30% of the time, the taxonomy or the prompt is wrong) and `secondsFromDraft` on confirm (the 20-second bar, measured, per surface).

---

## 12. Edge cases

| Case | Handling |
|---|---|
| Win logged for a date before any `UserExperience` exists | `employerId = null`; inline "which job?" prompt; never block the save |
| Overlapping employments (contractor + FT) | Prompt; do not guess |
| User changes jobs | Wins keep their original `employerId`. New Wins attribute to the new role. The log's employer filter becomes genuinely useful here. |
| Same accomplishment captured twice (PR + manual note) | Near-duplicate detection at draft time: cosine similarity >0.92 against Wins within ±14 days → merge proposal, not a second draft |
| Multi-week effort | `occurredAt` = start, `periodEnd` = end. Packets group by `periodEnd` |
| Timezone changes / travel | `weekStart` computed from the profile timezone at send time; a shift just moves the next digest |
| User deletes their GitHub account | Evidence rows persist with the excerpt (we stored the text, not just a link). The link renders as "source no longer available" |
| Confidential Win already embedded, then downgraded | Sensitivity change to `internal_only`/`confidential` must delete the Qdrant point synchronously before returning success |
| Free user hits 90-day history | Older Wins shown as a locked count ("+41 older wins") — never hidden entirely, never deleted |
| Very long free-text dump (a whole quarter pasted) | Split into multiple Win drafts, max 10 per call, with a "we found 8 wins in that" review screen |
| Model returns a fabricated number | Caught by the no-invention rule + a post-validation check: any digit sequence in `impact` that does not appear in the source text fails validation → retry once → drop `impact` to null |

---

## 13. Acceptance criteria

**R1.1 — Log + manual capture**
- [ ] A user can create a Win from free text in ≤15s (measured: `quick_capture_submitted → win_confirmed`)
- [ ] `structureWin` returns valid structured output for 95% of a 50-sample test corpus
- [ ] No AI-drafted Win contains a number absent from its source text (automated check over the corpus)
- [ ] Confirming a Win creates exactly one `Evidence` + one `ClaimLink(grounded)` per source artifact, verified in an integration test
- [ ] Un-confirming reverses both and removes the Qdrant point
- [ ] `confidential` Wins never appear in tailoring retrieval (integration test asserting the query filter, not the prompt)
- [ ] Log renders 500 Wins with p95 <400ms and correct cursor pagination
- [ ] Full keyboard operation of the review queue: `j/k` navigate, `y` confirm, `n` dismiss, `e` edit

**R1.3 — Weekly ritual**
- [ ] Digest sends at the user's local configured time ±15 min
- [ ] Cron double-fire produces exactly one digest (unique constraint test)
- [ ] Email confirm works with no session, single-use, replay-safe
- [ ] Telegram inline confirm works and updates the message in place
- [ ] Zero-signal weeks do not send a digest; the 3-week nudge fires correctly
- [ ] 4 consecutive unopened digests auto-degrades to biweekly and notifies
- [ ] Unsubscribe honored within one send cycle, and does not disable the product

**R1.4 — Month in Review**
- [ ] Fires on the 1st for users with ≥3 confirmed Wins last month
- [ ] Paragraph references only supplied Wins (automated entity check)
- [ ] Renders correctly in Gmail, Outlook web, Apple Mail (light + dark)

---

## 14. Out of scope for R1

Sharing a Win publicly · team/manager visibility · Slack capture · voice capture · attaching files/screenshots as evidence (R2 — the model supports it, the UI doesn't ship) · retroactive bulk import from Jira history (that's 07-backfill) · win templates.
