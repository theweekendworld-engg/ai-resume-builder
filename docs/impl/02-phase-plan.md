# Implementation 02 — Phased Build Plan (R1)

> **Prereq:** [`01-phase-0-foundation.md`](01-phase-0-foundation.md) complete.
> **Total R1:** ≈ 42–54 engineer-days — **9–11 weeks solo, 5–6 weeks with two engineers.**
> Every phase ships behind its flag, to the team first, then a validation cohort.

**Sequencing rationale.** Phases 1–3 are one causal chain: the log is worthless unless it fills (2), and it won't fill unless the ritual works (3). Phase 4 is the first user payoff. Phase 5 is the first thing anyone would pay for. Phase 6 (backfill) moved out of R2 per PRD 09 §9 D-A — it collapses time-to-value from month 6 to week 1 and is the plan's single biggest risk reducer.

| Phase | Slice | Days | Flag | Ships |
|---|---|---|---|---|
| 1 | The Log | 6–8 | `work_log` | Win model, capture, log surface |
| 2 | GitHub capture | 6–8 | `github_capture` | Connector, drafting, 90-day backfill |
| 3 | Weekly ritual | 5–6 | `weekly_digest` | Digest, magic links, Telegram confirm |
| 4 | Month in Review | 3–4 | `work_log` | First payoff + value receipts |
| 5 | Review packet | 8–10 | `review_packet` | Packet, rubric, readiness |
| 6 | Backfill | 5–6 | `backfill` | Interview agent |
| 7 | Packaging | 4–5 | — | Tiers, paywalls, soft enforcement |

---

# Phase 1 — The Log

**PRD:** [01](../prd/01-work-log.md) · **Exit:** a user creates a Win from free text in ≤15s, confirms it, and the confirm writes `Evidence` + `ClaimLink(grounded)` + a Qdrant point — reversibly.

### Schema — migration `add_work_log`
`WinStatus`, `WinCategory`, `WinSensitivity`, `WinSource` enums + the `Win` model exactly as PRD 01 §7. Four indexes as specced; `signalId` unique (Phase 2 relies on it).

### Tasks

**1.1 Model + graph write path** *(1.5d)* — **write the thesis tests first.**
- `src/services/winGraph.ts`: `confirmWin`, `unconfirmWin` — the transaction in PRD 01 §7.1. Confirm creates `Evidence` (kind mapped by source) + `ClaimLink(claimType:'win', groundState:grounded)` + `ImpactMetric` when quantified; enqueues `embed_win`. Un-confirm reverses all three, including the Qdrant point deletion, **synchronously** before returning.
- `src/lib/graph/visibility.ts` per ADR-8.
- Tests: the three from PRD 08 §10. These gate the phase.

**1.2 `structureWin`** *(1d)*
- `src/services/winDrafting.ts` → `structureWin(text, ctx)` via `generateStructured({task:'winStructure', feature:'work_log', guard:{sourceText:text, fields:['title','narrative','impact']}})`.
- `WinDraftSchema` (PRD 01 §8.1) in `src/lib/aiSchemas.ts` alongside the existing schemas.
- Prompt in `src/agents/prompts.ts` with the five no-invention rules verbatim.
- Async fallback: >4s → save raw draft, enqueue `draft_wins` to structure later.

**1.3 Server actions** *(1d)* — `src/actions/wins.ts`, all eight from PRD 01 §9.1, following P-3. `listWins` uses cursor pagination on `(occurredAt, id)`.

**1.4 Employer attribution** *(0.5d)* — `resolveEmployer(userId, occurredAt)` over `UserExperience` date ranges. Ambiguous or missing → `null` + inline prompt. Never guess on overlap.

**1.5 Log surface** *(2d)* — `src/app/(app)/log/page.tsx` + components. Review-queue block, month-grouped list, filters, right rail with streak/counts/category mix. All states from PRD 01 §6.2 — build the empty state deliberately, it's a new user's first impression.

**1.6 Win drawer** *(1d)* — inline edit of all five fields, sensitivity selector, evidence list, audit line, quantify prompt. Sensitivity downgrade deletes the Qdrant point before returning success.

**1.7 Quick capture** *(1d)* — header button + `⌘K`, textarea → structure on 800ms idle → editable result → `⌘↵`. 8-second undo toast. Extension side-panel action against `/api/extension/wins`.

### Risks
| Risk | Mitigation |
|---|---|
| Confirm transaction partially fails (DB ok, Qdrant down) | Qdrant write is a *job*, not part of the transaction; `embedded=false` until it lands; reconciler catches strays |
| `structureWin` too slow | Async fallback at 4s (1.2) |
| Category taxonomy wrong | Instrument `win_edited_field`; if `category` edits >30%, revisit before Phase 2 |

