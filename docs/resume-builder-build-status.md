# Resume Builder & Growth — Build Status

## Status
- Live tracker for `resume-builder-experience-plan.md`. The plan is the strategy; this doc records what has actually shipped.
- Last updated: `2026-05-29`
- Owner: `@jai0651`
- Branch: `browser-extension`

## Legend
- ✅ Done (implemented + typechecks clean)
- 🟡 Partial / follow-up noted
- ⬜ Not started

## Summary
| Phase | Title | State |
| --- | --- | --- |
| 1 | Free no-login ATS checker | ✅ Done |
| 2 | Template gallery + ResumeTheme design system | ✅ Done |
| 3 | Builder craft & AI assist polish | ✅ Done |
| 4 | Outcome-led landing & positioning refresh | ✅ Done |
| — | Cross-phase funnel integration (score → build → editor) | ✅ Done |
| 5 | In-app job discovery | ⬜ Not started (gated on spike) |

Verification: `npx tsc --noEmit` is clean across all new/changed files. The only remaining type errors are 3 **pre-existing** `Cannot find module 'bun:test'` stubs in `src/lib/extension/*.test.ts`, unrelated to this work. A production `bun run build` was run as a final integration check.

---

## Phase 1 — Free no-login ATS checker ✅
Anonymous visitor drops a PDF, gets a scored report with specific fixes, converts into the builder.

Done:
- ✅ Public route `src/app/(marketing)/score/page.tsx` (no auth).
- ✅ `src/components/marketing/score/Dropzone.tsx` — PDF-only, ≤2MB, client-validated.
- ✅ `src/components/marketing/score/AtsCheckerClient.tsx` — orchestration + optional JD textarea.
- ✅ `src/components/marketing/score/ScoreReport.tsx` — score ring by band, dimension bars, priority-sorted fix cards with before→after, privacy line, CTAs.
- ✅ `src/app/api/score/route.ts` — anonymous POST, `runtime='nodejs'`, IP rate-limited, in-memory PDF text extraction, never persists the file.
- ✅ `src/lib/anonScore.ts` + `src/lib/anonScoreSchema.ts` — auth-free scoring via the raw OpenAI client, JSON-mode, zod-validated; `deriveBand()` server-side.
- ✅ `src/lib/rateLimit.ts` — added `checkAnonScoreRateLimit` (sliding window 10/1h), additive only.
- ✅ Handoff: `ScoreReport` stashes `sessionStorage['patronus:pendingScore']` = `{ extractedText, fixes, score, createdAt }` before routing to `/sign-up?redirect_url=/build`.

API contract — `POST /api/score`:
- Request: `multipart/form-data` { `file` (PDF, ≤2MB, required), `jobDescription` (optional, ≤6000 chars) }.
- 200: `{ success: true, report, extractedText }`; errors 400/422/429/500 with `{ success:false, error }`.

Follow-ups (🟡):
- Instrumentation events (`score_started`, `score_completed`, `score_cta_clicked`, `score_to_signup`) from the plan are **not yet wired**.
- DOCX not supported (PDF-only enforced client + server). Plan mentioned DOCX as a future option.

## Phase 2 — Template gallery + ResumeTheme design system ✅
The builder behaves like a design tool: choose a look, restyle instantly.

Done:
- ✅ `ResumeTheme` model in `src/types/resume.ts`: `{ templateId, accentColor, fontFamily ('sans'|'serif'|'mono'), density ('compact'|'normal'|'relaxed') }` + `DEFAULT_RESUME_THEME`. `LatexTemplateType` widened to include `'minimal'` (4 templates total).
- ✅ `src/templates/latex.ts` parameterized by theme — hardcoded `mainblue` replaced with `theme.accentColor` (hex→LaTeX RGB), font-family → LaTeX font packages, density → margins/spacing. Added the `minimal` generator. All four templates stay single-column, selectable-text, ATS-safe. `generateLatexFromResume(data, themeArg)` accepts a string id (legacy callers) **or** a full `ResumeTheme` — backward compatible.
- ✅ `src/store/resumeStore.ts` — `theme` state + `setTheme`/`updateTheme`/`setTemplateId`; persisted via `partialize`; `merge` backfills theme for existing users. Legacy `selectedTemplate` kept mirrored.
- ✅ `src/store/editorStore.ts` — added `'design'` panel id.
- ✅ `src/components/editor/tools/TemplateGalleryPanel.tsx` — 4-card visual picker + shared `ResumeHtmlPreview` rendered from the user's real data.
- ✅ `src/components/editor/tools/DesignPanel.tsx` — gallery + accent swatches/custom hex + font toggle + density toggle + existing `SectionOrderEditor`.
- ✅ `src/components/editor/PreviewPanel.tsx` — rebuilt: instant client-side HTML "Live" preview vs. opt-in "Final PDF" (LaTeX compile). Theme→LaTeX regeneration debounced 600ms; UI never blocks on compiles.
- ✅ Wired into `EditorSidebar.tsx` / `EditorLayout.tsx`.
- ✅ Caller fix: `src/components/onboarding/OnboardingWizard.tsx` types widened to `LatexTemplateType` (no behavior change).

Follow-ups (🟡):
- `src/lib/userPreferences.ts` `defaultTemplate` and `src/actions/generate.ts` template enums still the 3-value set — `minimal` is selectable in-editor but not yet as a saved default.
- HTML live preview is representative, not pixel-identical to LaTeX output (by design; Final PDF is source of truth).
- Font packages (lato/charter/beramono/fontawesome5) assume the full-TeXLive compile backend.

## Phase 3 — Builder craft & AI assist polish ✅
Proactive, trustworthy assist; closes the loop from the Phase 1 fix list to a fixed resume.

