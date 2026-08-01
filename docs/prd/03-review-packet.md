# PRD 03 — Review Packet, Rubric Mapping & 1:1 Prep

> **Status:** `Draft for build` · **Release:** R1.5 (packet + rubric), R2 (1:1 prep) · **Persona:** P1 Maya
> **Depends on:** 01 (Wins), 02 (auto-capture volume), `VoiceProfile` (optional, degrades gracefully)
> **This is the feature that makes an employed person pay.** Everything else in R1 builds the input; this is the output they'd miss.

---

## 1. The problem

Performance review season is the highest-stakes, highest-anxiety, lowest-support moment in a knowledge worker's year. The company provides a form and a deadline. Nobody provides help.

What actually goes wrong:
1. **Recall** — solved by 01/02.
2. **Selection** — 60 wins don't fit in a review. Which 12 make the case? People pick the most *recent* and the most *technically interesting*, both of which are the wrong criteria.
3. **Framing** — engineers write outputs ("shipped the batching refactor"); rubrics reward outcomes and scope ("removed the top source of checkout failures for 2M weekly users, unblocking the pricing team"). The gap between those two sentences is a promotion.
4. **Evidence** — "I improved performance" without a number is unarguable and therefore ignorable.
5. **Gaps** — the thing people most need to know is what's *missing* for the next level, and they find out in the review, six months too late to fix it.

The packet generator addresses 2–4. Rubric mapping addresses 5, and is the more defensible feature.

**Value line:** *"Walk into your review with a case, not a memory."*

---

## 2. User stories

- As Maya, I want to generate a review document from my log for a date range, so I don't spend a weekend on it.
- As Maya, I want it organized the way my company's rubric is organized, not chronologically.
- As Maya, I want to see which competencies I have thin evidence for **three months before** the review, so I can still do something about it.
- As Maya, I want every sentence backed by a win I confirmed, so I can defend it in the room.
- As Maya, I want it to sound like me — if my manager reads obvious AI prose, it damages me.
- As Maya, I want to edit everything and export to whatever format my company's tool wants.

---

## 3. Feature A — The Review Packet

### 3.1 Generation flow

Entry points: the Log right rail, `/packets`, the Month in Review CTA, and a proactive nudge 30 days before a configured review date.

**Step 1 — Scope** (one screen, sensible defaults, ≤3 interactions)

| Input | Default | Notes |
|---|---|---|
| Period | Last 6 months | Presets: last 6mo · last 12mo · since last packet · custom |
| Employer | Current | Auto from `UserExperience` |
| Packet type | **Performance review** | Also: `Promotion case` · `Self-appraisal` · `Brag doc` (see §3.4) |
| Target level | Current level | Only shown for `Promotion case`; drives the rubric gap analysis |
| Framework | The user's uploaded rubric, if any | Else "General (Patronus default)" |
| Audience | My manager | Also: `Skip-level / committee` · `Just me` — changes tone and length |

Show the input count live: *"47 confirmed wins in this period · 31 with evidence · 18 with numbers."* If <8 confirmed Wins, warn before generating: *"Thin log for a 6-month packet. Want to add a few first?"* with a link to backfill (07). Do not block.

**Step 2 — Generation** (reuse the existing SSE progress infra — `src/lib/generationProgress.ts` + `GlobalGenerationBanner`)

Visible stages, because the wait is 30–60s and a silent spinner feels broken:
```
  Reading 47 wins from Feb–Jul
  Grouping into themes …            ▸ found 5 themes
  Mapping to your Acme rubric …     ▸ 7 of 9 competencies covered
  Selecting your strongest evidence …
  Writing in your voice …
  Checking every claim against your log …   ← the truthfulness pass, shown deliberately
```

**Step 3 — The packet** (editable document view)

### 3.2 Packet structure

Not a list of wins. A **case**, in this order — this ordering is the product.

