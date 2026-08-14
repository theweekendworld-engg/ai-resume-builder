# Design 02 — Screens

> **Scope:** every R1 surface — web app, email, extension, and the logged-out action page.
> Layouts are specifications, not sketches: sizes, copy, states, and behavior are as written.
> **Copy in these layouts is final copy.** If it needs changing, change it here.

---

# A. Onboarding

Three steps, ≤90 seconds, skippable at every point. The goal is not a complete profile — it is **one confirmed Win before the user leaves.**

## A1 · Basics
`signature` surface, centered, max-w 480px.

```
                    Let's set up your record

   What's your role?     [ Senior Backend Engineer        ]
   Where?                [ Acme                            ]
   Since?                [ Mar 2023  ▾]  ☐ current

                        [ Continue ]
                        Skip for now
```

Writes `UserProfile` + a `UserExperience` row — needed immediately so Wins have an employer to attach to. Timezone is captured silently here (P0.8), never asked.

## A2 · Connect GitHub — **the highest-leverage screen in the product**

```
              Connect GitHub

   We read your merged pull requests and code reviews
   to draft your weekly wins.

   ✓  We never read your source code
   ✓  We never write anything to GitHub
   ✓  You choose which repos we look at

   ┌──────────────────────────────────────────┐
   │  Connect with private repos               │  ← primary, full width
   └──────────────────────────────────────────┘
   ┌──────────────────────────────────────────┐
   │  Public repos only                        │  ← outline
   └──────────────────────────────────────────┘
                   I'll do this later
```

The three checkmarks carry the whole consent burden and are **not** collapsible fine print. Copy is verbatim from PRD 02 §3.2.

**Refusal is not a dead end.** "Later" continues to A3 with a persistent dismissible card in the log.

### A2b · Repo picker

```
   Which repos should we look at?              12 of 47 selected

   [ Search repos…                                              ]
   ☑ patronus/api            ← 84 commits, last week
   ☑ patronus/web            ← 31 commits, 3 days ago
   ☐ patronus/docs           ← 2 commits, 4 months ago
   …                                          (virtualized list)

   Pre-selected: repos you've contributed to in the last 90 days.

                     [ Start scanning ]
```

Virtualized; must stay <300ms interactive at 500 repos. Zero selected disables the button with inline text, not a toast.

## A3 · The first fill — *the wow moment, design it as one*

```
              Building your work log…

     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  scanning patronus/api

     ✓ Found 38 merged pull requests
     ✓ Found 12 substantive code reviews
     ▸ Drafting your strongest 40…

     ┌────────────────────────────────────┐
     │ Cut checkout p95 latency 800ms →…  │   ← cards fly in as they land
     │ Unblocked the payments team on…    │
     └────────────────────────────────────┘
```

Cards appear progressively via the existing SSE pattern. **Never a bare spinner.** Target: first card within 20s, complete within 90s.

**Completion:**
```
   We found 40 wins from your last 90 days.
   Review them now, or we'll bring them to you Friday.

   [ Review 40 wins ]   [ Later ]
```

## A4 · Mission (R2 only)
One question — *"What are you working toward?"* — seven cards plus "Nothing specific right now." Not in R1; the flow ends at A3.

---

# B. Log — `/log`

The home of the product. `density-default`, work surfaces.

```
┌ Work log ─────────────────────────────── [ + Log a win ] ──┐
│                                                             │
│ ┌ Needs review · 3 ──────── [Confirm all] [Dismiss all] ─┐ │
│ │  ReviewQueue                                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [All ▾] [2026 ▾] [All employers ▾] [🔍 Search]              │
│─────────────────────────────────────────────────────────────│
│ JULY 2026                                         8 wins    │  ← sticky
│  WinCard                                                    │
│  WinCard                                                    │
│ JUNE 2026                                        11 wins    │
│  …                                                          │
└─────────────────────────────────────────────────────────────┘

RAIL (≥1024px)
┌─────────────────────────┐
│ 74      wins logged      │  StatTile
│ 61      with evidence    │
│ 🔥 6 weeks               │
├─────────────────────────┤
│ Your record              │
│ 74 wins · 3 years ·      │  ← the standing value statement
│ 61 with evidence —       │     (PRD 09 §4 M3)
│ enough for a promotion   │
│ packet, a resume, and a  │
│ negotiation dossier.     │
├─────────────────────────┤
│ Category mix             │
│ shipped     ▓▓▓▓▓▓  22   │
│ improved    ▓▓▓▓    14   │
│ influenced  ▓        2   │  ← thin categories in --warning
│ grew        ·        0   │
│                          │
│ ⚠ No `grew` wins this    │
│ quarter. Senior reviews  │
│ usually need 2–3.        │
├─────────────────────────┤
│ [ Generate review packet ]│
└─────────────────────────┘
```

