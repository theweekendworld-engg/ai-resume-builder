# Patronus Career OS — PRD 00: Overview & Index

> **Status:** `Draft for build` · **Owner:** Product · **Date:** 2026-08-01
> **Parent strategy:** [`../career-os-v3.md`](../career-os-v3.md)
> **Supersedes at the feature level:** nothing. Extends `product-strategy-v2.md` and `architecture-master-plan-v2.md`.

---

## 1. Why this PRD set exists

The v3 strategy argues that the product's kernel is **the evidence-backed Win**, not the resume bullet. This set of documents specifies that kernel and everything built on it, at the level of detail an engineer can implement from without needing to make product decisions.

**Rule for readers:** if a document leaves a product decision open, it is listed in §9 "Open decisions." Anything not listed there is decided — build it as written, and raise a change request if it's wrong.

### Documents
| # | Doc | Covers | Release |
|---|---|---|---|
| 00 | **This document** | Personas, principles, object model, release plan, metrics | — |
| 01 | [`01-work-log.md`](01-work-log.md) | The Win object, manual capture, the weekly ritual, the Log surface | R1 |
| 02 | [`02-auto-capture.md`](02-auto-capture.md) | Connector framework, GitHub auto-draft, consent, sync engine | R1 |
| 03 | [`03-review-packet.md`](03-review-packet.md) | Review/promo packet generator, competency rubric mapping, 1:1 prep | R1 |
| 04 | [`04-career-radar.md`](04-career-radar.md) | Market value band, role matches, skill economics, monthly digest | R2 |
| 05 | [`05-missions.md`](05-missions.md) | The process model, mission catalog, IA collapse | R2 |
| 06 | [`06-packaging-entitlements.md`](06-packaging-entitlements.md) | Tiers, paywall moments, quotas, upgrade/downgrade/pause | R1 |
| 07 | [`07-backfill.md`](07-backfill.md) | Retargeted Context Interview — reconstructing pre-Patronus years | R2 |
| 08 | [`08-cross-cutting.md`](08-cross-cutting.md) | Privacy, consent, export/delete, telemetry, perf, cost, a11y, error taxonomy | R1 |
| 09 | [`09-value-model.md`](09-value-model.md) | What the user actually gets, quantified · the month-6 problem · what's thin | all |

---

## 2. Personas

We build for three. Every feature spec states which persona it serves.

### P1 — **Maya, the Quietly Employed** *(primary, new in v3)*
Senior backend engineer, 7 years experience, at her company 2.5 years. Not looking. Review cycle in March and September. Last promo cycle she spent a frantic weekend scrolling Slack and Jira trying to remember what she'd done, wrote a mediocre packet, and got "strong but not yet" feedback she suspects was really "you didn't make your case."

- **Frequency:** weekly touch (2 min), monthly touch (5 min), 2× yearly deep session (45 min).
- **Willingness to pay:** high at review season, near-zero in month 3 of a quiet quarter → **must be sold annually.**
- **What makes her stay:** the log has 18 months in it and re-creating that is impossible.
- **What makes her leave:** three unanswered weekly prompts in a row. Silence is churn.

### P2 — **Dev, the Active Switcher** *(the monetization spike)*
Same person, 14 months later, laid off or fed up. 6–10 week hunt, 40 applications.
- Needs everything v2 already specs: tailoring, apply, tracking, interview prep, negotiation.
- **Value of the log:** his resume writes itself from 3 years of dated, evidenced Wins. This is the single biggest quality delta vs. every competitor.

### P3 — **The Buyer** *(B2B, R3+)*
HR/People lead purchasing outplacement or internal-mobility. Not specced in R1–R2 beyond **not foreclosing** it: data model must support org scoping and the individual/employer firewall (see 08 §7).

**Explicitly not a persona in R1–R2:** students/new grads. Their log is empty, which breaks the kernel. Serve them later via 07-backfill + a coursework capture source.

---

## 3. Jobs to be done

Ordered by how often they recur. This ordering is the roadmap's logic.

| JTBD | Frequency | Feature | Doc |
|---|---|---|---|
| "Help me not forget what I did this week" | Weekly | Work Log capture | 01, 02 |
| "Tell me what to raise in my 1:1" | Weekly | 1:1 prep | 03 |
| "Am I falling behind / underpaid?" | Monthly | Career Radar | 04 |
| "Make my case for this review cycle" | 2×/yr | Review packet | 03 |
| "What do I need for the next level?" | 2×/yr | Rubric gap analysis | 03 |
| "Get me a resume for this specific job" | Episodic (hunt) | Tailoring (exists) | v2 |
| "Apply without retyping" | Episodic (hunt) | Extension (exists) | v2 |
| "Should I take this offer / can I get more?" | Rare, high stakes | Negotiation dossier | 05 |