### Done when
Thesis tests green · 500-win log renders <400ms p95 · full keyboard operation · confidential Win absent from external retrieval (query-layer test) · un-confirm fully reverses.

---

# Phase 2 — GitHub Auto-Capture

**PRD:** [02](../prd/02-auto-capture.md) · **Exit:** connect GitHub, select repos, and ≥1 Win draft exists within 90 seconds; re-sync creates zero duplicates.

### Schema — migration `add_capture_sources`
`CaptureSourceKind`, `CaptureSourceStatus`, `CaptureRunStatus` + `CaptureSource`, `CaptureSignal`, `CaptureRun` per PRD 02 §5. **`CaptureSignal.@@unique([sourceId, externalId])` is the load-bearing constraint** — call it out in the migration comment.

### Tasks

**2.1 Adapter framework** *(1d)* — `src/lib/capture/types.ts` (the `CaptureAdapter` interface, PRD 02 §2.1), `registry.ts`, `pipeline.ts` (`pull → persist signals → filter → group → draft`). Build the framework generically now; calendar in R2 must be one file.

**2.2 GitHub adapter** *(2d)* — `src/lib/capture/adapters/github.ts`, extending the existing Octokit setup in `src/actions/github.ts`.
- Pull the five signal kinds (PRD 02 §3.1) via Search API + per-repo events, ETag-conditional.
- **`externalId` = GitHub node ID, never the PR number.**
- Rate limit: ≤60 requests/sync; on 403/429 persist cursor, return `partial:true`, mark run `degraded` — never fail the digest for an incomplete sync.
- `isNoise` = layers 1 + 3 from PRD 02 §6; `group()` = the deterministic rules in §4.1.

**2.3 Drafting** *(1.5d)* — `src/services/winDrafting.ts` → `draftFromSignalGroup()`. Input assembly is narrow (PRD 02 §4.2) — **never send source code.** Confidence is computed by the §4.3 formula, not asked of the model. Guard `sourceText` = PR title + body + linked issue.

**2.4 Jobs** *(1d)* — `capture_sync_dispatch` (fan-out, hourly), `capture_sync` (per source), `draft_wins` (per batch). Caps: 5 digest drafts/week, 40 initial, 60 model calls/run.

**2.5 Connect flow** *(1.5d)* — onboarding step 2, consent copy **verbatim from PRD 02 §3.2**, repo picker (virtualized, searchable, handles 500 repos, pre-checked for 90-day contributions). Initial sync runs immediately with visible progress.

**2.6 Settings** *(1d)* — `/settings/sources`: status, "exactly what we can see", last run summary, contribution count, sync/pause/edit/disconnect. Both disconnect options from §7.2 — including "delete the wins too", which is what makes the first option trustworthy.

### Fixtures & eval — *this is the phase's real quality gate*
`src/__fixtures__/github/` — 200 real PRs, labeled. Two suites:
- **Noise:** zero bot PRs draft. Binary pass.
- **Accept-rate proxy:** ≥60% of drafts judged usable by a human on a 100-PR labeled set.
- **Zero-fabrication:** no drafted number absent from source. **Hard gate.**

Run the mini-vs-gpt-5 A/B here (PRD 02 §4.2) and pick on accept rate, not price.

### Risks
| Risk | Mitigation |
|---|---|
| Accept rate <50% | Do not proceed to Phase 3. A digest of bad drafts is worse than no digest. Iterate the prompt against fixtures. |
| `repo` scope refused | Public-only mode works; say so in onboarding, never dead-end |
| GitHub API shape drift | Adapter is isolated; fixtures catch changes |

---

# Phase 3 — The Weekly Ritual

**PRD:** [01 §5.2, §9.3](../prd/01-work-log.md) · **Exit:** digest arrives at the user's local time, confirm works with no session in one tap, double-fired cron sends exactly one.

### Schema — migration `add_weekly_digest`
`WeeklyDigest` per PRD 01 §7, with `@@unique([userId, weekStart])`.

### Tasks

**3.1 Magic-link tokens** *(1d)* — `src/lib/winTokens.ts`. HMAC-SHA256 over `${digestId}:${winId}:${action}`, single-use, 30-day expiry, one `(win, action)` scope. Replay renders the already-done page, never an error. Rate limit 20/min per token root via existing Upstash setup. **Security review this file specifically** — it's the only unauthenticated write path in the product.

**3.2 Dispatch + send jobs** *(1d)* — `weekly_digest_dispatch` computes due users by derived schedule (ADR-3), fans out. `weekly_digest` per user: gather ≤5 drafts by confidence, create the row, render, send. **Zero signals → `skipped: true`, no send** (PRD 01 §5.2). The 3-empty-week nudge and 4-unopened auto-degrade to biweekly both live here.

**3.3 Email template** *(1.5d)* — the layout in PRD 01 §5.2 is the spec. Three buttons per Win, all magic links. Streak footer. Test in Gmail, Outlook web, Apple Mail, light and dark, images-off.