**Month headers are sticky** and carry the count — scrolling three years of record needs constant positional feedback.

### Filters
Segmented `All / Drafts / Confirmed / Archived`, plus year, employer, category, and search (client-side under 200 wins, server-side above). Active filters render as removable chips beneath the bar. Filtered-to-zero shows `EmptyState` with a single "Clear filters" action.

### Free-tier history boundary
After the 90-day cutoff:
```
      ─────────  +41 older wins  ─────────
      Your full record is saved. Career unlocks it.
                [ See plans ]
```
Muted rule, centered. **Never "your data will be deleted."** They're locked, not lost, and the copy must make that unambiguous.

### States
| State | Treatment |
|---|---|
| First run, no source | `EmptyState` + 3 sample cards at 45% behind a "Sample" caption |
| Connected, syncing | Progress card at top; cards stream in |
| Loading | Skeleton rows matching final geometry — never a spinner |
| Sync error | Amber inline banner above the list; the list still renders |

### Responsive
`<640px`: rail collapses to a 2-up StatTile strip above the list; filters become a bottom sheet; nav becomes a bottom tab bar.

---

# C. Win drawer

Right-side drawer, 480px, `floating`. **Not** a route — preserves list scroll position. `Esc` closes; deep link `?win=<id>` for sharing internally.

```
┌────────────────────────────────────────── ✕ ─┐
│ improved · Acme · Jul 14, 2026                │
│                                               │
│ Cut checkout p95 latency 800ms → 180ms        │  ← click to edit
│                                               │
│ Rewrote the pricing lookup as a batched        │
│ query with a read-through cache. Checkout      │
│ timeouts during peak dropped to near zero.     │
│                                               │
│ ── Impact ──────────────────────────────────  │
│ ⚡ p95 latency  800ms → 180ms  (−77%)          │
│                                               │
│ ── Evidence ────────────────────────────────  │
│ ◆ PR #482 · patronus/api            ↗         │
│   "Batch pricing lookups in checkout path"     │
│ ✓ Grounded                                     │
│                                               │
│ ── Details ─────────────────────────────────  │
│ Employer     [ Acme            ▾]              │
│ Date         [ Jul 14, 2026     ]              │
│ Category     [ improved        ▾]              │
│ Sensitivity  [ 🔓 Shareable    ▾]              │
│ Skills       [performance ×][postgres ×] [+]   │
│                                               │
│ ── ─────────────────────────────────────────  │
│ Drafted from PR #482 on Jul 14                 │
│ Confirmed by you on Jul 18                     │
│                                               │
│ [ Archive ]                         [ Delete ] │
└───────────────────────────────────────────────┘
```

**Everything edits in place.** Click text → input; blur or `⌘↵` saves; `Esc` reverts. No Edit mode, no Save button.

**When there's no metric**, the Impact block becomes the quantify prompt — the single highest-leverage interaction in the drawer:
```
 ── Impact ──────────────────────────────────
 How much faster?  [                    ]  [ Add ]
 Skip
```
One question, ≤8 words, generated per Win. Answering writes an `ImpactMetric`.

**Sensitivity change to confidential** shows an inline confirm: *"This won't appear on resumes or cover letters. It stays in review packets."* Then deletes the Qdrant point before the drawer reports success.

Mobile: full-screen sheet, sticky header with ✕.

---

# D. Quick capture

Popover from the header button, `⌘K → "log"`, or `/log/new` on mobile. 420px, `floating`.

```
┌── Log a win ──────────────────────────── ✕ ─┐
│ ┌───────────────────────────────────────┐   │
│ │ What happened? Rough notes are fine — │   │
│ │ "fixed the checkout timeout thing,    │   │
│ │  latency way down"                    │   │
│ └───────────────────────────────────────┘   │
│ 📅 Today ▾        🔓 Shareable ▾             │
│                          [ Log it   ⌘↵ ]     │
└──────────────────────────────────────────────┘
```

**After 800ms idle** (or blur), it structures in place — the textarea does not clear or navigate:

