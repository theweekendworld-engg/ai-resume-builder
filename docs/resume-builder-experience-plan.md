# Resume Builder & Growth Experience Plan

## Status
- Document state: `Proposed, not yet started`
- Owner: `@jai0651`
- Last updated: `2026-05-29`
- Relationship to other docs: complements `one-stop-platform-plan.md`. That document owns the *apply + track* loop (extension, orchestration, workspaces). This document owns the *discover + build + score + convert* loop (top-of-funnel, builder craft, template/design system, positioning).

## Purpose
We already win on the hardest part of the job: actually applying. The extension fills multi-page applications, the workspace tracks every application, and the agent pipeline tailors resumes to a JD. That moat is real and largely invisible to a first-time visitor.

What a new visitor experiences first is the opposite end of the funnel — landing page, the moment they get value, the builder, the templates, the export. Today that experience asks for a sign-up before delivering anything, ships three hardcoded resume templates with a fixed accent color, and presents the product feature-by-feature rather than outcome-first.

This plan closes that gap. The goal: a stranger gets a genuinely useful result inside 30 seconds with no account, the builder feels like a design tool and not a form, and the path from "free result" to "one-click apply" is a single obvious step. We are not adding net-new surfaces for their own sake — every item below either pulls a new user in or makes the build experience good enough that they stay.

This is a planning doc only. No code lands directly from this file. Each phase becomes its own implementation PR series.

## Product Principles
1. **Value before signup.** The first useful result must require no account. The account is the upsell, not the toll booth.
2. **Outcome over feature.** We sell interviews and time saved, not "ATS scoring" and "LaTeX export." Features are how, outcomes are why.
3. **The builder is a design tool.** Editing a resume should feel like editing a document with taste, not filling a database form. Live preview, real typography, instant restyle.
4. **One funnel, one identity.** The free checker, the builder, the extension, and the tracker are one product with one account and one data model. A visitor who starts with a free score and a builder who installs the extension are the same person mid-journey, never a re-onboard.
5. **Privacy is a feature we can prove.** Uploaded files are processed and not retained beyond the session unless the user saves them to their account. Say it plainly and make it true.

## North-Star Funnel
The journey we are designing for, in order:

1. **Land** → an outcome-led page that states what the user gets, with proof.
2. **Free value (no login)** → drop a resume PDF, get an ATS/quality score and a prioritized fix list in seconds.
3. **Convert** → "Fix these in one click" creates an account and lands the user in the builder with their parsed resume already loaded.
4. **Build** → a fast, good-looking editor: live preview, template gallery, design controls, AI rewrites, JD tailoring.
5. **Export** → a polished PDF the user is proud of.
6. **Apply + track** → hand off to the existing extension/workspace loop (owned by `one-stop-platform-plan.md`).

Every phase below is named by which step of this funnel it strengthens.

## Success Metrics
Track from Phase 1 ship, revisit every two weeks.

| Metric | Baseline (now) | Target |
| --- | --- | --- |
| Visitor → first useful result (free checker), median time | n/a (no free result exists) | < 30s |
| % of landing visitors who reach a free score | 0% | > 25% |
| Free-score → account conversion | n/a | > 15% |
| Account → first exported PDF | unmeasured | > 60% |
| Builder session: edits before first export | unmeasured | track, then reduce friction |
| % of new accounts that started from the free checker | 0% | > 40% within 8 weeks |
| Template applied ≠ default template | unmeasured | > 50% (proxy for "design tools used") |

Instrumentation is part of Phase 1.

## Locked Decisions
1. **The free ATS checker is anonymous and rate-limited, not gated.** No login wall. Abuse control is per-IP/Upstash rate limiting (already a dependency), not auth.
2. **Uploaded files in the anonymous flow are ephemeral.** Parse in memory / short-lived blob, score, return, discard. Only persisted if the user creates an account from that session and explicitly saves.
3. **One data model.** The free checker reuses the existing resume-import parse pipeline (`src/workflows/resumeImport.ts`, `/api/resume-import`) and `calculateATSScore`. No parallel scoring engine.
4. **Templates become data-driven, not hardcoded.** The current LaTeX generators stay as the render backend, but template identity, accent color, font, and spacing become a `ResumeTheme` object the user controls. We do not rewrite the PDF engine.
5. **Design system is shared.** New marketing and builder UI use the existing shadcn + Tailwind tokens. Color/style refresh is allowed (per stakeholder), but it is one refresh applied via tokens, not per-component drift.
6. **No auto-submit, ever.** Carried over from `one-stop-platform-plan.md`. The product fills, drafts, scores, and tracks. The user clicks submit.