**3.4 Action landing page** *(0.5d)* — `/w/[token]`: perform, confirm visually, offer undo, CTA to open the log. Must be fast and work logged-out.

**3.5 Telegram variant** *(1d)* — inline keyboard via existing `sendTelegramMessage` + `answerTelegramCallbackQuery`. Edit the message in place on action. Route callbacks in the existing webhook handler.

**3.6 Preferences UI** *(0.5d)* — `/settings/notifications`: channel, day, hour, per-category toggles, unsubscribe.

### Risks
| Risk | Mitigation |
|---|---|
| Deliverability (digest lands in spam) | Subdomain + SPF/DKIM/DMARC from P0.3; monitor bounce/complaint; warm gradually |
| Token leakage | Single-use, single-scope, one Win, cannot read or authenticate |
| Digest fatigue | Zero-signal skip, 6-day floor, auto-degrade to biweekly |

### Done when
Local-time accuracy ±15 min · exactly one digest under double-fire · logged-out confirm works · Telegram edits in place · unsubscribe honored in one cycle.

---

# Phase 4 — Month in Review & Value Receipts

**PRD:** [01 §6.4](../prd/01-work-log.md), [09 §4](../prd/09-value-model.md) · **Exit:** the first scheduled payoff lands, and the log states what the record is worth.

**Small phase, disproportionate importance** — it is the *only* payoff before month 6 (PRD 09 §3). Copy quality is a launch blocker; owner reviews it.

**4.1 `composeMonthInReview`** *(1d)* — `generateStructured({task:'monthReview'})` with `VoiceProfile.styleDescriptor` if present; guard against the month's Wins. Entity check: no reference outside the supplied set.

**4.2 Job + email** *(1d)* — `month_in_review_dispatch` on the 1st, users with ≥3 confirmed Wins last month. Five blocks per PRD 01 §6.4. Web view at `/log/review/[yyyy-mm]`.

**4.3 Value receipts** *(1d)* — PRD 09 §4 M1 and M3:
- Standing statement in the log header: *"74 wins · 3 years · 61 with evidence — enough for a promotion packet, a resume, and a negotiation dossier, on demand."*
- Receipt line on every generated artifact, including the count of wins older than 90 days.
- The counterfactual prompt (M2) — built here, first used in Phase 5.

---

# Phase 5 — Review Packet & Rubric

**PRD:** [03](../prd/03-review-packet.md) · **Exit:** 40 wins → a packet in <60s that a user would actually send, every sentence traceable.

**Largest phase.** Use the `workflow` SDK (ADR-1 tier A), mirroring `src/workflows/generationSession.ts` — the user watches this run and it must survive a refresh.

### Schema — migration `add_review_packets`
`FrameworkSource`, `PacketType`, `PacketStatus` + `CompetencyFramework`, `ReviewPacket` per PRD 03 §6.

**5.1 Framework ingestion** *(2d)* — upload (reuse `src/lib/pdfParser.ts`, `docxParser.ts`), paste, or URL → AI extract → **confirmation screen** with inline editing. Never generate against an unconfirmed framework. Seed six public templates as system rows. Mark user frameworks `isConfidential`.

**5.2 Packet workflow** *(3d)* — `src/workflows/reviewPacket.ts` + steps:
`load_wins → group_themes → map_competencies → compose → ground → persist`
Three AI contracts from PRD 03 §7, each guarded. Grounding reuses `src/services/claimGrounding.ts`. SSE progress via existing `src/lib/generationProgress.ts` with the visible stage labels from PRD 03 §3.1. Deterministic fallback: theme grouping failure → category grouping, no error surfaced.

**5.3 Packet editor** *(2d)* — block-level inline edit persisted to `userEdits` (survives regeneration by block key), hover-to-source on every sentence, per-section regenerate with optional instruction, `⚠` chips on ungrounded sentences.

**5.4 Export** *(1d)* — Markdown (the primary real use — must paste cleanly into Google Docs and Lattice), PDF via the existing path, plain text, copy-section. Confidential pre-export prompt, choice remembered per packet.

**5.5 Readiness report** *(1.5d)* — standalone at `/log/readiness`, computed not stored, 15-min cache. The gap report layout from PRD 03 §4.3 including **"you have unlogged evidence"** — query dismissed/undrafted signals matching the weak competency and link to them. *This is the loop-closing interaction; don't cut it.*

**5.6 Review-date nudges** *(0.5d)* — T-90 / T-30 / T-7 jobs off `EmailPreference`. T-90 is the highest-value email the product sends.

### Eval
20-packet corpus: zero fabricated numbers (hard gate) · every sentence maps to ≥1 win ID · theme count 3–5 or a coherence note · 15-rubric parse set at ≥85% field accuracy.

