# Design 03 — Dossier

> **Status:** `Shipped (pass 1)` · **Date:** 2026-11-08 · **Scope:** web app, marketing, auth, extension tokens
> **Supersedes:** the colour, type and elevation sections of [`00-foundations.md`](00-foundations.md) (§3, §4.1, §6) where they disagree. Everything else in 00–02 still holds.
> **Live reference:** `/dev/patterns` (every pattern, both themes) and `/dev/patterns/home` (Home, mocked, in the real shell; `?theme=dark`, `?state=new`, `?chat=1`).

---

## 1. Why

The owner's brief: *"the current UI is plain, classic but too plain; give UI looks importance and make things more user friendly without making it look like an AI-sloppy app."*

Patronus is a private record of someone's working life, so the interface is set like a well-kept file: warm paper, deep ink, hairline rules between sections, one confident accent. It gets its character from type and rules, not from effects.

---

## 2. Palette

All tokens live in `src/app/globals.css` as bare HSL triplets (`hsl(var(--token))`). The extension mirrors them in `extension/src/shared/ui/tokens.css`, and `src/lib/designTokenParity.test.ts` fails on any drift.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--background` | Paper, the page ground | `#FAF8F5` · `36 33% 97%` | `#0F1524` · `222 43% 10%` |
| `--card` / `--popover` | Records on the page | `#FFFFFF` | `#151E32` · `221 40% 14%` |
| `--foreground` | Ink | `#14213E` · `221 51% 16%` | `#EEEAE3` · `38 24% 91%` |
| `--muted-foreground` | Secondary text | `#585F6F` · `222 12% 39%` | `#A2A7B4` · `221 11% 67%` |
| `--secondary` / `--muted` | Quiet warm fill | `#F1EFE9` · `40 24% 93%` | `#1C263B` · `221 35% 17%` |
| `--primary` / `--ring` | **Teal**: primary actions, links, progress, focus | `#0F756D` · `175 77% 26%` | `#5BC2B5` · `172 46% 56%` |
| `--accent` / `--accent-foreground` | Teal wash for selected things | `#E4F1EF` / `#0B5650` | `#16353B` / `#8DD8CE` |
| `--warning` | **Amber**: "needs you", nothing else | `#A54C09` · `26 90% 34%` | `#E8A359` · `31 76% 63%` |
| `--success` | Semantic | `#1E6B44` · `149 56% 27%` | `#61C28E` · `148 44% 57%` |
| `--danger` / `--destructive` | Semantic | `#B42318` · `4 76% 40%` | `#F07F70` · `7 81% 69%` |
| `--info` | Quiet ink-blue, deliberately not a second accent | `#2E4B7A` · `217 45% 33%` | `#94AEDB` · `218 50% 72%` |
| `--border` | Hairline rule, decorative only | `#E4DFD7` · `37 20% 87%` | `#26324A` · `221 32% 22%` |
| `--border-strong` | Edge of a control | `#8B8579` · `40 7% 51%` | `#5F6C86` · `221 17% 45%` |
| `--input` | Field edge, switch track | `#988F81` · `38 10% 55%` | `#616E89` · `221 17% 46%` |

### 2.1 Measured contrast

These come from the WCAG 2.x relative-luminance formula, applied to the HSL values exactly as the browser rounds them. The same table is in the `globals.css` header. Text needs 4.5:1. Control edges and focus rings need 3:1.

| Light | on paper | on card | on secondary |
|---|---|---|---|
| foreground | 15.01 | 15.93 | 13.83 |
| muted-foreground | 6.06 | 6.43 | 5.58 |
| primary as text | 5.20 | 5.52 | 4.79 |
| warning (amber) | 5.44 | 5.77 | 5.01 |
| success | 6.07 | 6.44 | 5.59 |
| danger | 6.22 | 6.60 | 5.73 |
| info | 8.20 | 8.70 | 7.55 |

White on primary 5.52, on success 6.44, on warning 5.77, on danger 6.60. Accent-foreground on accent 7.34. Teal on its own 10% tint 4.81. Amber on its own 10% tint 5.00. `--border-strong` 3.67 on card. `--input` 3.19 on card and 3.00 on paper. `--border` 1.32: decorative, never the only edge of a control.

| Dark | on ground | on card | on secondary |
|---|---|---|---|
| foreground | 15.12 | 13.74 | 12.58 |
| muted-foreground | 7.58 | 6.89 | 6.31 |
| primary as text | 8.55 | 7.77 | 7.11 |
| warning | 8.52 | 7.74 | 7.09 |
| success | 8.31 | 7.55 | 6.91 |
| danger | 6.91 | 6.28 | 5.75 |
| info | 8.10 | 7.36 | 6.74 |

Ground-ink on primary 8.55. `--border-strong` 3.12 on card, `--input` 3.23.

**Amber was pinned by measurement.** The brief's `#B45309` measures 4.36:1 on `--secondary` and 4.38:1 on its own tint, so it was darkened one step to `#A54C09`.

---

## 3. Type

Two families, both self-hosted through `next/font/local` (`src/app/fonts.ts`). Nothing is fetched from Google at build time.

