# Design 00 — Foundations

> **Status:** `Draft for build` · **Date:** 2026-08-01 · **Scope:** web app, email, extension
> **Companions:** [`01-components.md`](01-components.md) · [`02-screens.md`](02-screens.md)
> **Grounded in:** the existing theme at `src/app/globals.css` and the 21 primitives in `src/components/ui/`

---

## 1. Audit of what exists

The current system is coherent and has a real point of view: *"Your best self, in the light"* — deep navy ground, silvery-blue glow, Sora headings over Inter body. Keep the identity. Three things need to change before we build a data-dense work tool on top of it.

### Problem 1 — The theme is dark-only

`:root` in `globals.css:16-40` holds dark values with no light counterpart, though `next-themes` is installed. For a marketing site that's a choice. For this product it's a blocker:

- Review packets are **documents people read at work**, often in bright offices, often screen-shared into a meeting with their manager.
- The log gets opened at a desk mid-morning, not at 1am.
- Email is light-first in most clients regardless of what we prefer.

**Decision:** light mode is the **default** for the authenticated app; dark is a first-class option. The marketing site keeps dark as its default. This is not a preference toggle — it's a different job.

### Problem 2 — Marketing chrome on work surfaces

`Card` (`src/components/ui/card.tsx:12`) applies `bg-card/80 backdrop-blur-sm shadow-lg` and `Button` default carries `patronus-glow-sm`. Beautiful on a landing page. On a list of 500 Wins it is:
- **Visually exhausting** — glow reads as "this is important"; when everything glows, nothing is.
- **Slow** — `backdrop-blur` forces compositing per element. Five hundred blurred cards will drop frames on scroll, and we have a 400ms p95 budget for that view.

**Decision:** two surface modes.

| Mode | Where | Treatment |
|---|---|---|
| **Signature** | Marketing, onboarding, empty states, the Month in Review, paywalls, mission cards | Glow, blur, gradient. The moments that should feel special. |
| **Work** | Log list, review queue, packet editor, settings, tables | Flat surfaces, 1px borders, no blur, no glow. Shadow only on genuinely floating elements (drawer, popover, toast). |

Add `.surface-work` as an explicit opt-in class, and make `WinCard`/`ReviewQueue`/tables use it by default. **Glow becomes a reward signal**, reserved for the confirm animation and the packet-ready moment.

### Problem 3 — Fonts block render

`globals.css:1-2` loads Inter and Sora via CSS `@import url(...)` from Google Fonts. This is render-blocking, adds two DNS round-trips, and costs measurable LCP on the first paint we care most about.

**Decision:** move to `next/font/google` with `display: 'swap'`, `subsets: ['latin']`, self-hosted at build. Weights actually used only: Inter 400/500/600, Sora 500/600. Drop Inter 300/700 and Sora 400/700 — five weights removed, ~60KB saved.

---

## 2. Design principles

Five, in priority order. They resolve arguments.

**1. The 20-second bar governs everything.**
The weekly confirm is the product's most-repeated interaction. Every design decision on that path is judged by one question: does this cost the user milliseconds or save them? Keyboard-first, no confirmations, no modals, no navigation.

**2. Density is a feature, not a compromise.**
This is a tool for people with hundreds of records. Cramped is bad; airy is worse — it means scrolling past your own career. Target ~56px log rows, not 96px. Whitespace goes *between groups*, not inside them.

**3. Earn every pixel of chrome.**
Icons, borders, badges, and shadows all cost attention. If removing an element doesn't hurt comprehension, remove it. The category chip has an icon *because* the taxonomy is scannable at a glance; the date does not, because dates read fine as text.

**4. Show provenance, always.**
Every AI-generated string in this product carries a visible path back to its source. That's not a compliance feature, it's the brand rendered in UI. `SourceChip` and `GroundChip` appear anywhere a claim does.

**5. Never celebrate the tool; celebrate the record.**
No confetti for logging a win. No "Great job!" The counter incrementing is the reward. Congratulate outcomes (a promotion, an offer) — never usage.

---

## 3. Color

### 3.1 Keep the brand hues, add a light scale

Current dark values stay exactly as they are. Add the light set and switch the selector strategy so `next-themes` can drive both.