```
┌── Log a win ──────────────────────────── ✕ ─┐
│  ✨ Cut checkout latency                     │  ← editable title
│  Fixed the checkout timeout by reducing      │  ← editable narrative
│  latency.                                    │
│  improved ▾   📅 Today ▾   🔓 Shareable ▾    │
│                                              │
│  ⚡ How much faster?  [           ]           │  ← only when unquantified
│                                              │
│  [ Cancel ]                  [ Log it  ⌘↵ ]  │
└──────────────────────────────────────────────┘
```

Structuring shows a 3-line shimmer, never a spinner. Past 4s it degrades silently: the raw text saves as a draft and structures in the background (PRD 01 §5.3).

**Date chip** opens `Today · Yesterday · This week · Last week · Pick a date`.
**On submit:** popover closes, toast *"Logged. 15 wins this quarter."* with 8s Undo.

---

# E. Month in Review — `/log/review/[yyyy-mm]`

`signature` surface, `body-read` (16/26), `max-w-[68ch]`. This is a document, not a dashboard.

```
                        JULY 2026

              8 wins, 5 with hard numbers

   ────────────────────────────────────────────

   July was your reliability month. The checkout
   latency work — 800ms to 180ms — removed what
   had been the top support complaint for two
   quarters, and the payments design review you
   ran changed how that team handles webhook
   retries.

   ────────────────────────────────────────────

   YOUR MIX
   shipped ▓▓▓  improved ▓▓▓▓  influenced ▓  grew ·

   Four of eight wins were `improved`. Only one was
   `influenced`, and none were `grew`.

   WORTH KNOWING
   None of your wins this month mention business
   impact — revenue, cost, or user numbers. For a
   Staff-level case that's usually required.

   ────────────────────────────────────────────
   [ Start your review packet ]      [ See all 8 ]
```

**Design intent:** this is the artifact people screenshot. Generous leading, one column, no cards, no chrome. The observation section must feel like a colleague's note, not a dashboard alert.

Email version: same structure, table-based, single CTA.

---

# F. Review packet

## F1 · Scope — one screen, ≤3 interactions

```
   Generate a review packet

   Period        [ Last 6 months ▾ ]   Feb 1 – Jul 31, 2026
   For           [ Acme ▾ ]
   Type          ( ) Performance review   ( ) Promotion case
                 ( ) Self-appraisal       ( ) Brag doc
   Target level  [ Staff Engineer ▾ ]        ← promotion case only
   Framework     [ Acme ladder ▾ ]  · upload another
   Audience      [ My manager ▾ ]

   ────────────────────────────────────────────
   47 confirmed wins · 31 with evidence · 18 with numbers

                    [ Generate ]
```

Live input count updates as scope changes. Under 8 wins → amber inline: *"Thin log for a 6-month packet. Want to add a few first? [Reconstruct this period]"* — warns, never blocks.

## F2 · Generation — `ProgressStages`, 30–60s

```
        Writing your packet

   ✓ Read 47 wins from Feb–Jul
   ✓ Grouped into themes            → found 5 themes
   ✓ Mapped to your Acme ladder     → 7 of 9 competencies
   ▸ Selecting your strongest evidence…
   ○ Writing in your voice
   ○ Checking every claim against your log
```

Each completed stage keeps its result inline. The last stage is named explicitly because the truthfulness pass is a feature, not plumbing.

## F3 · Editor