```
┌──────────────────────────────────────────────────────────────┐
│  Performance Review · Feb – Jul 2026 · Acme · Senior BE Eng  │
├──────────────────────────────────────────────────────────────┤
│  1. SUMMARY                                    ~120 words     │
│     Three sentences a busy manager can forward upward.        │
│                                                                │
│  2. HIGHLIGHTS                                 3–5 themes      │
│     ▸ Made checkout reliable at peak                          │
│       [outcome sentence with the number]                       │
│       • Cut p95 latency 800ms → 180ms  ·  PR #482  · Jul      │
│       • Eliminated the top support complaint … · Jun          │
│       Impact: [scope — users, revenue, team-time]              │
│     ▸ Raised the payments team's design bar                   │
│       …                                                        │
│                                                                │
│  3. BY COMPETENCY                     (when a rubric exists)   │
│     Execution         ●●●●○   4 wins, 3 quantified            │
│     Technical depth   ●●●●●   6 wins                          │
│     Influence         ●●○○○   1 win        ← flagged           │
│     Mentorship        ○○○○○   none         ← flagged           │
│                                                                │
│  4. GROWTH & WHAT'S NEXT                                       │
│     Honest, specific, forward-looking. Written from the gaps.  │
│                                                                │
│  5. APPENDIX — full win list with dates and links              │
│     (collapsible; the receipts, for when you're challenged)    │
└──────────────────────────────────────────────────────────────┘
```

**Theme grouping is the highest-value AI work here.** Twelve wins about caching, queries, and timeouts become one theme: *"Made checkout reliable at peak."* That reframing is exactly what people cannot do about their own work, and it's what turns a ticket list into a narrative.

Constraint: **3–5 themes, never more.** Six themes reads as "I did a lot of unrelated things," which is a Senior-not-Staff signal. If the wins genuinely don't group, say so in the UI rather than inventing coherence: *"Your work this period was spread across 8 areas — that can read as unfocused. Want to lead with your 3 strongest?"*

### 3.3 Editing & export

- Every block is inline-editable. Edits are saved as `ReviewPacket.content` overrides so regeneration doesn't clobber them (offer "keep my edits" / "start fresh").
- Each generated sentence carries a hover affordance showing its source Wins. Clicking opens the Win drawer. **Nothing in a packet exists without a Win behind it** — same guarantee as the resume, same mechanism (`ClaimLink`).
- **Regenerate section** (not just the whole packet) with an optional instruction: "make this shorter" / "lead with the reliability work."
- Export: **Markdown** (paste into Workday/Lattice/Google Docs — the actual primary use), **PDF** (reuse the existing PDF path), **Plain text**, **Copy section**. Not DOCX in R1.
- Confidential Wins: included by default with a `🔒` marker and a pre-export prompt: *"3 wins are marked confidential. Include them? Your manager can see these; a recruiter shouldn't."* Default include for `audience = manager`, default exclude for `audience = just me` exports.

### 3.4 Packet types

| Type | Differences |
|---|---|
| **Performance review** | Balanced across categories, includes growth section, ~700–900 words |
| **Promotion case** | Ruthlessly filtered to evidence at the *target* level; leads with scope and influence; explicitly addresses each rubric criterion for the target level; ~1,000–1,400 words; includes a "what I'd need to keep doing" section |
| **Self-appraisal** | Matches common form-field structures (accomplishments / challenges / goals); shorter blocks |
| **Brag doc** | Raw, chronological, no narrative — for people who just want the list. Cheapest to generate, and a good free-tier teaser. |

---

## 4. Feature B — Competency Rubric Mapping

This is the differentiated half. Anyone can summarize a list of wins. Mapping them to *your company's actual leveling framework* and naming the gaps is something no tool does.

### 4.1 Getting the rubric in

Three paths, in order of preference:

1. **Upload** — paste text, upload PDF/DOCX (reuse `src/lib/pdfParser.ts` and `docxParser.ts`, already built for resume import), or paste a URL. AI extracts levels and competencies into a structured framework. Show the parse result for confirmation — *"We found 5 levels and 9 competencies. Look right?"* — with inline editing.
2. **Pick a public framework** — ship 6 seeded templates: `Google SWE`, `Meta E-series`, `Dropbox`, `CircleCI`, `Rent the Runway`, `Generic IC ladder`. These are publicly published ladders; store them as system-owned `CompetencyFramework` rows with `sourceType = 'template'` and attribution.
3. **Patronus default** — a 6-competency generic ladder used when nothing else is available: Execution · Technical Depth · Scope & Ambiguity · Influence · Communication · Mentorship.