Done:
- ✅ `src/actions/parseResumeText.ts` — authenticated text → `ResumeData` (mirrors `latexToResume`; tracked OpenAI + zod). No async queue.
- ✅ `src/lib/pendingScore.ts` — typed, zod-validated read/clear of the handoff. `src/lib/textDiff.ts` (word-level LCS diff). `src/lib/resumeLength.ts` (page estimator).
- ✅ `src/components/editor/DiffPreview.tsx` — red-strike/green-add diff renderer.
- ✅ `src/components/editor/InlineBulletSuggestions.tsx` — per-bullet "Strengthen" with inline diff, embedded in `ExperienceEditor.tsx` + `ProjectsEditor.tsx`.
- ✅ `src/components/editor/tools/FixChecklistPanel.tsx` — fix checklist tool panel (`'fix-checklist'` editor panel id), per-item checkbox + "Apply to summary" with diff.
- ✅ `src/components/copilot/CopilotQuickActions.tsx` — context-aware quick actions (tighten summary / add missing keywords / make it fit one page), each diff-previewed; embedded in `ResumeCopilot.tsx`.
- ✅ Length intelligence: live `~N pages` badge in the `PreviewPanel` toolbar.
- ✅ `AIRewriteModal.tsx` shows a before/after diff above the editable suggestion.
- ✅ `resumeStore.ts` — `fixChecklist` state + setters, persisted.

Follow-ups (🟡):
- Handoff preload guard: parsed text only auto-loads into an **empty** resume (avoids clobbering a pipeline-generated baseline). With the funnel integration below, the import path now loads the resume explicitly, so the editor only seeds the checklist.
- Length is heuristic (tuned for ats-simple/normal); authoritative length is the compiled PDF.

## Phase 4 — Outcome-led landing & positioning refresh ✅
Outcome-led page, two free entry points, apply+track moat as the reveal.

Done:
- ✅ `Hero.tsx` — H1 "Land more interviews, apply in minutes"; eyebrow "Build · Apply · Track"; two above-fold CTAs: "Check my resume — free" → `/score`, "Build a resume" → `/sign-up?redirect_url=/build`. Renders `SocialProof`.
- ✅ `SocialProof.tsx` (new) — three honest, defensible signals (ATS-tested templates / Private by design / Built end-to-end). No fabricated numbers or fake testimonials.
- ✅ `Features.tsx` — benefits reframe + new build→apply→track differentiator section (autofill on Workday/Greenhouse/Lever/LinkedIn + application tracking; reinforces no-auto-submit).
- ✅ `HowItWorks.tsx` — 4-step North-Star funnel.
- ✅ `Pricing.tsx` — outcome-aligned copy, primary CTA → `/score`. No invented tiers.
- ✅ `Navbar.tsx` / `Footer.tsx` — "Check resume" + build links.

Follow-ups (🟡):
- Social proof is intentionally generic until we have real, citable numbers to stand behind.

## Cross-phase funnel integration ✅
Connected the seam between the free checker and the builder so "Fix in one click" actually loads the user's resume.

Done:
- ✅ `src/components/build/BuildWizard.tsx` — on mount reads `patronus:pendingScore`. When present, shows a "Pick up where you left off" card: **Load my resume & start fixing** → `parseResumeText(extractedText)` → `saveResumeToCloud(parsed, undefined, 'import', undefined, score)` → routes to `/editor/{id}`. Does **not** clear sessionStorage — the editor (`EditorLayout`) then seeds the fix checklist from the same handoff and clears it (so no duplicate LLM parse). A secondary link dismisses the card to build a fresh resume from a JD.
- Full flow verified by typecheck: `/score` → stash + sign-up → `/build` import card → `/editor` with checklist waiting.

## Phase 5 — In-app job discovery ⬜
Not started. Gated on a discovery spike per the plan; overlaps `one-stop-platform-plan.md` Wave 4.

---

## Outstanding follow-ups (consolidated)
1. Wire Phase 1 funnel instrumentation events (acquisition metrics depend on these).
2. Let `minimal` be a saved default (widen `userPreferences.defaultTemplate` + `actions/generate.ts` enums).
3. Optional: DOCX support in the free checker.
4. Replace generic social proof with real, citable figures once available.
5. Pre-existing `bun:test` type stubs in `src/lib/extension/*.test.ts` (unrelated; tracked elsewhere).

## Files changed this round
New: `src/app/(marketing)/score/*`, `src/components/marketing/score/*`, `src/components/marketing/SocialProof.tsx`, `src/app/api/score/route.ts`, `src/lib/anonScore.ts`, `src/lib/anonScoreSchema.ts`, `src/lib/pendingScore.ts`, `src/lib/textDiff.ts`, `src/lib/resumeLength.ts`, `src/actions/parseResumeText.ts`, `src/components/editor/DiffPreview.tsx`, `src/components/editor/InlineBulletSuggestions.tsx`, `src/components/editor/tools/DesignPanel.tsx`, `src/components/editor/tools/TemplateGalleryPanel.tsx`, `src/components/editor/tools/FixChecklistPanel.tsx`, `src/components/copilot/CopilotQuickActions.tsx`.

Modified: `src/types/resume.ts`, `src/templates/latex.ts`, `src/store/resumeStore.ts`, `src/store/editorStore.ts`, `src/lib/rateLimit.ts`, `src/components/editor/{PreviewPanel,EditorSidebar,EditorLayout,AIRewriteModal,ExperienceEditor,ProjectsEditor}.tsx`, `src/components/copilot/ResumeCopilot.tsx`, `src/components/onboarding/OnboardingWizard.tsx`, `src/components/build/BuildWizard.tsx`, `src/components/marketing/{Hero,Features,HowItWorks,Pricing,Navbar,Footer}.tsx`.