```
┌ Performance review · Feb–Jul 2026 · Acme ─── [Export ▾] [⋯] ─┐
│                                                               │
│  ┌ rail 240px ┐  ┌──────── document, max-w-[68ch] ─────────┐ │
│  │ Summary    │  │  SUMMARY                          [↻]    │ │
│  │ Highlights │  │  Over the past six months I focused on…  │ │
│  │  ▸ theme 1 │  │                                          │ │
│  │  ▸ theme 2 │  │  HIGHLIGHTS                       [↻]    │ │
│  │ Competency │  │                                          │ │
│  │ Growth     │  │  Made checkout reliable at peak          │ │
│  │ Appendix   │  │  Removed the top source of checkout      │ │
│  │            │  │  failures for 2M weekly users.           │ │
│  │ 47 wins    │  │   • Cut p95 800ms → 180ms  ·  Jul  ◆     │ │
│  │ 2 warnings │  │   • Eliminated the top support…    ◆     │ │
│  └────────────┘  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

- **`body-read` at 68ch.** It's a document.
- **Every sentence is hoverable** → a `SourceChip` cluster appears in the left margin; clicking opens the Win drawer over the packet.
- **Ungrounded sentences** carry an inline `GroundChip size="sm"` and a dotted amber underline. The rail's warning count links to the first one.
- **`[↻]` per section** — regenerate with an optional one-line instruction ("shorter", "lead with reliability").
- **Blocks edit in place**, `⌘↵` to save; edits persist to `userEdits` and survive regeneration.
- Confidential Wins render with the lock glyph and are listed in the pre-export prompt.

**Export menu:** Markdown (primary — the real use is pasting into Workday/Lattice) · PDF · Plain text · Copy section.

---

# G. Readiness report — `/log/readiness`

Standalone, year-round. Not buried inside packet generation.

```
   READINESS FOR STAFF ENGINEER · Acme ladder
   Based on 47 wins, Feb – Jul 2026            [ Change target ▾ ]

   ✓ Technical depth    ●●●●●  strong     6 wins, 4 quantified
   ✓ Execution          ●●●●○  strong     9 wins
   ~ Scope & ambiguity  ●●○○○  adequate   2 wins — both single-team
   ✗ Influence          ●○○○○  thin       1 win in 6 months
   ✗ Mentorship         ○○○○○  absent     no evidence logged

   ── The honest read ──────────────────────────────────────
   Your technical case is strong. Your scope case is not.
   Staff at Acme requires "impact across at least two teams"
   and your log shows one cross-team win (the payments design
   review, June). That's the gap that decides this.

   ── What would close it ──────────────────────────────────
   • Two more cross-team contributions with a named outcome
   • Any mentorship you're already doing but haven't logged

     ┌──────────────────────────────────────────────────┐
     │ You have 3 unlogged PR reviews for junior         │
     │ engineers.                        [ Show me → ]   │
     └──────────────────────────────────────────────────┘
```

**That last card is the most important interaction on the screen** — it converts a diagnosis into capture and closes the loop back to the log. Give it a `signature` surface; it's the one thing here that should draw the eye.

**Tone is a design constraint.** Verdict labels are plain words, not grades. No score out of 100 — a number invites optimizing the number.

**Free tier:** competency rows render with their real names, values blurred, single CTA (PW1).

---

# H. Rubric upload

```
   Add your company's leveling framework

   ( ) Upload a document      PDF, DOCX, or paste
   ( ) Use a public ladder    Google · Meta · Dropbox · …
   ( ) Patronus default       6 generic competencies

   ┌──────────────────────────────────────────┐
   │   Drop a file, or paste the text          │
   └──────────────────────────────────────────┘
   🔒 Stored privately. Never shared, never used for training.
```

**Parse confirmation is mandatory** — never generate against an unconfirmed framework:

```
   We found 5 levels and 9 competencies. Look right?

   Levels        Junior · Mid · Senior · Staff · Principal      [edit]
   Competencies  Execution · Technical depth · Scope &
                 ambiguity · Influence · Mentorship · …          [edit]

   [ Looks right ]        [ Let me fix it ]