---

## 4. Product principles

These resolve arguments during implementation. Cite them in PRs.

1. **Confirm, never compose.** Any capture surface that asks the user to *write* has failed. The default interaction is reviewing an AI-drafted Win and tapping ✓. Free-text is the escape hatch, not the path.
2. **Twenty seconds.** The weekly ritual must be completable in under 20 seconds on a phone. Anything that pushes past that gets cut, not shrunk.
3. **The log is private by default.** Nothing a user logs leaves their account without an explicit, per-artifact action. There is no feed, no social graph, no "share to network."
4. **Fail closed on truth.** Inherited from v2 §4.1 and non-negotiable. An AI-drafted Win is `draft` until a human confirms it. Drafts never reach a resume, a packet, or an embedding used for external output.
5. **Every write enriches the graph.** A confirmed Win writes `Evidence(confirmedByUser=true)` + `ClaimLink(groundState=grounded)`. If a feature captures user truth and doesn't write to the evidence layer, it's built wrong.
6. **Payoff within three weeks.** A user who has logged for 3 weeks must receive something valuable without asking (the Month in Review). Delayed gratification kills the habit.
7. **The record is theirs.** Full export, always, one click, no downgrade penalty. This is a marketing weapon, not just a compliance checkbox.
8. **Reuse before building.** The evidence layer, entitlement gate, Channel infra, GitHub Octokit client, SSE progress, and Qdrant embedding path all exist. Specs below name the exact modules to extend.

---

## 5. The object model at a glance

```
                         ┌──────────────────────────┐
   CaptureSource ───────▶│      CaptureSignal        │  raw item from a connector
   (github, calendar…)   │  (PR #482, meeting, …)    │  deduped by (source, externalId)
                         └────────────┬─────────────┘
                                      │  AI draft
                                      ▼
   quick capture ──────────────▶ ┌──────────┐        confirm      ┌───────────────┐
   weekly digest reply ────────▶ │   WIN    │ ──────────────────▶ │   Evidence    │
   ambient (cover letter…) ────▶ │  draft   │                     │ +  ClaimLink  │
   backfill interview ─────────▶ └────┬─────┘                     │ + ImpactMetric│
                                      │                            └───────┬───────┘
                                      │ confirmed                          │
                                      ▼                                    ▼
              ┌───────────────────────────────────────────────────────────────┐
              │            CAREER CONTEXT GRAPH  (Postgres + Qdrant)           │
              └───────────────────────────────────────────────────────────────┘
                    │              │              │              │
                    ▼              ▼              ▼              ▼
              ReviewPacket    1:1 Prep      RadarSnapshot   Tailored resume
              (03)            (03)          (04)            (v2, existing)
```

**The single most important arrow** is `Win.confirm → Evidence`. It is why the retention loop and the moat are the same mechanism. Any refactor that breaks it breaks the thesis.

### New Prisma models introduced across this PRD set
| Model | Doc | Purpose |
|---|---|---|
| `Win` | 01 | The atomic accomplishment |
| `WeeklyDigest` | 01 | One ritual instance, for dedupe + response analytics |
| `CaptureSource` | 02 | A connected data source + its consent record |
| `CaptureSignal` | 02 | A raw item pulled from a source (idempotency key) |
| `CaptureRun` | 02 | One sync execution (observability) |
| `CompetencyFramework` | 03 | The user's leveling rubric |
| `ReviewPacket` | 03 | A generated packet + its inputs |
| `JobSource`, `JobPosting` | 04 | Public board ingestion |
| `SkillSignal` | 04 | Market skill demand rollup |
| `RadarSnapshot` | 04 | A user's monthly market read |
| `Mission`, `MissionStep` | 05 | The process model |

### Existing models reused (do not duplicate)
`Evidence`, `ClaimLink`, `ImpactMetric` (evidence layer — already migrated), `UserExperience` (employer boundaries), `UserProject`, `Subscription`, `UsageQuota`, `ChannelIdentity`, `ApiUsageLog`, `ApplicationWorkspace`.

---

## 6. Release plan

Releases are **capability gates**, not dates. A release ships when its exit criterion is met.