```css
:root, .light {
  --background: 210 20% 99%;      /* near-white, faint cool cast */
  --foreground: 222 35% 12%;
  --card: 0 0% 100%;
  --card-foreground: 222 35% 12%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 35% 12%;

  --primary: 205 78% 42%;          /* darkened from the dark-mode 72% L for AA on white */
  --primary-foreground: 0 0% 100%;

  --secondary: 210 22% 96%;
  --secondary-foreground: 222 30% 18%;
  --muted: 210 22% 96%;
  --muted-foreground: 215 14% 42%;  /* 4.6:1 on --background */
  --accent: 205 70% 94%;
  --accent-foreground: 205 78% 30%;
  --destructive: 0 68% 46%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 18% 89%;
  --input: 214 18% 89%;
  --ring: 205 78% 42%;
  --glow: 205 78% 55%;
}

.dark { /* the existing :root block, moved verbatim */ }
```

**Migration note:** the current dark values must move from `:root` into `.dark`, and `next-themes` configured with `attribute="class"`, `defaultTheme="light"` for `(app)` routes and `"dark"` for marketing. Verify every existing screen in light before shipping — some components will have hardcoded dark assumptions.

### 3.2 Semantic status — the only place color carries meaning

```css
/* CORRECTED 2026-08-01 after measurement — see note below. */
--success:   152 62% 30%;   /* light, 5.19:1 */   152 50% 55%;  /* dark */
--warning:    38 95% 31%;   /* light, 5.04:1 */    38 88% 62%;
--danger:      0 68% 46%;                           0 72% 58%;
--info:      205 78% 42%;                         205 85% 72%;
```

> **Correction.** The originally specified light values — `--success: 152 55% 38%` and `--warning: 38 82% 45%` — measure **3.62:1** and **2.75:1** on `--background`, both failing the 4.5:1 floor this same document sets in §3.4. They were eyeballed, not computed. The values above preserve the hue and clear AA. Dark values were measured and are unchanged.
>
> Two further measured results, replacing estimates elsewhere in this doc: light `--muted-foreground` is **5.49:1** (§3.1 guessed 4.6), and light `--primary` is **4.54:1** — it clears AA by 0.04, so treat it as pinned: any darkening of `--background` or lightening of `--primary` breaks it.
>
> **`--border` (1.30:1 light, 1.23:1 dark) is a decorative hairline and must never bound an interactive control** — WCAG 1.4.11 wants 3:1. Use `--border-strong` (light `214 16% 58%`, dark `215 16% 44%`) for control edges. Note `--input` currently shares `--border`, so the `Switch` track and `Select` border are sub-3:1 today.

Used **only** for: ground state (grounded / needs-confirmation / unsupported), connector health, quota state, and readiness verdicts. Nothing else gets a semantic color.

### 3.3 Categories do not get colors

Eight Win categories, eight hues, is a rainbow — it looks like a bug tracker and it makes the log harder to scan, not easier. **Each category gets an icon and a neutral chip.** One shape language, zero color noise.

| Category | Icon (lucide) |
|---|---|
| `shipped` | `package` |
| `improved` | `trending-up` |
| `fixed` | `wrench` |
| `led` | `flag` |
| `influenced` | `git-pull-request-arrow` |
| `grew` | `sprout` |
| `learned` | `book-open` |
| `saved` | `piggy-bank` |

Sensitivity is the one exception and it uses a **glyph, not a hue**: `internal_only` → `lock` outline; `confidential` → `lock` filled + a 2px left border in `--warning`. Legible in both themes and in greyscale.

### 3.4 Contrast floor
All text ≥ 4.5:1, UI boundaries ≥ 3:1, in both themes. `--muted-foreground` is the value most likely to fail — it is specified above at 4.6:1 and must be verified, not assumed.

---

## 4. Typography

### 4.1 Scale

Two families, seven roles. Sora for structure, Inter for content.

| Role | Size / Line | Family · Weight | Use |
|---|---|---|---|
| `display` | 30 / 38 | Sora 600 | Onboarding, Month in Review headline |
| `h1` | 22 / 30 | Sora 600 | Page titles |
| `h2` | 17 / 24 | Sora 600 | Section headers, packet themes |
| `h3` | 15 / 22 | Sora 500 | Card titles, Win titles |
| `body` | 14 / 22 | Inter 400 | App default |
| `body-read` | 16 / 26 | Inter 400 | **Long-form only**: packet editor, Month in Review, interview chat |
| `small` | 13 / 18 | Inter 400 | Metadata, secondary |
| `caption` | 12 / 16 | Inter 500, +0.01em | Labels, counts, timestamps |
| `mono` | 13 / 20 | ui-monospace | Evidence excerpts, IDs, diffs |