- **Source Serif 4** (Adobe, SIL OFL 1.1), latin, weight axis 400–700, 51KB, exposed as `--font-serif`. The Tailwind utilities are `font-display` and `font-heading`; they are the same face. It is a text serif rather than a fashion one (Playfair, Fraunces), because the record should read like a well-set document.
- **Inter** (OFL 1.1) carries the interface.
- **Sora is gone from the web app.** The extension still bundles its own copy.

**Rule: serif for the page and its sections, sans for everything inside them.** `h1` and `h2` default to the serif and `h3`–`h6` to Inter. Both defaults sit in `@layer base`, so a utility on the element still wins.

| Role (`typeStyles.*`) | Size / line | Face | Use |
|---|---|---|---|
| `display` | 34 / 42, −0.015em | Serif 600 | Home's greeting, first-run headlines |
| `h1` | 28 / 36, −0.01em | Serif 600 | Page titles (`PageHeader`) |
| `h2` | 19 / 26 | Serif 600 | Section headings |
| `h3` | 15 / 22 | Inter 600 | Card and row titles |
| `body` | 14 / 22 | Inter 400 | Default |
| `bodyRead` | 16 / 26 | Inter 400 | Long-form only |
| `small` | 13 / 18 | Inter 400 | Metadata |
| `eyebrow` | 11 / 16, +0.08em, uppercase | Inter 600 | Section kickers, stat labels |
| `stat` | 28 / 32, lining tabular | Serif 600 | Numbers in a `StatStrip` |
| `ledger` | 12 / 16, tabular | System mono | Dates, sources and ids in a meta row |

Every count, date and metric uses `.num`, which turns on lining tabular figures.

---

## 4. Space, shape, elevation, motion

- **Spacing:** an 8px rhythm. Use 8/16/24/32 between elements, 32 between the sections of a page, and 48 only at page level.
- **Radius:** `--radius` is 8px. `rounded-xl` maps to 8px as well, and `rounded-2xl` to 12px for sheets. Buttons and inputs use 6px (`rounded-md`), tags and chips 4px (`rounded-sm`).
- **Elevation:** borders over shadows. Cards are white with a hairline edge and no shadow. Shadows appear only on things that float: popovers, dialogs, sheets and toasts. `patronus-glow*` no longer draws a glow. `.patronus-glow` is a quiet 3px teal ring, and the other glow classes do nothing.
- **Motion:** only to show a change of state. Durations are 150–220ms and colour transitions are preferred, because nothing that moves can shift layout. `prefers-reduced-motion` drops transforms and keeps 100ms crossfades (globals.css). Scroll reveals on marketing are 220ms over 8px.
- **Cascade trap, fixed:** `* { border-color }` used to be unlayered, and it silently beat every Tailwind border-colour utility (`border-primary`, `border-warning`, `border-transparent` all rendered grey). It now sits in `@layer base`. Keep global element rules in a layer.

---

## 5. Components and patterns

All of these live in `src/components/patterns` (exported from the index) and `src/components/ui`.

| Pattern | What it is | Notes |
|---|---|---|
| `PageHeader` | `eyebrow` · serif `title` · one-line `description` · `actions` (one primary) · `meta` row · tabs as children | `size="display"` is for Home only. `EyebrowLink` makes the eyebrow a way back up ("‹ Settings"). |
| `PageTabs` | Underlined tabs | Teal 2px underline on the active tab. |
| `Section` | Eyebrow (+count, `tone="attention"`) · optional serif title · description · `action` slot | `ruled` (default) is a hairline above with no box. `boxed` is a white card with a ruled header. Its heading is always a real `h2`. |
| `SectionLink` | "View all →" | |
| `StatStrip` | Ruled row of serif tabular numbers under eyebrow labels, each optionally a link | At most one `tone="attention"` cell. `layout="fixed"` keeps all cells on one row in a narrow column. `bare` drops the rules. |
| `ProgressRail` | Horizontal stages: done / current / upcoming / skipped. A current step can take `tone="attention"`. | `size="compact"` for list rows. It is an `ol` with `aria-current="step"` and each status in sr-only text, so meaning never rests on colour. Feed it `jobStages()` from `src/lib/jobStages.ts`. |
| `EvidenceChip` | `[icon] Plivo · media path`, linkable | The light provenance label. `SourceChip` remains the variant with the excerpt popover. |
| `EmptyState` | Icon tab · serif title · what will appear here · exactly one primary action | `size="inline"` sits inside a list container. There is no glow and no gradient. |
| `Pill` | Neutral ruled tag with a status dot | 4px corners. |
| `Button` | Flat, 6px corners, colour-only hover and press (150ms) | `default` teal · `outline` white with a ruled edge · `secondary` · `ghost` · `link` · `destructive`. |
| `Badge` | 4px ruled tag | Adds `attention` (amber) and `success` variants. |
| `Card` | White, hairline edge, 8px corners | No shadow, no blur. `CardTitle` is the serif. |
| `Input` / `Textarea` / `Select` | White field with a `--input` edge (3:1); on focus a teal edge plus a soft ring | 16px text below `sm`, so iOS does not zoom on focus. |
| `Skeleton` | Warm `--secondary` pulse at final geometry | `aria-hidden`. Loading pages carry `aria-busy`. |

