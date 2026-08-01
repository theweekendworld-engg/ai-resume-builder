# Design 01 — Component Library

> **Scope:** the six patterns from ADR-9, specified to build from. Each entry gives anatomy, variants, every state, exact sizing, behavior, and a11y contract.
> **Location:** `src/components/patterns/` · **Preview:** `/dev/patterns` (dev-only route, both themes, all densities)

Existing `src/components/ui/` primitives are the substrate. Nothing below replaces them; each composes them.

---

## 1. `WinCard`

The most-reused component in the product. Appears in the log list, review queue, digest preview, packet appendix, backfill rail, and search results.

### Anatomy — `variant="list"` (density-default, 56px min)

```
┌─────────────────────────────────────────────────────────────────┐
│ ●  Jul 14 · improved · Acme                      🔒  ⋯          │  ← meta row, caption, 12/16
│    Cut checkout p95 latency 800ms → 180ms                       │  ← title, h3 15/22, clamp 2
│    🔗 PR #482   ⚡ −77%   #performance #postgres                 │  ← evidence row, small 13/18
└─────────────────────────────────────────────────────────────────┘
   ↑ 4px  ↑ 12px gutter                              ↑ actions on hover/focus
```

| Element | Spec |
|---|---|
| Status dot | 6px, `--success` when grounded, `--warning` when needs-confirmation, `--muted-foreground` when unquantified |
| Category | Lucide icon 14px + label, `caption`, `--muted-foreground` |
| Date | `caption`, `.num`, format `MMM D` within the current year, `MMM D, YYYY` otherwise |
| Employer | `caption`, truncates at 18ch |
| Title | `h3`, `--foreground`, 2-line clamp |
| Evidence row | `SourceChip` ×n (max 2 + "+2"), metric chip, skill tags (max 3 + "+n") |
| Sensitivity | Lock glyph in meta row; `confidential` also adds `border-l-2 border-warning` on the card |
| Padding | `py-12 px-16` at default; `py-8 px-12` at compact |
| Hover | `bg-secondary/40`, no lift, no glow (work surface) |

### Variants

