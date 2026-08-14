# PRD 05 — Missions (the process model) & Information Architecture

> **Status:** `Draft for build` · **Release:** R2 · **Persona:** all
> **Depends on:** 01–04 (missions orchestrate existing capabilities; they don't add engines)
> **Also resolves:** the "13-item editor sidebar" problem flagged in v2 §4 — this is that cleanup, done properly.

---

## 1. The problem

The product is becoming a toolbox: resumes, applications, log, packets, radar, extension, knowledge base, templates, ATS score. Every one of them is useful. Together they are a menu, and a menu asks the user to be their own product manager.

Two consequences:
1. **New users don't know what to do first.** The most common failure of multi-tool products is a competent user bouncing because the first screen offers eight equally-weighted choices.
2. **There's no reason to come back on a given Tuesday.** A toolbox is opened when you have a task. An OS always has something running.

**Missions fix both.** A Mission is a named, multi-week program with a start, a sequence, and an end — and when one ends, the OS proposes the next. That's the anti-churn mechanic: the loop has no natural terminus.

---

## 2. What a Mission is

> A **Mission** is a goal the user commits to, decomposed into steps that consume and enrich the graph, with a defined completion condition and an outcome recorded on completion.

A Mission is **not** a checklist the user maintains. Steps auto-complete from real product activity wherever possible — if you generate a packet, the "draft your case" step completes itself. Manual checkboxes are the fallback, not the mechanism.

### Anatomy
| Property | Meaning |
|---|---|
| `type` | One of the catalog (§3) |
| `title` | User-editable ("Staff by March") |
| `targetDate` | Drives pacing and nudges |
| `steps` | Ordered, each with a completion condition |
| `progress` | Derived, never stored as the source of truth |
| `outcome` | Recorded at completion — this is what makes coaching analytics possible later |

### Rules
1. **At most one active Mission** at a time (plus an always-implicit "keep the log warm" background loop). Two active missions means neither is real.
2. A Mission can be **paused** without guilt. Life happens; a paused mission is not a failure state and the UI must not treat it as one.
3. Missions never block anything. Every tool remains directly accessible. A Mission is a recommended path, not a wizard cage.
4. **Completion always asks for the outcome** — "did you get it?" This one question, asked honestly at the end of every mission, becomes the outcome dataset nobody else has.

---

## 3. Mission catalog

Seven missions in R2. Each maps to capabilities that already exist or ship in R1.

### M1 — **Get promoted** *(the flagship for P1)*
- **Duration:** 3–6 months, anchored to the review date.
- **Steps:** set target level & rubric (03) → readiness report → *identify the gap* → **close the gap** (a 4–12 week loop: log evidence against the weak competency, with weekly nudges) → re-run readiness → generate promotion packet (03) → prep the conversation → record outcome.
- **The gap-closing loop is the mission.** It's the only feature in the product that changes what the user *does at work*, not just what they write down. Weekly: *"Cross-team influence: still 1 win. Anything this week?"*
- **Completion:** user reports promoted / not yet / deferred. On "not yet," immediately offer M2 or a second cycle — this is the highest-intent moment in the entire product for a Search-tier upsell, and it must be handled with care, not a hard sell.

### M2 — **Land a new role**
- **Duration:** 6–12 weeks.
- **Steps:** define target (role, level, comp floor from Radar) → refresh master resume from the log → set weekly application target → apply loop (existing extension + tracker) → interview prep → offer → negotiate (M4) → record outcome.
- **Adds a pacing layer** the current tracker lacks: *"Week 3 of 8. 12 of 24 target applications. Response rate 17% — above your baseline."*
- **Requires the Search tier.** This is the natural upgrade point and it is honest: the mission genuinely needs the metered features.

### M3 — **Switch domains** (e.g. backend → ML, IC → PM)
- **Duration:** 3–9 months.
- **Steps:** target definition → gap analysis (your skills vs. Radar's requirement frequency for the target role) → build evidence (projects, internal work, side work — logged as Wins) → reframe existing experience → then M2.
- **Distinct value:** the gap analysis is Radar's skill data pointed at a role the user doesn't have yet. Nobody does this well.

### M4 — **Negotiate this offer**
- **Duration:** 3–10 days, high intensity.
- **Steps:** enter the offer → Radar band comparison → assemble leverage (your Wins + competing offers + the band) → draft the ask (specific number + justification, in the user's voice) → track the response → record final outcome (feeds `OfferDataPoint`, 04 §3.3).
- **Highest value-per-minute in the product.** A successful negotiation is worth 50–200× the annual subscription, and users know it. This is the single best candidate for a one-off paid unlock if we ever want one.

### M5 — **IC → Manager**
Steps: readiness against a management rubric → build evidence (`grew`/`led`/`influenced` Wins) → the conversation → transition. Mostly M1 with a different rubric and a different evidence target.

### M6 — **Return after a break**
- **Duration:** 4–12 weeks.
- **Steps:** reconstruct the pre-break record (07 backfill) → address the gap narrative honestly → refresh skills against Radar → then M2.
- **Underserved segment, high emotional stakes, low competition.** Parental leave, caregiving, illness, sabbatical, layoff gaps.

### M7 — **Keep warm** *(the default background mission)*
The always-on state for someone with no active goal. Not shown as a "mission" with progress; it's the resting state.
- Weekly log ritual · monthly Radar · quarterly "still accurate?" profile check.
- **Every user has this from day one.** It's the Career tier, expressed as a process.

### Deferred to R3
`First job` (needs a student-shaped log — see 00 §2) · `Go independent` (freelance/consulting is a different product) · `Prepare for layoff` (real need, delicate framing; revisit).

---

## 4. Step completion

Each step declares a completion condition. Three kinds:

| Kind | Example | Mechanism |
|---|---|---|
| **Automatic** | "Generate your packet" | Product event (`packet_completed`) marks it done |
| **Threshold** | "Log 3 cross-team wins" | Query over Wins; progress bar updates live |
| **Attested** | "Have the conversation with your manager" | User taps done. Never inferred. |

**Design rule:** at least 60% of steps in every mission must be automatic or threshold. A mission that's mostly checkboxes is a to-do list, and we are not building a to-do list.

Steps can be skipped (`status = skipped`) with the mission still completable — pacing beats compliance.

---

## 5. Information architecture (the sidebar cleanup)

### 5.1 Current problem
Editor sidebar has 13 items; the app has parallel navigation for resumes, applications, profile, knowledge base. Users can't form a mental model.

### 5.2 Target IA

**Top-level navigation — five items, no more:**

```
  ⌂  Home        the active mission + what needs you today
  ◈  Log         wins, review queue, readiness            (01, 03)
  ▤  Documents   resumes, packets, cover letters          (v2 + 03)
  ▶  Applications pipeline, workspaces, questions          (v2)
  ◎  Radar       market, matches, skills                  (04)

  ⚙  Settings    profile, sources, plan, privacy, export
```

**Home** is new and is the mission surface:
```
  ┌─ Staff by March ─────────────── 62% · 4 months left ─┐
  │  ✓ Target set (Staff, Acme ladder)                    │
  │  ✓ Readiness report                                   │
  │  ▸ Close the influence gap        1 of 3 wins  ▓▓░░░ │
  │  ○ Generate promotion packet                          │
  │  ○ Have the conversation                              │
  └────────────────────────────────────────────────────────┘

  TODAY
  • 3 wins to review  (from GitHub, this week)      [ Review ]
  • Your 1:1 with Sam is at 15:00                   [ Prep ]

  THIS MONTH
  • Radar refresh in 6 days
```

**Editor sidebar → 5 sections** (v2's recommendation, adopted):
`Content · Tailor · Score & Fix · Design · Advanced (LaTeX/JSON)`.
The Knowledge Base moves out of the per-resume editor entirely — it is user-level data and belongs under Log/Profile. This is the single change that most improves the product's perceived quality per hour of work.

### 5.3 Mission entry
- **Onboarding:** after connecting GitHub, ask one question — *"What are you working toward?"* — with the seven missions as cards plus "Nothing specific right now" (→ M7). This single question does more for activation than any tour.
- **Post-completion:** always propose the next mission, contextually.
- **Radar trigger:** a strong band delta or match offers M2.
- **Never nag.** Mission proposals appear at most once per week and are permanently dismissible per type.

---

## 6. Data model

```prisma
enum MissionType   { get_promoted land_new_role switch_domain negotiate_offer ic_to_manager return_from_break keep_warm }
enum MissionStatus { proposed active paused completed abandoned }
enum StepStatus    { pending active done skipped blocked }
enum StepKind      { automatic threshold attested }

model Mission {
  id           String        @id @default(cuid())
  userId       String
  type         MissionType
  status       MissionStatus @default(proposed)
  title        String
  targetDate   DateTime?
  config       Json          @default("{}")   // targetLevel, frameworkId, weeklyApplicationTarget, ...
  startedAt    DateTime?
  pausedAt     DateTime?
  completedAt  DateTime?
  outcome      Json?                          // {result, reportedAt, note, compDelta?}
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  steps        MissionStep[]

  @@index([userId, status, updatedAt])
}

model MissionStep {
  id          String     @id @default(cuid())
  missionId   String
  key         String                          // stable identifier, e.g. 'close_gap'
  title       String
  order       Int
  kind        StepKind
  status      StepStatus @default(pending)
  condition   Json       @default("{}")       // {event} | {query, threshold}
  progress    Json       @default("{}")       // {current, target}
  dueAt       DateTime?
  completedAt DateTime?
  blockedReason String?
  mission     Mission    @relation(fields: [missionId], references: [id], onDelete: Cascade)

  @@unique([missionId, key])
  @@index([missionId, order])
}
```

Mission templates (the catalog) live in code (`src/lib/missions/catalog.ts`), not the database — they change with releases, not per user. Instantiating a mission copies the template into `MissionStep` rows so a template change never mutates someone's in-flight mission.

### 6.1 Progress evaluation
A single evaluator (`evaluateMission(missionId)`) runs on: mission view, any relevant product event, and a nightly sweep. It is **pure and idempotent** — recomputing from current data must give the same answer. Never increment progress in an event handler; always recompute.

---

## 7. Nudges

Missions are the product's only legitimate reason to interrupt someone, so the budget is strict.

| Mission | Cadence | Content |
|---|---|---|
| M1 Get promoted | Weekly | Gap progress + one concrete suggestion |
| M2 Land a role | Twice weekly | Pace vs. target, stalled applications |
| M3 Switch domains | Biweekly | Evidence progress |
| M4 Negotiate | Daily during the window | Time-sensitive by nature |
| M7 Keep warm | Weekly (the log digest) + monthly (Radar) | Already specced |

**Global budget: 3 outbound messages per user per week, across all features.** A priority queue enforces it: mission nudge > log digest > radar > product announcements. If the budget is exceeded, drop the lowest priority silently. Implement this as a shared `NotificationBudget` service in R2 — before three features are independently emailing the same person.

---

## 8. Entitlements

| Mission | Free | Career | Search |
|---|---|---|---|
| M7 Keep warm | ✓ | ✓ | ✓ |
| M1 Get promoted | preview only | ✓ | ✓ |
| M3 Switch domains | ✗ | ✓ | ✓ |
| M5 IC→Manager | ✗ | ✓ | ✓ |
| M6 Return from break | ✗ | ✓ | ✓ |
| M2 Land a new role | ✗ | preview | ✓ |
| M4 Negotiate | ✗ | ✗ | ✓ |

"Preview" = the user can see the mission's steps and its first step's output, then hits the paywall with their own data visible. Same pattern as 03 §8.

M2 requiring Search is the cleanest, most honest upgrade prompt the product has: *"This mission uses unlimited tailoring and apply automation. Turn on Search for your hunt — $29/mo, cancel any time you stop looking."*

---

## 9. Telemetry

| Event | Payload |
|---|---|
| `mission_proposed` / `started` / `paused` / `resumed` / `abandoned` | `{type, source: 'onboarding'\|'radar'\|'completion'\|'manual'}` |
| `mission_step_completed` | `{type, stepKey, kind, daysFromStart}` |
| `mission_completed` | `{type, outcome, durationDays, stepsSkipped}` |
| `mission_nudge_sent` / `clicked` | `{type, nudgeKey}` |
| `nudge_budget_exceeded` | `{dropped, priority}` |

**The metric that matters:** *mission completion rate by type* and *outcome reported rate*. If people abandon M1 at the gap-closing step, the gap-closing loop is too hard or too vague — and that's the mission's core, so it's a redesign signal, not a copy tweak.

---

## 10. Edge cases

| Case | Handling |
|---|---|
| User starts M2 while M1 is active | Offer: pause M1 (default) or abandon it. Never silently stack. |
| Mission target date passes | Don't fail it. Ask: extend, complete with outcome, or abandon. |
| User gets promoted without finishing M1 | Detect from a new `UserExperience` entry or a Win categorized `led` at a new title; ask *"Did you get it?"* |
| Mission steps reference a deleted resource (framework removed) | Step → `blocked` with a fix link; mission stays completable |
| User completes M2 (hired) | Auto-propose M7 + offer the Search→Career downgrade proactively (06 §5) — **we volunteer the downgrade.** This is the single most trust-building action in the product. |
| Template changes mid-mission | In-flight missions keep their copied steps; new steps are not injected |
| Free user starts a preview mission and hits the wall | Mission stays in `proposed`; nothing is lost on upgrade |

---

## 11. Acceptance criteria

- [ ] Onboarding's "what are you working toward?" creates a mission and lands the user on Home
- [ ] Home shows the active mission, today's actions, and nothing else above the fold
- [ ] Generating a packet auto-completes M1's packet step within 5 seconds, with no user action
- [ ] Threshold steps show live progress and recompute correctly after a Win is un-confirmed
- [ ] `evaluateMission` is idempotent — running it 10× produces identical state (property test)
- [ ] Only one mission can be `active`; starting a second prompts and resolves the first
- [ ] Pausing is one click with no warning modal and no negative framing
- [ ] Completion always prompts for outcome; the prompt is skippable but re-asked once after 7 days
- [ ] Top-level nav is exactly five items; editor sidebar is exactly five sections
- [ ] Knowledge Base no longer appears inside the resume editor
- [ ] Notification budget caps at 3/week across all features; drops are logged
- [ ] Every mission is fully abandonable, with all data retained

---

## 12. Out of scope

Custom user-authored missions · shared/coached missions (a coach driving a client's mission — R3 B2B) · mission templates per company · gamified streaks beyond the log's existing counter · calendar integration for mission deadlines.
