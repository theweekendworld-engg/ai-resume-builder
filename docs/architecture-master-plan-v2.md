# Patronus — Engineering Architecture & Master Build Plan (v2)

## Status
- Document state: `Proposed` — the technical realization of `product-strategy-v2.md`.
- Author: Senior AI Architect pass, 2026-06-27.
- Relationship to other docs: `product-strategy-v2.md` is the *why/what*. The `one-stop-platform-plan.md`, `resume-builder-experience-plan.md`, and the phase specs are the *how* for individual subsystems. **This document is the spine that connects strategy to the codebase as it actually exists today**, re-sequences the work against verified reality, and names the architecture decisions that aren't in any other doc.
- Primary payer (locked, §1.5 of strategy): **the Always-On Professional**. Retention-first. Every sequencing choice below optimizes *months-active* and *profile-warm-at-90-days*, not free→Pro velocity.

---

## 0. The architecture thesis

> The strategy says "the moat is the Career Context Graph." **Today that graph does not exist as a graph** — it is a flat list of embedded items with no evidence, no impact structure, no voice, and no feedback loop. Building it *is* the program. Every other feature is either (a) a producer that enriches the graph, or (b) a consumer that the graph makes better.

So the plan is organized around one architectural commitment:

```
            PRODUCERS                    THE GRAPH                  CONSUMERS
   ┌───────────────────────┐    ┌─────────────────────┐   ┌────────────────────────┐
   │ Context Interview      │    │  CAREER CONTEXT GRAPH│   │ Truthful tailoring       │
   │ Multi-source ingestion │───▶│  • entities          │──▶│ Apply / autofill         │
   │ Continuous capture     │    │  • impact metrics    │   │ Question drafting        │
   │ Apply/edit feedback    │    │  • evidence links    │   │ Match digest             │
   │ GitHub / resume import │    │  • voice profile     │   │ Interview prep / coaching│
   └───────────────────────┘    │  • feedback signals  │   └────────────────────────┘
            ▲                    └─────────────────────┘            │
            │                              ▲                        │
            └──────────── feedback signals flow back ──────────────┘
```

The compounding loop is the moat. Every consumer emits a feedback signal (accepted/edited/rejected bullet, inserted answer, fit-score outcome) that re-enters the graph as a producer. That loop is what makes application #50 dramatically better than #1 — and it is exactly what does not exist yet.

---

## 1. Verified current-state baseline