**Sensitive-document handling:** an internal leveling rubric may be confidential. Store it user-scoped, never use it as training data, never share across users, and say so at upload.

### 4.2 The mapping

For each confirmed Win in the period, the model assigns 0–2 competencies with a strength (`strong` / `supporting`). Deterministic priors from `Win.category` (00 taxonomy → competency) seed the mapping and the model refines it; this keeps mapping stable across regenerations.

Then per competency:
```
coverage  = count of wins mapped
strength  = weighted: strong=1.0, supporting=0.4
evidence  = share of mapped wins with an ImpactMetric
verdict   = strong | adequate | thin | absent
```

Thresholds (tunable, stored in config): `strong ≥3.0 & evidence ≥0.5` · `adequate ≥1.5` · `thin >0` · `absent = 0`.

### 4.3 The gap report — the part people will pay for

This is the artifact that should exist **independently of review season**, available year-round at `/log` → "Level readiness."

```
  READINESS FOR STAFF ENGINEER · Acme ladder
  Based on 47 wins, Feb – Jul 2026

  ✓ Technical depth      strong      6 wins, 4 quantified
  ✓ Execution            strong      9 wins
  ~ Scope & ambiguity    adequate    2 wins — both single-team
  ✗ Influence            thin        1 win in 6 months
  ✗ Mentorship           absent      no evidence logged

  THE HONEST READ
  Your technical case is strong. Your scope case is not.
  Staff at Acme requires "impact across at least two teams"
  and your log shows one cross-team win (the payments design
  review, June). That's the gap that decides this.

  WHAT WOULD CLOSE IT
  • Two more cross-team contributions with a named outcome
  • Any mentorship you're already doing but haven't logged
    → You have 3 unlogged PR reviews for junior engineers.
      Want to review them? [ Show me ]
```

That last move — **finding evidence the user already has but hasn't logged** — is the strongest single interaction in this PRD. It converts a gap report into an immediate capture prompt and closes the loop back to 01.

**Tone rule:** honest, specific, never flattering, never brutal. The gap report's credibility depends on it being willing to say "your case is not ready." A tool that always says you're ready is worthless. Copy review by the owner before launch.

### 4.4 Proactive readiness nudges

If the user has set a review date (`UserProfile.preferences.reviewCycle`), send:
- **T-90 days:** the gap report, framed as actionable. *"Your March review is 3 months out. Here's the one gap worth working on."* ← the highest-value email the product sends all year.
- **T-30 days:** *"Time to start your packet — you have 47 wins ready."*
- **T-7 days:** reminder only if no packet generated.

Review dates are also inferable: if a user generates a packet in March, ask *"Same time next year?"* and set the cycle.

---

## 5. Feature C — 1:1 Prep (R2)

The weekly bridge between review cycles. Small feature, disproportionate habit value.

**Trigger:** a recurring calendar event detected as a 1:1 (02 §8.1), or a manually configured weekly day/time. Delivered 2 hours before, same channels as the digest.

**Content — three items, hard cap:**
```
  Your 1:1 with Sam · today 15:00

  WORTH RAISING
  • The checkout latency work landed — p95 is down 77%.
    (You logged this Tuesday; you haven't mentioned it.)

  STILL OPEN FROM LAST TIME
  • You said you'd scope the pricing migration.

  ONE ASK
  • You have no cross-team wins this quarter and Staff needs
    two. Ask Sam what's available.
```

The third item is where the coaching lives — it's the gap report, delivered one actionable sentence at a time, weekly. Note it requires the rubric (4.x) to be useful; without one, substitute the category-balance observation.

"Still open from last time" requires storing 1:1 notes. **R2 scope:** a single free-text notes field per 1:1 instance, optional. Do not build a task manager.

---

## 6. Data model