```

---

# I. Backfill chat — `/log/backfill/[sessionId]`

```
┌──────────────────────────────┬───────────────────────────┐
│ Acme · 2023–2025             │  CAPTURED SO FAR       6  │
│ Question 4 · ~5 min left     │                           │
│──────────────────────────────│  ✓ Cut checkout p95       │
│                              │    800ms → 180ms          │
│  You said the migration      │    ⚡ quantified           │
│  unblocked the payments      │                           │
│  team. How many people       │  ✓ Led the payments       │
│  were waiting on it?         │    migration              │
│                              │    ⚠ needs a number       │
│  ┌────────────────────────┐  │                           │
│  │                        │  │  ✓ Mentored 2 engineers   │
│  └────────────────────────┘  │                           │
│  [ I don't remember ]        │  (cards animate in)       │
│                              │                           │
│              [ Pause ]       │                           │
└──────────────────────────────┴───────────────────────────┘
```

- **The right rail is the product.** Cards fly in within 2s of each answer, `state` easing. Watching it fill is what makes people finish.
- Chat text at `body-read`. Progress is honest ("~5 min left"), never a fake bar.
- `[I don't remember]` is a real button of equal visual weight — making it easy to skip is what keeps the conversation moving.
- Pause is always visible and carries no warning dialog.

**Close:**
```
        You just recovered 9 wins from 2023–2025.
        6 have hard numbers. 3 are cross-team.

        Before this, your Acme record was 3 resume bullets.

        [ Review and confirm all ]    [ Do another period ]
```

---

# J. Settings

## J1 · Sources — `/settings/sources`
```
   ┌ GitHub                                     ● Active ─┐
   │ jai0651 · 12 repos · public + private     [ Edit ]   │
   │ Last sync  Jul 31, 16:02 — 38 scanned, 3 drafted     │
   │ Has drafted 61 of your 74 wins                        │
   │ [ Sync now ]  [ Pause ]  [ Disconnect ]               │
   └───────────────────────────────────────────────────────┘

   ┌ Google Calendar                         ○ Not connected┐
   │ Captures the meetings and reviews GitHub can't see.    │
   │ [ Connect ]                                    Career  │
   └────────────────────────────────────────────────────────┘
```
"12 repos · public + private" answers *what can this see?* without navigation. Status: green Active · amber Needs attention · grey Paused · red Revoked, each with a word, never color alone.

**Disconnect dialog** — both options, per PRD 02 §7.2. The destructive option is a text link, not a red button; offering it is what makes the safe option credible.

## J2 · Notifications — `/settings/notifications`
Channel (Email / Telegram / Both), day + hour pickers with a live preview line (*"Next digest: Friday, Aug 7 at 4:00 PM IST"*), per-category toggles, and one unsubscribe-all.

## J3 · Plan — `/settings/plan`
Current plan, renewal, `QuotaMeter` per metered action with reset date, change plan, turn off Search, invoices, **Export everything** (deliberately on this page), and cancel one click away.

---

# K. Email

Email is a designed product surface, not a notification. Constraints: 600px table, inline styles, no web fonts (system stack), dark-mode media query, functional with images off, plain-text alternative always.

## K1 · Weekly digest

```
─────────────────────────────────────────
  PATRONUS                    Jul 25 – 31
─────────────────────────────────────────

  3 things you did this week

  ① Cut checkout p95 latency 800ms → 180ms
     Rewrote the pricing lookup as a batched
     query with a read-through cache.
     From: PR #482 · patronus/api

     [ ✓ Log it ]  [ ✎ Edit ]  [ ✕ Not a win ]

  ─────────────────────────────────────
  ② Unblocked the payments team on webhook
     retries
     From: PR review · patronus/payments

     [ ✓ Log it ]  [ ✎ Edit ]  [ ✕ Not a win ]
  ─────────────────────────────────────

  Anything we missed?
  [ Add a win → ]

─────────────────────────────────────────
  14 wins logged · 6 weeks running
  Change when you get this · Unsubscribe
─────────────────────────────────────────
```

- **Subject:** `3 things you did this week` — the number is dynamic and is the whole subject line. Never "Your weekly digest."
- **Preheader:** `Confirm in 20 seconds — Friday, Jul 31`
- Buttons are 40px tall, ≥120px wide (thumb targets), and are **links, not images**.
- Zero signals → no email (PRD 01 §5.2).

## K2 · Month in Review
Section E, table-rendered. Subject: `July: 8 wins, 5 with numbers`.

## K3 · T-90 readiness nudge
Subject: `Your March review is 3 months out`. Body: the single largest gap, one sentence on why it matters, one CTA. **The highest-value email the product sends all year** — treat its copy accordingly.

## K4 · Magic-link landing — `/w/[token]`
Logged-out, mobile-first, must render in under 500ms.
```
              ✓  Logged

     Cut checkout p95 latency 800ms → 180ms

              Was this you?  Undo

         [ See your full log → ]
```

---

# L. Extension side panel

360px wide, `density-compact`, work surfaces. First paint <200ms — that budget forbids blur and heavy shadows here entirely.

**Additions in R1:**
1. **`+ Log a win`** as a persistent top action — the same quick-capture flow, condensed to one field. Most valuable right after someone finishes a task on a work tool.
2. **Workspaces inbox** rendering existing `ApplicationWorkspace` data (Phase 3 wiring, PRD 02 in v2 plan).

The panel keeps its existing IA; the log entry point is additive, not a redesign.

---

# M. Screen build order

| Phase | Screens |
|---|---|
| 0 | `/dev/patterns` |
| 1 | B (log), C (drawer), D (quick capture) |
| 2 | A1–A3 (onboarding), J1 (sources) |
| 3 | K1 (digest), K4 (landing), J2 (notifications) |
| 4 | E (Month in Review) + rail value statement |
| 5 | F1–F3 (packet), G (readiness), H (rubric) |
| 6 | I (backfill) |
| 7 | J3 (plan), paywall surfaces PW1–PW7 |

Every screen ships with its empty, loading, error, and permission-denied states in the same PR. A screen without its states is not done.