### R1 — "The log, and a reason to pay while employed" (~6–8 weeks)
Docs 01, 02, 03, 06, 08.

| Slice | Contents |
|---|---|
| R1.1 | `Win` model + manual quick capture + Log surface (web) |
| R1.2 | GitHub connector + signal→draft pipeline |
| R1.3 | Weekly digest ritual (email + Telegram) + one-tap confirm |
| R1.4 | Month in Review (the 3-week payoff) |
| R1.5 | Review packet generator + rubric mapping |
| R1.6 | Repackaged tiers, soft paywall, pause/resume |

**Exit criterion:** an employed user with GitHub connected receives a weekly digest, confirms Wins in <20s, and can generate a review packet that they would actually send to their manager. Measured: **log-fill rate ≥ 40%** of activated users have ≥3 confirmed Wins by day 21.

### R2 — "The ritual and the trigger" (~8–16 weeks)
Docs 04, 05, 07 + calendar/Linear connectors + 1:1 prep + monetization launch.

**Exit criterion:** weekly-active-while-employed ≥ 25% of the Career tier, and Radar produces a measurable Career→Search conversion.

### R3 — "Own the outcome" (later)
Negotiation dossier, interview prep from graph, coaching analytics, corroboration/verified profile, outplacement B2B.

---

## 7. Metrics tree

One north star per release, with the instrumented leading indicators.

```
R1 NORTH STAR: log-fill rate
   = % of activated users with ≥3 confirmed Wins within 21 days
   ├── connector connect rate (% who connect GitHub in onboarding)
   ├── draft accept rate (confirmed / drafted)      ← quality of AI drafting
   ├── digest open rate                              ← subject line + channel
   ├── digest open→confirm rate                      ← the 20-second bar
   └── time-to-first-confirmed-Win (target: < 5 min from signup)

R2 NORTH STAR: weekly-active-while-employed
   ├── week-over-week digest response retention (W1→W4→W12)
   ├── radar open rate
   └── 1:1 prep opens per user per month

BUSINESS
   ├── Career-tier annual retention (target > 70%)
   ├── Search attach rate per hunt
   ├── Career→Search conversion within 14d of a radar trigger
   └── % of users still active 6 months after marking "hired"   ← the thesis metric
```

**Guardrail metrics** (a feature that moves these the wrong way gets rolled back):
- Digest unsubscribe rate < 2% / month
- Connector revocation rate < 5%
- p95 weekly digest generation < 90s/user
- Cost per active user per month < $0.60 (tracked via `ApiUsageLog` feature tags)

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Win** | A dated, evidence-linked accomplishment. The atomic unit of the OS. |
| **Signal** | A raw item from a connector (a PR, a meeting) before AI turns it into a Win draft. |
| **Draft / Confirmed** | A Win's status. Drafts are AI-proposed; only confirmed Wins are truth. |
| **Sensitivity** | `shareable` / `internal_only` / `confidential`. Controls where a Win may appear. |
| **The ritual** | The weekly digest → confirm loop. The habit the whole product depends on. |
| **Packet** | A generated review/promo document. |
| **Radar** | The monthly market intelligence read. |
| **Mission** | A multi-week guided program (get promoted, land a role…). |
| **The graph** | The Career Context Graph: Postgres entities + evidence + Qdrant embeddings. |

---

## 9. Open decisions

Everything else in these docs is decided. These need an owner call before the slice that depends on them.

| # | Decision | Depends on | Recommendation |
|---|---|---|---|
| D1 | Weekly digest default channel: email or Telegram? | R1.3 | **Email default, Telegram opt-in.** Email has universal reach; Telegram has better confirm UX. Ship both, default email. |
| D2 | Does the free tier get the work log at all? | R1.6 | **Yes, with 90-day history.** The log is the habit; gating it kills the funnel. Monetize *history depth* + packets. |
| D3 | Annual price point: $99 vs $129? | R1.6 | **$99 launch, grandfathered.** Land the habit; raise for cohort 2. |
| D4 | Rename `Tier.always_on` → `career` in the enum, or map in a catalog? | R1.6 | **Map in a catalog.** Avoid a migration on a live billing table; display names live in `PLAN_CATALOG`. |
| D5 | Slack as a capture source in R2? | R2 | **No.** Highest consent friction, lowest signal quality. Calendar + Linear/Jira first. |
| D6 | Do we ever let a manager see a packet directly? | R3 | **Not in R1–R2.** Export to PDF/Markdown and let the user send it. Sharing invites the two-sided complexity we're deferring. |