```prisma
enum FrameworkSource { uploaded template default }
enum PacketType      { performance_review promotion_case self_appraisal brag_doc }
enum PacketStatus    { generating ready failed }

model CompetencyFramework {
  id           String          @id @default(cuid())
  userId       String?                        // null = system template
  name         String
  sourceType   FrameworkSource
  companyName  String?
  levels       Json                           // [{key,name,order,summary}]
  competencies Json                           // [{key,name,description,levelExpectations:{levelKey:string}}]
  rawSourceRef String?                        // blob key of the uploaded doc
  isConfidential Boolean       @default(true)
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@index([userId])
  @@index([sourceType, companyName])
}

model ReviewPacket {
  id            String       @id @default(cuid())
  userId        String
  type          PacketType
  status        PacketStatus @default(generating)
  periodStart   DateTime
  periodEnd     DateTime
  employerId    String?
  frameworkId   String?
  targetLevel   String?
  audience      String       @default("manager")
  winIds        Json         @default("[]")   // exact inputs — makes it reproducible
  content       Json                          // {summary, themes[], competencies[], growth, appendix}
  userEdits     Json         @default("{}")   // block-keyed overrides, survive regeneration
  gaps          Json         @default("[]")
  wordCount     Int          @default(0)
  exports       Json         @default("[]")   // [{format, blobKey, at}]
  generationMs  Int?
  costUsd       Float        @default(0)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([userId, createdAt])
  @@index([userId, periodEnd])
}
```

Gap reports are **not** a separate model — they're computed on demand from Wins + framework and cached in `ReviewPacket.gaps` when generated as part of a packet, or in a 15-minute cache for the standalone readiness view.

---

## 7. AI contracts

Three calls, run in sequence. Total budget: **<60s p95, <$0.35 per packet.**

### 7.1 `groupWinsIntoThemes`
**Model:** strong reasoning. **In:** all confirmed Wins in scope (title, narrative, category, metric, date, employer). **Out:**
```ts
z.object({
  themes: z.array(z.object({
    title: z.string().max(80),          // outcome-framed, not activity-framed
    outcomeSentence: z.string().max(240),
    winIds: z.array(z.string()).min(1),
    scope: z.string().nullable(),        // only if stated in the wins
    strength: z.enum(['headline','supporting']),
  })).min(1).max(5),
  unthemed: z.array(z.string()),         // winIds that didn't fit — surfaced in appendix
  coherenceNote: z.string().nullable(),  // set when the work genuinely doesn't group
})
```
**Rules:** every `winId` referenced must exist in the input. No win may appear in two themes. Theme titles state an outcome ("Made checkout reliable at peak"), never an activity ("Performance work"). No number may appear that isn't in a member win.

### 7.2 `mapWinsToCompetencies`
**Model:** mid-tier, schema-constrained, batched (all wins in one call). **In:** wins + the framework's competency definitions + the target level's expectations. **Out:** `{ winId, competencyKey, strength }[]` + per-competency `verdict` and a one-sentence `rationale` citing specific win IDs.
**Rules:** a competency may only be marked covered by wins that were actually mapped to it. `absent` must be returned honestly — the model is explicitly instructed that under-claiming is correct and over-claiming is a failure.

### 7.3 `composePacket`
**Model:** strong conversational + `VoiceProfile.styleDescriptor` if present. **In:** themes, competency verdicts, gaps, audience, type, word target. **Out:** the packet blocks.
**Rules:**
1. Every factual sentence must trace to ≥1 supplied Win; emit `sourceWinIds` per block.
2. No superlatives the user didn't earn from data ("exceptional", "world-class" are banned tokens).
3. No invented numbers — post-validated by the same digit-check as 01 §12.
4. Growth section must be specific and derived from `gaps`, never generic ("continue learning" is a failure).
5. If no `VoiceProfile`, default to plain declarative prose. **Never default to enthusiastic.**

### 7.4 The truthfulness pass
After composition, run every generated sentence through the existing grounding path (`src/services/claimGrounding.ts`) against the packet's `winIds`. Any sentence that fails resolves to a visible `⚠` chip in the editor with "we couldn't tie this to a win — edit or remove." **Fail closed** (v2 §4.1). A packet may ship with warnings; it may never ship with a silent fabrication.

---

## 8. Entitlements

New `MeteredAction` values:

| Action | Free | Career | Search |
|---|---|---|---|
| `review_packet` | **1 lifetime** (brag_doc type only) | 4/period | 4/period |
| `rubric_upload` | 0 | 3 frameworks | 3 frameworks |
| `readiness_report` | 0 | unlimited | unlimited |