This is the honest inventory the rest of the plan builds on (verified against the codebase, not the strategy doc's ✅ marks).

### What is genuinely solid (reuse, don't rebuild)
- **Stack:** Next.js 16 / React 19, Bun, Prisma + Postgres (Supabase), Qdrant, Clerk auth, Vercel Blob, Upstash rate-limit. Clean.
- **Generation pipeline:** 7-stage `GenerationSession` state machine (`reuse_check → jd_parsing → semantic_search → static_data_load → [clarify] → paraphrasing → resume_assembly → claim_validation → ats_scoring → pdf_generation`). Orchestrated via the `workflow` SDK. Solid backbone. (`src/actions/generateResume.ts`, `src/workflows/`)
- **Streaming progress ("generation theater"):** SSE endpoint `src/app/api/generate/stream/route.ts` + `GlobalGenerationBanner.tsx` + stage labels in `src/lib/generationProgress.ts`. **Already built.**
- **Embeddings + retrieval:** `text-embedding-3-large` (3072d) into Qdrant `knowledge_base` collection, filtered by `userId`/`type`. (`src/actions/embed.ts`)
- **GitHub ingestion:** Real Octokit integration (OAuth + manual), README cleaning, repo→`UserProject`. (`src/actions/github.ts`)
- **Resume import:** PDF (`pdfjs-dist`) + DOCX (`mammoth`) → AI parse → structured. State-machine'd via `ResumeImportSession`.
- **Cost tracking:** Per-call `ApiUsageLog` + monthly `UserUsageSummary`, with pricing table and monthly caps. (`src/lib/usageTracker.ts`)
- **Extension (MV3, Vite+React):** Page detection (8 platforms), DOM reduction, safe autofill w/ per-field confidence + undo, fit-score on page, question drafting (3 tones), per-tab multi-step `ApplicationSession`, bearer-token auth, telemetry. **Phase-1 complete.**
- **Apply persistence:** `ApplicationWorkspace` + `ApplicationQuestion` + `ReusableAnswer` + `CompanyInsight` models all exist; web inbox renders (`ApplicationsSection.tsx`).
- **Agent abstraction:** `src/agents/resumeAgent.ts` + tool modules (jd/retrieval/generation/validation) over the Vercel AI SDK. Good seam for new agents.

### What is heuristic and must be upgraded to be defensible
- **Claim validator** (`src/services/claimValidator.ts`): token-overlap ≥22% + metric presence. Brittle; cannot back a brand promise of "never invents anything."
- **ATS scorer** (`src/services/atsScorer.ts`): substring keyword match, clamped [40,95]. Fine as free table-stakes; not a Jobscan-killer on its own.

### What is stubbed (wiring, not greenfield)
- Extension **Tailor** route (placeholder) — backend `/api/extension/resume/generate` already exists.
- Extension **Workspaces** inbox (placeholder) — backend orchestrate route + web inbox exist.
- **Answer memory** — `ReusableAnswer` model + `/questions/save` exist; no browse/reuse/auto-match UI or write-back logic.
- **Status state machine** — `applicationStatus` is a free string defaulting to `"discovered"`; no enum, no lifecycle, no auto-detection.

### What is entirely greenfield (the real new build)
1. **Billing & entitlements** (Stripe, plans, quota enforcement at the action layer).
2. **The Context Graph upgrade** (evidence layer, impact records, voice profile, feedback signals, edges).
3. **The Context Interview** agent.
4. **Continuous capture.**
5. **Match digest** (public-board ingestion → fit → digest).
6. **Follow-up nudges & auto-status detection.**
7. **Voice matching.**
8. **Coaching analytics** (interviews-per-10).
9. **LinkedIn export import.**

---

## 2. Target architecture (layered)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ SURFACES        Web app (Next.js)   │   Chrome extension   │  Channels      │
│                 dashboard/editor    │   sidepanel/content  │  (Telegram/    │
│                                     │                      │   email)       │
├──────────────────────────────────────────────────────────────────────────┤
│ ENTITLEMENTS    Plan + quota gate  (wraps every metered AI action)          │
│  (NEW)          Stripe ⇆ Subscription ⇆ Entitlement service                 │
├──────────────────────────────────────────────────────────────────────────┤
│ ENGINES         Tailoring   │ Truthfulness │ Interview │ Match │ Coaching   │
│                 pipeline ✅  │ engine ⬆     │ agent NEW │ NEW   │ analytics  │
│                 Apply        │ Voice NEW    │ Continuous capture NEW         │
│                 orchestrator │              │                                │
├──────────────────────────────────────────────────────────────────────────┤
│ CONTEXT GRAPH   Postgres entities + edges + evidence + impact + voice       │
│  (the moat)     ⇆ Qdrant (semantic) ⇆ feedback signal log                   │
├──────────────────────────────────────────────────────────────────────────┤
│ PLATFORM        Prisma/Postgres · Qdrant · Clerk · Blob · Upstash · Workflow│
│                 AI provider abstraction (OpenAI today; multi-provider seam)  │
└──────────────────────────────────────────────────────────────────────────┘
```

Two new horizontal layers (**Entitlements**, the upgraded **Context Graph**) plus four new engines. Everything else is reuse or wiring.

---

## 3. The Career Context Graph — data-model evolution (the moat)

This is the highest-leverage architectural work. Today's models stay; we add the layers that make them a *graph* and a *truth substrate*.

### 3.1 Evidence layer (foundation of the truthfulness guarantee)
Every claim that can appear on a resume must be traceable to a source.

```prisma
model Evidence {
  id          String   @id @default(cuid())
  userId      String
  kind        EvidenceKind   // repo | metric_confirmed | document | url | interview_assertion | import
  sourceRef   String         // e.g. github repo id, blob key, URL, ResumeImportSession id
  excerpt     String         // the supporting text/snippet
  confidence  Float    @default(1.0)
  confirmedByUser Boolean @default(false)
  createdAt   DateTime @default(now())
  @@index([userId, kind])
}

model ClaimLink {            // join: a claim (bullet/skill/impact) ⇄ its evidence
  id          String   @id @default(cuid())
  userId      String
  claimType   String         // experience_highlight | project_bullet | impact_metric | skill
  claimRefId  String         // points at UserExperience/UserProject/ImpactMetric/etc.
  evidenceId  String
  groundState GroundState @default(needs_confirmation) // grounded | needs_confirmation | unsupported
  @@index([userId, claimType, claimRefId])
  @@index([evidenceId])
}
```

This is what powers the visible **✓ grounded / ⚠ needs your confirmation** chips. No claim renders on a tailored resume without a `ClaimLink` resolving to `grounded` or an explicit user confirmation.

### 3.2 Impact metrics (the Context Interview's structured output)
The thing generic rewrites can never invent.

```prisma
model ImpactMetric {
  id          String  @id @default(cuid())
  userId      String
  subjectType String   // experience | project
  subjectId   String
  statement   String   // "cut p95 latency"
  metric      String   // "p95 latency"
  baseline    String?  // "800ms"
  result      String?  // "180ms"
  delta       String?  // "-77%"
  timeframe   String?  // "Q2 2025, 6 weeks"
  scope       String?  // "checkout service, 2M req/day"
  source      String   // interview | import | github | manual
  embedded    Boolean @default(false)
  qdrantPointId String?
  @@index([userId, subjectType, subjectId])
}
```

### 3.3 Voice profile (sound human, not ChatGPT)
```prisma
model VoiceProfile {
  id            String @id @default(cuid())
  userId        String @unique
  sampleText    String          // the user's real writing sample
  styleDescriptor Json          // extracted: sentence length, formality, verb preferences, jargon density
  embeddingId   String?         // optional Qdrant point for style retrieval
  updatedAt     DateTime @updatedAt
}
```
Consumed by the paraphraser and the question drafter as a style-conditioning input.

### 3.4 Feedback signals (the compounding loop)
```prisma
model GraphFeedback {
  id          String  @id @default(cuid())
  userId      String
  signal      String   // bullet_accepted | bullet_edited | bullet_rejected | answer_inserted | fit_outcome
  targetType  String
  targetId    String
  payload     Json     // edited text, score delta, etc.
  createdAt   DateTime @default(now())
  @@index([userId, signal, createdAt])
}
```
Every consumer writes here. A nightly job (or on-write trigger) folds high-signal feedback back into the graph: an edited bullet updates the canonical phrasing; a repeatedly-rejected framing gets down-weighted in retrieval.

### 3.5 Profile strength (drives graph richness)
Computed, not stored raw — a `profileStrength(userId)` service returning a 0–100 score + a prioritized "what's missing and what it unlocks" list. Cache the result on `UserProfile.preferences` or a small `ProfileStrength` row. This is the gamified meter (free) that pulls users into enriching the graph.

### 3.6 Why Postgres, not a graph DB
The "graph" is shallow and user-scoped (hundreds of nodes per user, not millions of cross-user edges). Adjacency via indexed join tables in Postgres + Qdrant for semantic edges is the pragmatic choice — no new infra, transactional with the rest of the app. Revisit only if cross-user graph queries (e.g. coach cohort analytics) ever demand it.

---

## 4. The four new/upgraded engines

### 4.1 Truthfulness Engine (upgrade `claimValidator`)
This is the brand. It is designed as a system with a non-negotiable invariant, two enforcement points, and a feedback hook — not just a smarter validator.

#### The invariant: fail closed
> **Any claim the engine cannot *positively* ground defaults to `needs_confirmation`. It never silently resolves to `grounded`.** An errored, timed-out, or low-confidence grounding call resolves *down*, never up.

For a brand built on "never invents anything," the only acceptable failure mode is being *over-cautious* (a true claim flagged for confirmation), never *over-confident* (a fabricated claim shown as grounded). Every design choice below follows from this.

#### Two enforcement points: constrain at the source, then verify
Verify-only is too weak — the paraphraser (`src/services/paraphraser.ts`) is *where fabrication is introduced* when it rewrites bullets. So grounding happens twice:

1. **Constrain at generation.** The paraphraser is given the user's `Evidence`/`ImpactMetric` records as the *only* permitted factual substrate, with an explicit instruction: rephrase freely, but introduce no new quantities, scopes, or outcomes. This removes most fabrication before it exists.
2. **Verify at validation** (the safety net), three-tier cheapest-first:
   - **Tier 0 — heuristic pre-filter** (existing): token overlap + metric presence. Free, fast, catches the obvious.
   - **Tier 1 — evidence resolution**: does the claim resolve to a `grounded` `ClaimLink`? Pure DB lookup.
   - **Tier 2 — semantic grounding** (NEW): claims that pass Tier 0 but lack a hard evidence link get an entailment check — "is this bullet entailed by the user's source material?" **Tier 2 must cite the exact supporting snippet; no citation → not grounded.** The cited snippet is persisted as `Evidence`, so grounding work is never repeated.

#### Metrics are a separate, stricter path
Numbers are the highest-risk, highest-value claims and the brand-fatal failure mode. They do **not** go through fuzzy entailment:
- A metric claim is grounded **only** by exact correspondence to a structured `ImpactMetric` row (or user-confirmed `Evidence`).
- A metric with no such backing is `unsupported` — not `needs_confirmation`. It is removed from the draft entirely unless the user explicitly adds it. The engine never *asks* "did you really cut latency 77%?"; it simply won't print an unverified number.

#### Verdicts surface as a *capture surface*, not just a warning
The chip taxonomy is `grounded ✓ / needs_confirmation ⚠ / unsupported ✗`. The key architectural move: **confirming a `needs_confirmation` chip is one click that writes `Evidence(confirmedByUser=true)` back to the graph**, permanently upgrading the claim to `grounded`. So truthfulness is wired into the compounding loop (§3.4) — every confirmation enriches the moat. The chip is a producer, not just a UI state.

This also defines the relationship to the **Context Interview (B1)**: the chips are the *one-at-a-time* resolution path; the interview is the *bulk* resolution path that proactively grounds weak claims before they ever appear as ⚠. They are two ends of the same evidence-capture mechanism — which is why the evidence layer (A4) must precede both.

#### Cost, latency, and the apply gate
- **Batch, don't loop.** All unresolved claims go into a *single* schema-constrained Tier-2 call (not one call per bullet), keeping within the <30s budget. Cache by (claim hash, evidence-set hash) — re-tailoring the same facts is free.
- **Apply-time pass** re-grounds only *changed* claims. The apply-readiness gate (§5) **blocks submission while any `unsupported` claim remains**; `needs_confirmation` warns but doesn't block.
- **False-positive recovery.** A user-reportable "this isn't true" affordance logs a `GraphFeedback` signal and down-weights that grounding path, so the engine calibrates over time.

This converts an internal heuristic into the headline brand — and it is the single most important *quality* upgrade in the plan.

### 4.2 Context Interview agent (the wedge demo)
A stateful, tool-using conversational agent built on the existing `resumeAgent` pattern.

- **Inputs:** the current graph + `profileStrength` gaps (it interviews where the graph is weakest).
- **Loop:** read graph → pick the highest-value missing quantification → ask one sharp question ("you said you 'improved the pipeline' — by how much, for how many users?") → parse the answer into an `ImpactMetric` + `Evidence(kind=interview_assertion)` → re-embed → repeat.
- **Tools:** `getWeakClaims`, `writeImpactMetric`, `linkEvidence`, `reembed`. (Mirror `src/agents/tools/`.)
- **Surface:** chat first (reuse SSE streaming), voice as a fast-follow.
- **State:** new `InterviewSession` model (mirror `GenerationSession`'s state-machine + workflow pattern for resilience/resume).
- **Model choice:** this is conversational quality-critical — see §6.

### 4.3 Match Digest engine (the Always-On retention core)
The recurring reason an Always-On user opens the app between hunts.

- **Ingestion:** ToS-friendly **Greenhouse/Lever public board JSON** only (no scraping — locked decision). A scheduled job pulls boards into a `JobPosting` cache.
- **Match:** score each posting against the user's graph using the *same* fit-score logic the extension already uses (`src/lib/extension/analyze.ts`) — reuse, don't reinvent.
- **Delivery:** top-N digest to the inbox + Telegram/email (reuse `Channel` infra). Cadence per user preference.
- **Models:** `JobPosting`, `JobSource`, `MatchDigest` (sent digests, for dedupe + analytics).

### 4.4 Coaching analytics
- Event substrate exists (`FunnelEvent`, `ExtensionEvent`, `ApplicationWorkspace.applicationStatus`).
- Add an **outcome rollup** job computing the north-star: **interviews landed per 10 applications**, plus response-rate-by-resume-score. Materialize into a small `CoachingSnapshot` per user; surface as advice ("your resume gets 3× more responses when it scores >85").
- Depends on the status state machine (§5) being real.

---

## 5. Apply orchestration — finish the loop (mostly wiring)

| Item | Current | Work |
|---|---|---|
| Tailor-at-apply | route stub; `/api/extension/resume/generate` live | Wire `TailorRoute` → generate → poll status → offer download; inherit source theme. Meter against quota. |
| Answer memory | model + save route exist | Build reuse: fingerprint question → match `ReusableAnswer` → suggest → write-back on accept/edit. Auto-use high-confidence. |
| Extension inbox | placeholder; web inbox + orchestrate route exist | Render workspaces in `WorkspacesRoute` from existing data. |
| Status lifecycle | free string `"discovered"` | Promote to enum: `discovered → drafting → in_progress → submitted → in_review → interview → offer \| rejected \| ghosted`. Migration + UI. |
| Auto-status detection | none | Confirmation-page heuristics in content script → flip to `submitted` (with undo). |
| Apply-readiness gate | profile-completeness gate exists | Extend: block fire-off until `profileStrength` clears a bar + final truthfulness pass. |

**Explicitly not built** (per strategy §11): mass auto-apply, auto-submit, LinkedIn scraping. The truthfulness-first position is the whole differentiation.

---

## 6. AI / model architecture

### 6.1 Provider posture
Today: OpenAI only (`gpt-5` for heavy, `gpt-5-mini` for light), behind `src/lib/aiProvider.ts` + the Vercel AI SDK — a clean multi-provider seam already. The new high-stakes surfaces (Context Interview, voice matching, semantic grounding) are exactly where model quality dominates UX.

**Decision (2026-06-27): stay provider-agnostic now, pick concrete models in Phase B when these features are actually built.** No new provider keys or eval work in Phase A. The job today is to *not foreclose the choice*:
- Keep all model selection behind a **per-task model map** in `src/lib/config.ts` (already partially there) — never hard-code a model id at a call site. New engines (interview, grounding) read their model from this map.
- Keep using the Vercel AI SDK abstraction so adding a second provider later is a config + key change, not a rewrite.
- Record `provider`/`model` on every call in `ApiUsageLog` (already does) so that when the Phase-B decision comes, it's backed by real cost-per-feature data.

Provisional routing to revisit at Phase B (not committed):
- **Conversational / voice-sensitive** (Context Interview, voice matching): strongest available conversational model; worth A/B-ing alternatives (incl. Claude via the AI-SDK seam) on interview-completion and "sounds-like-me" ratings.
- **Structured extraction** (JD parse, impact extraction, resume parse): fast/cheap, schema-constrained — `gpt-5-mini`-class.
- **Semantic grounding (Tier 2)**: mid-tier, schema-constrained, batched.
- **Embeddings:** unchanged (`text-embedding-3-large`).

### 6.2 Prompt & agent discipline
- New agents reuse the `resumeAgent` tool-calling pattern, not bespoke glue.
- All extraction is **schema-first** (zod) so outputs are validated and retried at the tool layer.
- Voice conditioning: pass `VoiceProfile.styleDescriptor` as a system-prompt fragment to paraphraser + drafter.

### 6.3 Cost & quality budgets (from strategy §8)
- Fit score < 5s; side-panel first paint < 200ms; tailored resume < 30s with live progress (infra exists).
- Tier-2 grounding only on unresolved claims; cache aggressively (JD cache pattern already exists).

---

## 7. Monetization & entitlements (NOW — nothing ships without it)

### 7.1 Architecture
```
Stripe (checkout + webhooks)
   │
   ▼
Subscription  ──┐
                ├─▶  EntitlementService.check(userId, action)
Plan/Tier ──────┘         │
                          ▼
        every metered server action calls the gate BEFORE the AI call
        (tailored_generation, auto_apply_step, context_interview, tier2_grounding)
```

### 7.2 Schema
```prisma
model Subscription {
  id              String @id @default(cuid())
  userId          String @unique
  stripeCustomerId String
  stripeSubId     String?
  tier            Tier   @default(free)   // free | always_on | pro | team
  status          String                  // active | past_due | canceled | trialing
  currentPeriodEnd DateTime?
  updatedAt       DateTime @updatedAt
}

model UsageQuota {                         // per-period metered allotment
  id          String @id @default(cuid())
  userId      String
  periodStart DateTime
  action      String   // tailored_generation | auto_apply | context_interview
  used        Int      @default(0)
  limit       Int
  @@unique([userId, periodStart, action])
}
```

### 7.3 Tiers (per strategy §7, Always-On centered)
| Tier | Price | Gate |
|---|---|---|
| Free | $0 | ATS score, 1 master resume, manual export, fit-score-on-page, manual tracking, N free tailored/mo |
| **Always-On** | **$8–12/mo** (the default paid product) | warm profile, match digest, tracker, follow-up nudges, modest tailoring allotment, continuous capture |
| Pro | $24/mo ($15 annual) | unlimited tailoring, multi-step auto-apply, Context Interview, voice, auto-fix, cover letters, analytics |
| Team | custom | design-for-now (multi-seat columns), sell later |

### 7.4 Where the gate lives
Wrap the existing metered actions — `generateSmartResumePipeline`, the extension generate route, the interview agent. The `ApiUsageLog`/`UserUsageSummary` substrate already tracks consumption; the gate adds *enforcement* + the peak-intent paywall ("you've used your 3 free tailored resumes — the next role you care about, let's make it perfect").

---

## 8. Re-sequenced delivery plan (reconciled with reality)

The strategy's NOW/NEXT/LATER is directionally sound, but it contains two sequencing traps that a naive read would walk into. I name them first because they reshape the phases.

#### Two sequencing traps to avoid
**Trap 1 — charging before the differentiated value exists.** The strategy says "monetization first or you're building a charity." True for the *infrastructure*. But the Always-On tier's *differentiated* value — match digest, continuous capture, semantic grounding — all lands in Phase B. If you flip on aggressive pricing in week 2, the Always-On tier is a hollow tracker and you train the market that Patronus = "another resume tool with a paywall." **Resolution: split billing into two milestones.** Build the billing *infrastructure* early (it's a dependency and de-risks metering); delay the *monetization launch* (aggressive paywall, public pricing) until the Always-On tier has real teeth — i.e. after the retention loop completes.

**Trap 2 — splitting the retention trio across a 6-week gap.** The plan itself says the inbox + nudges + digest trio "must land together" to retain — then the obvious read puts inbox in A and nudges/digest in B, 6 weeks apart. An Always-On user who gets a static tracker in week 3 and nothing pulling them back churns before the digest ships. **Resolution: pull follow-up nudges forward** to pair with the inbox (it's M-effort and reuses the existing Telegram/email `Channel` infra), giving a minimal re-engagement loop in Phase A. The heavier digest (board ingestion) stays in B.

#### Phases (re-scoped by *actual* effort; reuse vs. greenfield flagged). Effort S/M/L · Moat ★–★★★

**PHASE A — "trustworthy home base + billing rails" (≈ weeks 1–6).** Exit gate: a user can be tracked, see truth chips, get re-engaged, and *could* be charged — even if we don't push pricing yet.
| # | Item | Effort | Moat | Notes |
|---|---|---|---|---|
| A1 | **Billing *infrastructure*** (Stripe, `Subscription`/`UsageQuota`, entitlement gate) — *not* the pricing launch | L | ★ | Dependency + de-risks metering. Gate wraps metered actions; paywall stays soft (founder's pricing / waitlist) until the Phase-B exit. |
| A2 | **Evidence layer + truthfulness chips (Tier 0/1)** | M | ★★★ | Co-priority with A1. Substrate the interview *and* grounding both depend on. Build once. |
| A3 | **Status state machine + extension inbox** | M | ★★ | Mostly wiring: enum migration + render existing workspace data in `WorkspacesRoute`. |
| A4 | **Follow-up nudges** (pulled forward from B) | M | ★★ | Pairs with A3 so the retention loop isn't hollow. Reuses Channel infra. |
| A5 | **Generation theater polish** | S | ★ | SSE infra exists — surface it prominently. *Slip-buffer / cut candidate.* |
| A6 | **Editor IA cleanup** | M | ★ | Sidebar → Content·Tailor·Score·Design·Advanced; KB → profile. *Slip-buffer / cut candidate.* |

**PHASE B — "keep them warm and learning" (≈ weeks 6–12).** Exit gate: the graph compounds passively and the Always-On tier has differentiated value → **flip on the monetization launch here.**
| # | Item | Effort | Moat | Notes |
|---|---|---|---|---|
| B1 | **Context Interview v1 (chat)** | L | ★★★ | The wedge demo + bulk evidence-capture path (§4.1). New `InterviewSession` + agent + `ImpactMetric` write-back. |
| B2 | **Continuous capture** | M | ★★★ | Shares B1's write-back tooling. The mechanism that compounds the graph between hunts. |
| B3 | **Truthfulness Tier 2 (semantic grounding)** | M | ★★★ | Upgrades the validator to actually back the brand promise. |
| B4 | **Match digest v1** | L | ★★ | Greenhouse/Lever board ingestion → reuse fit-score → digest. The recurring open-the-app reason; completes the retention trio. |
| B5 | **Auto-status detection** | M | ★★ | Confirmation-page heuristics flip status; removes the tracker's one manual step. |
| B6 | **GitHub auto-enrich + LinkedIn export import** | M | ★★ | GitHub exists (deepen to impact bullets); LinkedIn import greenfield. |
| ★ | **Monetization launch** (public pricing, peak-intent paywall) | S | — | Not a build — a *gate*. Fires once B1–B4 give the Always-On tier teeth. |

**PHASE C — "own the outcome & monetize intensity" (later)**
| # | Item | Effort | Moat |
|---|---|---|---|
| C1 | Tailor-at-apply + answer memory (extension Wave 2 wiring) | M | ★★ |
| C2 | Multi-step orchestration "smarter brain" (embedding field resolution, Firecrawl fallback) | L | ★★ |
| C3 | Voice matching | M | ★★ |
| C4 | Coaching analytics (interviews-per-10) | M | ★★★ |
| C5 | Interview prep from graph | M | ★ |
| C6 | Public-board discovery surface in-app | L | ★ |
| C7 | Teams/Coaches B2B2C | L | ★ |

#### Sequencing logic (dependency-driven, not calendar-driven)
- **A1 and A2 are co-priorities and both dependencies.** A1 because metering must exist before you can ever charge; A2 because the evidence layer is the schema the interview (writes evidence) *and* the grounding engine (reads it) both need — build the substrate once, before anything consumes it.
- **Billing infra (A1) ≠ monetization launch (Phase-B gate).** This split is the resolution to Trap 1 and the single most important sequencing decision in the plan.
- **A3 + A4 are the retention loop's first half**; **B4 completes it.** Pulling nudges (A4) forward resolves Trap 2.
- **B1 + B2 are the moat made literal** — they compound the graph while the user isn't hunting, which is the entire Always-On thesis.
- **A5/A6 are the slip-buffer.** They're low-moat polish; if Phase A runs hot, they slide to the seams of Phase B without harming the thesis.
- **C4 (coaching) is high-moat but correctly late** — it needs the status state machine (A3) *and* accumulated application volume before interviews-per-10 means anything.
- Apply-orchestration depth (C1/C2) is the Pro *upgrade during an active hunt* — important, no longer the flagship.

---

## 9. Cross-cutting concerns

- **Observability:** `ApiUsageLog` already gives cost-per-call; add feature tags so cost-per-feature (interview, grounding, digest) is dashboarded. Funnel/extension events feed activation + retention metrics.
- **Quality bars (strategy §8):** speed budgets above; reversibility everywhere (undo on fills/status flips exists — extend to graph edits); no black boxes (theater + chips).
- **Migrations:** all additive; the status-string→enum is the only one needing a backfill (`"discovered"` maps cleanly).
- **Testing:** extension parser fixtures exist — extend the pattern to the grounding engine (golden claim/evidence pairs) and the interview agent (scripted transcripts → expected `ImpactMetric` rows).
- **Privacy:** evidence excerpts and interview transcripts are sensitive PII — scope strictly by `userId`, support delete/export (Clerk user deletion cascade).

---

## 10. Risks & the one thing that can't be wrong

| Risk | Mitigation |
|---|---|
| Truthfulness engine produces false "grounded" on a fabrication | Conservative default to `needs_confirmation`; Tier 2 must *cite* the snippet; final pass at apply-time. Brand-fatal if wrong. |
| Context Interview feels like a chatbot survey | Ask only where the graph is weak; one sharp question at a time; show the metric it captured immediately (instant payoff). |
| Always-On tier too thin to retain | The inbox+nudge+digest trio must land together (A2+B4+B5); a static tracker alone won't retain. |
| Board ingestion ToS drift | Public JSON endpoints only; no scraping; cache + attribute. |
| Cost blowout from Tier-2 grounding / interview | Gate behind entitlements; cache; cheapest-first tiering; budget alerts off `ApiUsageLog`. |

**The one thing that can't be wrong:** the truthfulness guarantee. It's the entire differentiation against AI-slop competitors. Every other feature can ship imperfect and iterate; a single hallucinated metric on a user's real resume breaks the brand permanently. That's why the evidence layer (A4) precedes the generators that consume it.

---

## 11. Concrete first sprint (week 1–2)

A buildable, dependency-ordered slice that produces visible value and unblocks the rest:

1. **Schema migration**: add `Evidence`, `ClaimLink`, `Subscription`, `UsageQuota`, `ImpactMetric`; promote `applicationStatus` to enum (backfill `"discovered"`).
2. **EntitlementService** + wrap `generateSmartResumePipeline` and the extension generate route with the quota gate (free allotment + paywall response).
3. **Stripe**: customer + checkout + webhook → `Subscription`; three price IDs (Always-On / Pro monthly+annual).
4. **Truthfulness chips (Tier 0/1)**: backfill `ClaimLink` during assembly; render ✓/⚠ chips in the editor from existing `validationResult`.
5. **Extension inbox**: render `ApplicationWorkspace` data in `WorkspacesRoute` (data already flows).

That sprint stands up the *billing rails* (A1, soft paywall — no launch yet), makes the product *trustworthy-looking* (A2 chips), and gives it *a home base* (A3 inbox) — the substrate the Always-On bet needs before Phase B adds the differentiated value worth charging for.