| Variant | Difference |
|---|---|
| `list` | Above. The default. |
| `review` | Adds a right-aligned action group `[✓] [✎] [✕]`, always visible (not hover-only — it's the primary action). Adds a `SourceChip` line: *"From: PR #482 · patronus/api"*. |
| `compact` | Title + date only, 40px. Used in packet appendix, backfill rail. |
| `preview` | Non-interactive, used in email and empty-state samples. Inline styles for email. |

### States

| State | Treatment |
|---|---|
| Default | As above |
| Hover | `bg-secondary/40`, actions fade in at `micro` |
| Focused | Focus ring on the card, actions visible |
| Draft | Left edge `border-l-2 border-info`; meta row prefixed *"Draft"* |
| Confirming | The §7.2 animation from foundations |
| Confirmed (just now) | 8s: subtle `--success/6%` background, then normal |
| Dismissed (undo window) | 60% opacity, strikethrough title, "Undo" replaces the action group |
| Editing | Card expands in place; title becomes an input; `⌘↵` saves, `Esc` cancels |
| Skeleton | Three grey bars at 40% / 90% / 60% width, `animate-pulse` |
| Error | Red left border, inline retry, card stays readable |

### Behavior
- Whole card is clickable → opens the drawer. Action buttons `stopPropagation`.
- Click target minimum 44×44 for all actions (touch).
- `⋯` menu: Edit · Change date · Change sensitivity · Duplicate · Delete.

### A11y
`<article>` with `aria-labelledby` on the title. Actions are real `<button>`s with labels ("Confirm win: Cut checkout p95 latency"). Status dot has an `aria-label` naming the ground state.

---

## 2. `ReviewQueue`

Owns the 20-second bar. This is the component the thesis depends on.

### Anatomy

```
┌─ Needs review · 3 ──────────────────── [Confirm all] [Dismiss all] ─┐
│                                                                      │
│  ▸ WinCard variant="review"                          ← focused row   │
│  ▸ WinCard variant="review"                                          │
│  ▸ WinCard variant="review"                                          │
│                                                                      │
│  ⌨ j/k move · y confirm · n dismiss · e edit · u undo · ? help       │  ← hint bar
└──────────────────────────────────────────────────────────────────────┘
```

Container: `surface-work`, `rounded-xl`, `border`, header `h-48` sticky within the block.

### Keyboard model (the specification, not a suggestion)

| Key | Action |
|---|---|
| `j` / `↓` | Next row |
| `k` / `↑` | Previous row |
| `y` / `Enter` | Confirm focused |
| `n` / `Backspace` | Dismiss focused |
| `e` | Edit inline |
| `u` | Undo last action (stack depth 10) |
| `1`–`8` | Re-assign category on the focused row |
| `?` | Toggle the shortcut sheet |
| `Esc` | Exit edit, or blur the queue |

Focus auto-advances after confirm/dismiss. When the last row is actioned, focus lands on the completion state — never on `<body>`.

### States

| State | Treatment |
|---|---|
| Empty | Block does not render at all. No "nothing to review" card — that's noise. |
| 1–5 items | Standard |
| >5 items | Show 5, then `Show 7 more` — never an unbounded queue; it reads as a chore |
| All actioned | Replaces content: *"All caught up · 3 logged, 1 dismissed"* + `[Undo]`. Persists 10s, then the block unmounts with an exit transition. |
| Bulk in flight | Rows disable, per-row spinners, header shows "Confirming 3…" |
| Partial bulk failure | Successful rows collapse; failed rows stay with an inline error and retry |

### Hint bar
Visible on first three sessions, then collapses to a `⌨` icon with the sheet behind `?`. Tracked in `localStorage`, not the DB.

### A11y
`role="listbox"` with `aria-activedescendant` on the focused row; rows `role="option"`. An `aria-live="polite"` region announces every action: *"Logged. 2 remaining."* Bulk actions announce start and result.

---

## 3. `GroundChip`

The truthfulness brand, rendered. Extends the existing `TruthfulnessPanel` treatment into a reusable atom.

| State | Icon | Color | Label | Tooltip |
|---|---|---|---|---|
| `grounded` | `check-circle-2` | `--success` | "Grounded" | "Backed by: PR #482" + excerpt |
| `needs_confirmation` | `alert-circle` | `--warning` | "Confirm" | "We couldn't tie this to a source. Confirm to add it to your record." + `[Confirm]` |
| `unsupported` | `x-circle` | `--danger` | "Unsupported" | "This number isn't in your record and won't be printed." |

**Specs:** height 20px, `rounded-full`, `px-8 gap-4`, 12px icon, `caption` label, `bg-<color>/10 text-<color> border border-<color>/20`.

**Two sizes:** `sm` (icon only, 16px — for inline use in a packet sentence) and `default` (icon + label). The `sm` variant must still expose the label to screen readers.

**Critical behavior:** clicking a `needs_confirmation` chip is the one-click evidence-capture path from PRD 01 §7.1 — it opens a small popover with the claim, a text input for a source, and `[Confirm]`. Confirming writes `Evidence(confirmedByUser=true)` and the chip animates to `grounded`. **The chip is a producer, not a status light.**

---

## 4. `SourceChip`

Provenance, everywhere a claim appears.

```
 [◆ PR #482]     [📅 Design review]     [💬 You said this]     [📄 resume.pdf]
```

- Height 20px, `rounded-md`, `bg-secondary`, `border-border`, `caption`
- Icon per `EvidenceKind`: `repo`→`git-pull-request`, `document`→`file-text`, `url`→`link`, `interview_assertion`→`message-square-quote`, `metric_confirmed`→`badge-check`, `import`→`upload`
- Hover: popover with the stored `excerpt` (max 240 chars, `mono`) and an external link when one exists
- Dead source: strikethrough icon, muted, tooltip *"Source no longer available — the excerpt is preserved"*
- Max 2 inline; further sources collapse to `+n`, expanding into the popover

---

## 5. `StatTile`

Used in the log rail, readiness report, radar, and plan settings.

```
┌──────────────────┐
│ 74               │  ← value, Sora 600, 24/30, .num
│ wins logged      │  ← label, caption, --muted-foreground
│ ▁▂▃▅▆ 6 mo       │  ← optional sparkline, 40×16, --primary at 50%
└──────────────────┘
```

- Padding `p-16`, `surface-work`, `rounded-lg`
- Optional `delta` (`+8 this month`) in `caption`, `--success` / `--danger`
- Optional `hint` — an info icon opening a popover explaining the number. **Every derived stat must be explainable**; this is the same trust rule as the Radar band methodology.
- Variants: `default`, `wide` (value and label inline, for rail rows), `verdict` (adds a 5-dot meter for competency coverage: filled dots in `--success`, empty in `--border`)

---

## 6. `EmptyState`

The most under-designed component in most products, and this one has six of them.

```
        ◇  (icon 32px, --muted-foreground, or a small illustration)

        No wins yet                             ← h2
        Connect GitHub and we'll draft your      ← body, --muted-foreground,
        last 90 days in about a minute.            max-w-[42ch], centered

        [ Connect GitHub ]                       ← exactly one primary action
        or log one manually                      ← optional text link, small
```

**Rules:**
- **Exactly one primary action.** Two actions means we don't know what the user should do.
- Never apologize, never use an exclamation mark, never say "Oops."
- Padding `py-64 px-24`, content max-width 42ch, centered.
- `signature` surface mode — this is one of the few places glow is welcome.
- Where a *sample* helps (the log's first-run state), render 3 `WinCard variant="preview"` at 45% opacity behind a "Sample" caption, so the user sees what they're building toward.

**The six R1 empty states, each with its own copy** (full copy in [`02-screens.md`](02-screens.md)): log first-run · log connected-but-syncing · log filtered-to-zero · review queue done · no packets · no sources connected.

---

## Supporting atoms (thin, but specify them once)

### `CategoryChip`
Icon + label, `caption`, `bg-secondary`, `rounded-full`, `h-20 px-8`. No color per category (foundations §3.3). Clickable variant filters the log.

### `MetricChip`
`⚡ −77%` — `bg-info/10 text-info`, `.num`. Present only when an `ImpactMetric` exists. Its absence is meaningful: it's the visual cue that drives the "quantify this" prompt.

### `StreakBadge`
`🔥 6 weeks` — `caption`, only shown at ≥2 weeks. **Never resets visibly to zero**; a broken streak simply stops rendering. Punishing a missed week is how you lose the user who missed a week.

### `QuotaMeter`
Thin 4px bar + `4 of 15 this period · resets Aug 1`. Turns `--warning` at 80%, `--danger` at 100%. Always visible on `/settings/plan` — nobody should discover a limit by hitting it.

### `ProgressStages`
The generation theater (packets, resumes). Reuses `src/lib/generationProgress.ts` labels. Completed stages get a check and their result inline (*"found 5 themes"*); the active stage shimmers at `ambient`; pending stages are muted. **Never a bare spinner** — a 60s wait that shows its work reads as premium; a silent one reads as broken.

---

## Component build order (maps to Phase 0 P0.7)

| # | Component | Blocks |
|---|---|---|
| 1 | `SourceChip`, `GroundChip`, `CategoryChip`, `MetricChip` | Everything |
| 2 | `WinCard` (list, review, compact) | Phases 1–3 |
| 3 | `EmptyState`, `StatTile`, `StreakBadge` | Phase 1 |
| 4 | `ReviewQueue` | Phases 1, 3 |
| 5 | `QuotaMeter`, `ProgressStages` | Phases 5, 7 |

Build against fixtures with no data layer. `/dev/patterns` must show every variant × every state × both themes before Phase 1 starts — half a day that prevents three phases of restyling.