**The paywall moment is precise and deliberate:** the free user generates their one brag doc, sees the locked "By competency" section rendered greyed-out with real competency names from their log, and hits: *"You have 47 wins and no gaps analysis. See what's missing for Staff — $99/year."* Peak intent, concrete, and the locked content is *real* (their data), not a marketing placeholder.

4/period rather than unlimited because packets are expensive ($0.35) and 4 covers mid-year + annual + promo + a redo. Regenerating a *section* is free and doesn't count.

---

## 9. Telemetry

| Event | Payload |
|---|---|
| `packet_started` | `{type, periodDays, winCount, hasFramework, targetLevel}` |
| `packet_completed` | `{type, themes, wordCount, generationMs, costUsd, warningCount}` |
| `packet_section_regenerated` | `{section, hadInstruction}` |
| `packet_block_edited` | `{section, charDelta}` — high edit rates mean bad generation |
| `packet_exported` | `{format, includedConfidential}` |
| `framework_uploaded` / `parsed` / `corrected` | `{sourceType, levels, competencies, correctedFields}` |
| `readiness_viewed` | `{targetLevel, absentCount, thinCount}` |
| `readiness_capture_prompt_clicked` | `{competency, foundUnloggedCount}` ← the loop-closing metric |
| `review_date_set` | `{monthOfYear}` |
| `one_on_one_prep_sent` / `opened` | `{itemCount}` |

**Key ratios:** `packet_exported / packet_completed` (did it survive contact with reality — target >70%) and `packet_block_edited` rate per section (which section we generate worst).

---

## 10. Edge cases

| Case | Handling |
|---|---|
| <8 confirmed Wins | Warn, generate anyway, and lead the packet with a nudge to backfill |
| 200+ Wins in the period | Select top 40 by `strength × recency × evidence`, note the selection in the appendix: *"Showing your 40 strongest of 213"* |
| Period spans two employers | Split into two sections; never blend. Prompt: *"This period covers Acme and Globex — separate packets?"* |
| No rubric | Skip section 3 entirely; show an inline card offering upload/template. Don't render an empty section. |
| Rubric parse produces garbage | Confirmation screen catches it; user can edit or fall back to a template. Never generate against an unconfirmed framework. |
| All wins are one category | Say so plainly in the coherence note; this is real, useful feedback |
| Confidential wins in an export | Pre-export prompt (§3.3); the choice is remembered per packet, not globally |
| Regenerate after edits | Explicit choice: "keep my edits" (default) merges `userEdits` over new content by block key; "start fresh" discards |
| User's target level doesn't exist in the framework | Validate at scope time; offer the nearest level |
| Two packets for the same period | Allowed (drafts and redos are normal); list shows both with timestamps |
| Model returns a theme referencing a win outside scope | Schema validation rejects → single retry → fall back to category-based grouping (deterministic, no AI) |

---

## 11. Acceptance criteria

**R1.5 — Packet + rubric**
- [ ] A user with 40 confirmed Wins generates a performance-review packet in **<60s p95**
- [ ] Every generated sentence maps to ≥1 win ID, and the UI can display those wins on hover
- [ ] **Zero** numbers appear that are not present in a source Win — automated digit-check on a 20-packet eval set; hard launch gate
- [ ] Theme count is always 3–5, or the coherence note explains why not
- [ ] Rubric upload (PDF/DOCX/paste) parses levels + competencies with ≥85% field accuracy on a 15-rubric test set
- [ ] Gap report correctly reports `absent` for a competency with zero mapped wins (no hedging, no false comfort)
- [ ] The "you have unlogged evidence" prompt finds real dismissed/undrafted signals and links to them
- [ ] Markdown export pastes cleanly into Google Docs and Lattice with structure intact
- [ ] Confidential wins are excluded from export when the user says so, verified end to end
- [ ] Free-tier user sees a real, greyed competency section with their own competency names
- [ ] Packet regeneration preserves user edits by block key

**R2 — 1:1 prep**
- [ ] Fires 2h before a detected or configured 1:1
- [ ] Exactly 3 items, never more
- [ ] The "one ask" derives from a real gap and changes week to week

---

## 12. Out of scope

Manager-side view or sharing (00 D6) · 360/peer feedback collection · goal/OKR tracking · calibration simulation · salary benchmarking inside the packet (that's 04 Radar, linked but separate) · DOCX export · multi-language packets.