### Risks
| Risk | Mitigation |
|---|---|
| Packet reads as AI slop | Voice profile if present; banned-token list; **owner reads 10 real packets before launch** |
| Gap report too soft to be useful | Explicit prompt instruction that under-claiming is correct; owner reviews tone |
| >60s generation | Batch the mapping call; cache theme grouping by win-set hash |

---

# Phase 6 — Backfill

**PRD:** [07](../prd/07-backfill.md) · **Exit:** a user reconstructs one employer in 8–12 questions and confirms ≥6 Wins.
**Moved from R2** per PRD 09 §9 D-A — the only lever that moves first-large-value from month 6 to week 1.

### Schema — migration `add_interview_sessions`
`InterviewStatus`, `InterviewSubject`, `InterviewSession` per PRD 07 §5.2.

**6.1 Agent + tools** *(2d)* — `src/agents/backfillAgent.ts` on the existing `resumeAgent` pattern; six tools from PRD 07 §5.1 in `src/agents/tools/backfill.ts`. Wins persist **at capture**, not at session end.

**6.2 Chat surface** *(2d)* — split view (PRD 07 §3.4). Reuse SSE streaming. **The right rail is the product** — it must update within 2s of each answer. Progress indicator, "I don't remember" button, resumable for 30 days.

**6.3 Review + close** *(1d)* — bulk confirm screen, the closing screen with real counts and the before/after comparison.

**6.4 Entry points** *(0.5d)* — the six from PRD 07 §2. **Never in first-run onboarding.**

### Eval
20 scripted transcripts: no leading questions (automated pattern check on `would you say`, `around \d+`, `roughly \d+%` — hard gate) · zero `ImpactMetric` figures the user didn't state · completion ≥60% in a 20-user internal test.

---

# Phase 7 — Packaging & Soft Paywall

**PRD:** [06](../prd/06-packaging-entitlements.md) · **Exit:** every metered action is gated and instrumented; paywalls render with the user's own data; nothing blocks yet.

**7.1 Plan catalog** *(1d)* — `src/lib/plans.ts` with `PLAN_CATALOG`, `PLAN_FEATURES`, numeric limits. **Keep the `Tier` enum unchanged** (ADR/00 D4). CI grep gate: no raw enum value rendered.

**7.2 Entitlement extensions** *(1d)* — new `MeteredAction` values, `hasFeature`/`requireFeature`, `logHistoryDays`, `sourceLimit`. **Add `refundMeteredAction`** — missing today, and users will notice a quota burned by a failed generation.

**7.3 Stripe wiring** *(1d)* — three prices; Search as a *separate* subscription (PRD 06 §5.2); effective tier = max order across active subs. Optimistic grant on redirect, webhook reconcile, idempotency key.

**7.4 Paywall surfaces** *(1.5d)* — PW1–PW7 with the exact copy. Every one shows real user data (win count, gap name, band `n`). Soft mode: render, record `entitlement_soft_allowed`, allow through.

**7.5 Plan settings + proactive downgrade** *(1d)* — `/settings/plan` with live usage vs. limits. The §5.3 downgrade offer triggered by workspace status `offer`. Export in ≤2 clicks from the cancel flow.

---

# Phase 8 — R2 preview (not scheduled here)

Career Radar (board ingestion, comp extraction, matching, monthly digest) · Missions + IA collapse · calendar and Linear connectors · 1:1 prep · monetization launch. Specced in PRDs 04, 05; sequence after R1's exit criterion is measured, not before.

---

## Cross-phase rules

1. **Flag off → merge → enable for team → cohort.** No phase goes to all users on merge day.
2. **Fixtures before prompts.** Every AI feature gets its eval corpus first; otherwise "it seems better" is the only available judgment.
3. **The three thesis tests run in CI on every commit.** They are the moat's regression suite.
4. **Weekly: open `/admin/ops`.** Check accept rate, cost vs. tripwires, dead jobs, funnel. Fifteen minutes; it's the whole observability strategy.
5. **Every phase adds its telemetry events in the same PR as the feature.** Retrofitting instrumentation never happens.

## Gate between Phase 2 and Phase 3

**Do not build the ritual until draft accept rate clears 60% on fixtures.** A weekly email of mediocre drafts trains users to ignore it, and that habit is unrecoverable. If accept rate stalls, spend the time on the drafting prompt and the noise rules — that work is worth more than the next feature.

## R1 exit criterion (from PRD 00 §6)

> An employed user with GitHub connected receives a weekly digest, confirms Wins in under 20 seconds, and generates a review packet they would actually send.
> **Measured: log-fill rate ≥ 40%** — activated users with ≥3 confirmed Wins by day 21.

Everything above is in service of that one number. If it comes in under 25%, the problem is Phase 2 or Phase 3, not the roadmap — fix the drafting or the ritual before building anything in R2.