## Phases

### Phase 1 — Free no-login value (top-of-funnel)
Goal: a stranger gets a real, specific result with no account, and the path to "fix it" is one click.

Scope:
- Public route `/(marketing)/score` (or `/ats-score`): drag-drop a PDF/DOCX (≤ 2 MB), parse, and return a scored report — no auth.
- Reuse the existing import parser and `calculateATSScore`. If a JD is pasted (optional field), score against it; otherwise score against general ATS/quality heuristics.
- **Report design (product-designer spec):**
  - A single headline score (0–100) with a clear band (e.g. Needs work / Good / Strong) and a confident, non-punitive tone.
  - 3–6 prioritized, *specific* fixes — each with the exact offending text and the suggested rewrite, not generic advice ("Add metrics to bullet 2: 'Built API' → 'Built API serving 2M req/day, cutting latency 40%'").
  - A breakdown by dimension (keywords / impact & metrics / formatting & parseability / length & structure / contact completeness).
  - Privacy line stated inline: file not stored.
- **Conversion moment:** primary CTA "Fix all of these in one click" → sign-up → lands in the builder with the parsed resume preloaded and the fix list carried over as an actionable checklist in the editor.
- Anonymous rate limiting via existing Upstash setup. Cap, friendly message on limit.
- Instrumentation: events for `score_started`, `score_completed`, `score_cta_clicked`, `score_to_signup`.

Done when: a logged-out user can score a resume in < 30s, see specific fixes, and convert into the builder with their data and fix list intact.

### Phase 2 — Template gallery + design system (build experience)
Goal: the builder feels like a design tool. The user chooses a look and restyles instantly.