**The `body` / `body-read` split matters.** 14px is right for scanning a list of 60 wins; it's fatiguing for reading a 900-word packet. Any surface whose job is *reading* switches to 16px with a `max-width: 68ch` measure.

### 4.2 Rules
- Numerals: `font-variant-numeric: tabular-nums` on every count, date, metric, and quota — non-tabular figures make columns wobble.
- Win titles clamp to 2 lines; narratives to 3 in list view, unclamped in the drawer.
- Never center body text. Center only display headlines in signature surfaces.
- Sentence case everywhere, including buttons. No Title Case, no ALL CAPS except `caption`-role section labels.

---

## 5. Space & layout

### 5.1 Scale
4px base: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`. Nothing else. No 6, no 18, no 30.

### 5.2 App shell

```
┌────────────────────────────────────────────────────────────┐
│ TOP BAR  h=56                                              │
│ logo | Home Log Documents Applications Radar |  + Log a win │  ⌘K  avatar
├──────┬─────────────────────────────────────────────────────┤
│      │  CONTENT   max-w-[1120px], px-24, py-32              │
│      │                                                      │
│      │  ┌──────────────────────┬──────────────────┐        │
│      │  │  primary  (1fr)       │  rail  320px      │        │
│      │  └──────────────────────┴──────────────────┘        │
└──────┴─────────────────────────────────────────────────────┘
```

Horizontal top nav, not a sidebar. Five items (PRD 05 §5.2) fit comfortably, it costs no horizontal space on laptops, and it keeps the content column centered — which matters because the log and the packet are both reading surfaces.

### 5.3 Breakpoints

| | Width | Behavior |
|---|---|---|
| `sm` | <640 | Single column. Nav → bottom tab bar (5 icons). Rail content moves to a collapsible top summary. Drawer → full-screen sheet. |
| `md` | 640–1023 | Single column, 640px max. Rail collapses into the page above the list. |
| `lg` | 1024–1279 | Two columns; rail 280px. |
| `xl` | ≥1280 | Two columns; rail 320px; content max 1120px. |

**Mobile is a first-class target for exactly two flows:** confirming from the digest (`/w/[token]`) and quick capture. Everything else may be desktop-first. Say this out loud so nobody over-invests in a mobile packet editor.

### 5.4 Density
Three tokens, applied per surface:

| Token | Row height | Padding | Used by |
|---|---|---|---|
| `density-compact` | 48px | `py-8 px-12` | Review queue, evidence lists |
| `density-default` | 56px | `py-12 px-16` | Log list, applications |
| `density-relaxed` | auto | `py-20 px-24` | Packet blocks, Month in Review |

---

## 6. Elevation & surfaces

| Level | Treatment | Use |
|---|---|---|
| `flat` | `bg-card`, `border border-border` | Work surfaces — the default |
| `raised` | `+ shadow-sm` | Hovered rows, sticky headers |
| `floating` | `+ shadow-lg` | Drawer, popover, dropdown, toast |
| `signature` | `+ patronus-glow` + subtle gradient | Reward moments only |

**Radius:** keep `--radius: 0.625rem`. Cards `rounded-xl` (12px), inputs and buttons `rounded-lg` (10px), chips `rounded-full`, inline code `rounded-sm`.

**Borders:** 1px `--border` everywhere. The only 2px is the left rule on a `confidential` Win.

---

## 7. Motion

### 7.1 Durations
| Token | ms | Easing | Use |
|---|---|---|---|
| `micro` | 120 | `ease-out` | Hover, focus, chip toggle |
| `state` | 180 | `cubic-bezier(.2,0,0,1)` | Confirm, expand, row collapse |
| `enter` | 220 | `cubic-bezier(.2,0,0,1)` | Drawer, sheet, dialog |
| `exit` | 160 | `cubic-bezier(.4,0,1,1)` | Same, reversed — always faster than enter |
| `ambient` | 1200+ | `ease-in-out` | Generation progress shimmer only |

### 7.2 The confirm animation — the product's signature moment

It happens ~30 times a month per user. Getting it right is worth the specification.

```
t=0     ✓ button: scale 1 → 0.92 → 1        (90ms, spring-ish)
t=0     checkmark fill sweeps left→right     (140ms)
t=60    row background flashes --success/8%  (120ms, then fades)
t=100   row desaturates to 60% opacity       (state, 180ms)
t=180   row height collapses to 0            (state, 180ms)
t=180   counter in rail increments, tabular  (no count-up animation — it's a number, not a slot machine)
t=200   focus advances to the next row       (immediate, no scroll jump)
t=220   toast: "Logged · Undo"               (enter, 8s dwell)
────────────────────────────────────────────
total ≈ 400ms; the user can fire the next confirm at t=200
```

**Why the row collapses rather than vanishing:** instant disappearance makes users doubt what happened and hunt for it. A 180ms collapse reads as "filed."

**Why no confetti:** principle 5. The counter is the reward.

### 7.3 Reduced motion
`@media (prefers-reduced-motion: reduce)` → all transforms and height animations to 0ms; keep opacity crossfades at 100ms. The confirm becomes: flash, then remove. Never remove the *feedback*, only the movement.

---

## 8. Iconography

Lucide (already a dependency). 16px in dense contexts, 20px in nav and buttons, 1.5px stroke. Icons are always paired with text or an `aria-label` — never a bare icon button without one.

---

## 9. Accessibility baseline

Beyond WCAG 2.1 AA (PRD 08 §8.2), three product-specific requirements:

1. **The review queue is fully keyboard-operable and announces state.** Each confirm fires an `aria-live="polite"` message: *"Logged. 3 remaining."* This is also the fastest path for sighted power users — accessibility and the 20-second bar want the same thing.
2. **Focus is never lost.** After confirming the last item, focus moves to the queue's completion state, not to `<body>`.
3. **No state is color-only.** Ground chips carry icon + text + color. Sensitivity carries a glyph. Connector health carries a word.

Focus ring: `ring-2 ring-ring ring-offset-2 ring-offset-background` — already the `Button` default (`button.tsx:8`); apply the same to every custom interactive element.

> **Trap: `.surface-work` silently erases a ring-based focus indicator.** `.surface-work` sets `box-shadow: none` *outside any cascade layer*, so it beats Tailwind's utilities layer — and Tailwind's `ring-*` is implemented as a `box-shadow`. Any element carrying both loses its focus ring with no error and no visual warning.
>
> **Rule: on any element with `.surface-work`, use the outline-based focus indicator** (`outline-2 outline-offset-2 outline-ring`), not `ring-*`. They are visually identical. `src/components/patterns/tokens.ts` exports `focusRingOutline` / `focusRingOutlineStatic` for this; use them rather than re-deriving.
>
> This is a genuine accessibility failure mode, not a styling nit — a keyboard user gets no focus indicator at all. Found during the Wave A integration gate.

---

## 10. Voice in the interface

Extends PRD 08 §8.3 with the design-side rules:

- **Numbers are specific or absent.** "34 disclosed ranges," never "lots of data."
- **Labels are nouns; buttons are verbs.** Section: "Needs review." Button: "Confirm all."
- **Never apologize in an empty state.** "No wins yet" + one action. Not "Oops, nothing here!"
- **Errors name the fix.** "Select at least one repo" beats "Invalid selection."
- **The product never uses the word 'just'.** ("Just click here.") It's filler and it condescends.
- Banned in UI copy: *seamlessly, effortlessly, supercharge, unlock, leverage, AI-powered* (as a value claim), and exclamation marks anywhere outside a genuine outcome congratulation.

---

## 11. Implementation checklist for the theme work

Part of Phase 0 (P0.7), ~1 additional day beyond the six components:

- [ ] Move the current `:root` block to `.dark`; add the light block to `:root, .light`
- [ ] `next-themes` `attribute="class"`, default light for `(app)`, dark for marketing
- [ ] Replace the Google Fonts `@import` with `next/font/google`, five weights total
- [ ] Add `.surface-work` and apply it to `WinCard`, `ReviewQueue`, tables
- [ ] Add semantic status tokens for both themes
- [ ] Add `density-*` utilities
- [ ] Add `tabular-nums` to a `.num` utility; apply to every count and date
- [ ] Audit all existing screens in light mode — expect hardcoded dark assumptions
- [ ] Verify contrast on `--muted-foreground` and `--primary` in both themes with a checker, not by eye
- [ ] `/dev/patterns` renders every component in both themes, at all three densities