### 5.1 Job stages (`src/lib/jobStages.ts`)

The model is pure and tested (`jobStages.test.ts`): Analyzed → Tailored → Email ready → Applied.

- A stage whose fact is true is **done**.
- The first stage that is not done, with nothing done after it, is **current**.
- A stage that is not done but has a later stage done is **skipped**. Someone who applied with their own resume never tailored one, and the rail says so.

`jobStageFacts(workspaceRow)` derives the facts from an `ApplicationWorkspace` row plus `emailReady`, which Home computes from `MessageDraft(format='email')`. Home marks "Applied" as `attention` when it is the only step left.

---

## 6. Screens (pass 1)

- **Shell** (`AppNav.tsx`):
  - Ink on paper, with sidebar groups **Search** (Home, Jobs, Job watch, Chat) and **Record** (Work Log, Resumes, Packets, Radar), then Goals set off by a rule (`NAV_GROUPS`).
  - The current page gets a 2px teal bar on the inner edge and ink text, not a filled pill. The phone tab bar puts the same bar on top of the current tab.
  - There is a skip link, and `<main id="main">`.
- **Home** (`/overview`):
  - A display-serif greeting, then one status sentence built from counts (`src/lib/overviewStatus.ts`).
  - The pipeline as a `StatStrip`.
  - "Needs you" as the only amber on the page.
  - "Jobs in motion", each job with a `ProgressRail` (new `Overview.jobs`).
  - Ruled sections for activity, interviews, record, goal, resumes and setup.
  - The first-step card is white with a teal leading rule.
- **Goals, Work Log, Resumes, Packets, Radar, Job watch, Settings (all except Plan):** these use `PageHeader` with an eyebrow. Settings sub-pages get "‹ Settings". Settings now has **Appearance (Light/Dark)**, the first UI that has ever exposed dark mode.
- **Marketing and auth:** light Dossier paper, same tokens, copy unchanged (see `src/app/(marketing)/marketing.css`). They are pinned to `.light`, so a reader who chose dark still sees the public pages as designed.

---

## 7. Decisions

1. **Marketing goes light, not dark-ink.** It is one product from landing to sign-in to app. The old dark page depended on glow, blur blobs, a conic sweep and a pulsing CTA, all banned below, and with those removed the dark page had nothing left. Paper carries the identity through type and rules.
2. **Auth follows marketing onto paper**, since every visitor arrives from it.
3. **Dark mode stays, re-derived as deep ink.** It had full tokens but no switch. The extension also follows the OS into dark, so the palette has real users. Settings → Appearance now exposes it.
4. **One accent.** Teal means "act here" or "you are here". Amber means "this waits on you". `info` is an ink-blue that sits with the ink, not a rival hue.

---

## 8. Do / don't

**Do**
- Use one teal primary per view. Everything else is outline or ghost.
- Separate parts of a page with a hairline rule and an eyebrow.
- Put a serif title on every page, and serif tabular numbers wherever a count matters.
- Show provenance next to claims (`EvidenceChip`), and stages next to jobs (`ProgressRail`).
- Give every empty state one sentence on what will appear, plus one action.
- Make focus rings visible and teal. Touch targets are at least 44px on touch layouts.

**Don't**
- No glassmorphism or `backdrop-blur`. Never use it on a scrolling list.
- No purple or blue "AI" gradients, no gradient text, no glow halos.
- No sparkles, wands or emoji used as icons or as decoration. Use a semantic icon: `PenLine` for tailoring, `FileCheck2` for checked.
- No floating rounded cards in empty space, and no oversized hero illustrations.
- No generic copy ("Supercharge your career"). The banned-word list in 00 §10 applies.
- No motion that does not show a change of state. Nothing lifts, scales or pulses on hover.
- Never colour alone: status always carries a word or an icon.
- Don't use raw palette shades (`text-teal-400`). `theme.test.ts` rejects them. Use tokens.

---

## 9. For pass 2 (job page, chat, plan)

- **Job page** (`src/components/scout/**`, `src/components/inbox/**`): put the job in a `PageHeader` with `eyebrow` (the company), the role as the title and `meta` = `ProgressRail` from `jobStages(jobStageFacts(...))`. Turn the fit reasons and matched requirements into `EvidenceChip` rows, and make each research block (company, comp, people) a `Section variant="boxed"`. The list (`JobsBoard`) should show a compact `ProgressRail` per row in place of the status pill, and mark "to review" with the amber `Section` tone, not with colour on the pill.
- **Chat** (`src/components/chat/**`): the greeting already picks up `typeStyles.display` (serif). Rebuild the cards on `Card` with a hairline edge, show job cards with the compact rail, and swap any decorative icons. The composer should match `AskBar` (white field, `--input` edge, teal send).
- **Plan** (`/settings/plan`): use `PageHeader` + `EyebrowLink`, and a `StatStrip` for usage with `layout="fixed"`. `QuotaMeter` bars go teal, then amber at 80% and danger at 100%. Keep plan names from `PLAN_CATALOG`.