Scope:
- **`ResumeTheme` model**: `{ templateId, accentColor, fontFamily, density, sectionOrder }`. Stored on the resume; defaults sensible. This is the contract between the editor controls and the LaTeX render backend.
- **Template gallery**: a visual picker with live thumbnail previews (render a representative sample, not lorem ipsum — use the user's own data so the preview is honest). Ship at least four distinct looks: a clean ATS-safe single-column, a modern two-column-aware layout, a classic serif, and a minimal/whitespace-forward variant. All remain ATS-parseable.
- **Design control bar** in the editor: accent color (curated palette + custom), font family (a small curated, embeddable set), density/spacing, and section reordering (the `SectionOrderEditor` already exists — wire it into the theme).
- **Live preview upgrade**: `PreviewPanel.tsx` is currently 36 lines. Make the preview reflect theme changes near-instantly (debounced recompile or client-side approximation with a "final PDF" confirm). The preview is the centerpiece of the editing experience, not a side tab.
- Templates are data + LaTeX generators parameterized by `ResumeTheme` — no fixed `mainblue`. Existing generators in `src/templates/latex.ts` get refactored to read the theme.

Done when: a user can switch templates and recolor/refont their resume and watch the preview update, with the choice persisted and reflected in the exported PDF.

### Phase 3 — Builder craft & AI assist polish (build experience)
Goal: the assist features feel proactive and trustworthy, not buried in panels.

Scope:
- **Inline smart suggestions**: surface "this bullet is weak — strengthen it" affordances directly on bullets in the editor (the `improveText` / `improveSection` actions already exist), not only inside a tool panel. One-click accept with a diff preview.
- **Conversational assistant** as a first-class editor surface: the `CopilotPanel` exists; elevate it to a persistent, context-aware assistant that can see the current resume + JD and take actions ("tighten my summary", "add the keywords I'm missing", "make this fit one page").
- **Fix-list follow-through**: the checklist carried from the Phase 1 free score lives in the editor and checks items off as the user (or AI) resolves them — closing the loop from "here's what's wrong" to "here's it fixed."
- **One-page / length intelligence**: live page-count indicator and a "make it fit one page" action.

Done when: a user who arrived with a fix list can resolve every item without leaving the editor, mostly via one-click AI actions they trust because each shows a diff.

### Phase 4 — Positioning & landing refresh (top-of-funnel)
Goal: the landing page sells outcomes and proof, and routes the right user to the right entry point.

Scope:
- Rework `Hero` / `Features` / `HowItWorks` / `Pricing` to lead with outcomes (interviews, time saved per application) and our real differentiator: build *and* apply *and* track in one place — most tools stop at the PDF.
- Add credible social proof and trust signals (usage counts, privacy guarantee, sample results) — only claims we can stand behind.
- Two clear entry points above the fold: "Check my resume free" (Phase 1) and "Build a new resume." The extension/apply story is the "and then it applies for you" reveal, not the lede.
- Optional, tasteful color/style refresh applied through design tokens (stakeholder has approved restyle latitude).

Done when: the landing page presents an outcome-led narrative, both free entry points are one click from the fold, and the apply+track moat is communicated.

### Phase 5 — In-app job discovery (discover) — discovery spike first
Goal: a logged-in user can see relevant jobs and jump straight into a tailored application, without leaving the product.

Scope (lower confidence — spike before committing):
- A "Jobs for you" surface seeded from ToS-friendly public board ingestion (Greenhouse/Lever public JSON endpoints), filtered by `UserProfile.preferences`. This overlaps `one-stop-platform-plan.md` Wave 4 — coordinate, do not duplicate. That doc owns the ingestion; this doc owns the in-app browse/apply UX.
- Each listing → "Tailor & apply" → existing generation pipeline + hands off to the extension/workspace loop.
- Explicitly out of scope: LinkedIn scraping, generic crawling of arbitrary career pages.

Done when: a logged-in user can browse a relevant set of jobs and start a tailored application in one click. Gate the build on the spike confirming ingestion quality is worth the surface.

## Sequencing & Rationale
- **Phase 1 first** because it is the highest-leverage gap: we currently deliver zero value before signup, and a free, specific result is the cheapest, most defensible way to grow the top of the funnel. It also feeds every later phase (parsed resume + fix list flow straight into the builder).
- **Phase 2 next** because once acquisition improves, the builder experience is what retains. Design control is the most visible quality gap in the current build experience.
- **Phase 3** deepens the builder once its frame is good.
- **Phase 4** can run in parallel with 1–2 (it is mostly content + design), but lands best after Phase 1 exists so the page can point at a real free result.
- **Phase 5** is opportunistic and gated on a spike.

## Cross-cutting Concerns

### Reuse over rebuild
Every phase leans on what exists: the import parser, `calculateATSScore`, `improveText`/`improveSection`, `CopilotPanel`, `SectionOrderEditor`, the LaTeX generators, the Upstash rate limiter, and the shared shadcn design system. New code is mostly *surfaces and orchestration*, not new engines.

### Design system discipline
One token-level restyle if we restyle at all. New marketing and builder components consume the same tokens. No per-component color drift. Thumbnails and previews render the user's real data, never placeholder lorem.

### Privacy posture
The anonymous checker must actually be ephemeral. No silent retention. The privacy claim on the page must match the code path. This is both an ethical line and a marketing asset.

### Instrumentation
The funnel metrics above are only meetable if Phase 1 ships events. Reuse the existing usage/event plumbing (`/api/v1/usage` or the extension event route pattern) rather than adding a parallel analytics path.

### Accessibility & performance
Free checker first result < 30s including parse. Builder preview updates feel instant (debounced). Landing page is static/edge-rendered. Keyboard-navigable editor controls.

## Open Questions
1. **Scoring transparency.** How much of the scoring rubric do we expose? Leaning toward fully transparent dimension breakdown — it builds trust and teaches the user.
2. **Anonymous abuse ceiling.** What is the right per-IP daily cap for the free checker before it becomes a cost/abuse problem? Tune with real traffic.
3. **Font embedding.** Which curated font set can we legally embed in exported PDFs across all templates? Resolve before Phase 2 ships custom fonts.
4. **Live preview cost.** Debounced server-side LaTeX recompiles could get expensive. Decide between (a) client-side approximate preview + confirm-to-PDF, or (b) cached/throttled server recompile. Spike in Phase 2.
5. **Free-score → builder handoff fidelity.** The parsed resume must land in the builder cleanly enough that the user trusts it. Measure parse fidelity on real resumes before promising "one-click fix."

## What This Document Is Not
- Not a rewrite of the apply/track loop — that is `one-stop-platform-plan.md`.
- Not a new scoring or PDF engine — it reuses both.
- Not a multi-channel play — Telegram/WhatsApp posture is unchanged.
- Not an auto-submit play — never has been.

## Tracking
When work starts on a phase, add a per-deliverable checklist to a live build-status doc (mirroring how `browser-extension-build-status.md` tracks the extension waves). This document is the strategy; the build-status doc is the live tracker.
