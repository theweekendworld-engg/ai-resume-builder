# One-Stop Job Application Platform Plan

## Status
- Document state: `Proposed, not yet started`
- Owner: `@jai0651`
- Last updated: `2026-05-29`
- Supersedes: nothing (continues from `browser-extension-implementation-plan.md` Phase 7)

## Sibling Plans
This plan owns the **apply + track** half of the product: the extension, multi-page orchestration, autofill, tailoring at the moment of application, and the workspace inbox.

A companion plan, [`resume-builder-experience-plan.md`](./resume-builder-experience-plan.md), owns the **discover + build + score + convert** half: the free no-login ATS checker, the resume builder, the template/theme system, AI assist polish in the editor, and the landing page.

The two plans share one user, one account, and one data model. Where they touch:
- **Funnel handoff.** A visitor scoring a resume in the sibling plan's Phase 1 lands in the builder, then (eventually) installs this plan's extension and applies. Same `UserProfile`, same resume rows, no re-onboarding.
- **`ResumeTheme`.** Introduced in the sibling plan's Phase 2. This plan's Phase 2 tailor flow generates new resumes that **inherit the source resume's `ResumeTheme`**, so styling does not regress when the extension produces a tailored variant.
- **Fix-list pattern.** The sibling plan's free-score produces a prioritized fix list that lives in the editor. This plan's Phase 2 Tailor route adopts the same pattern against the current JD, so the extension and builder speak the same "here's what to fix" language.
- **Discovery boundary.** This plan's Wave 4 owns the public-board *ingestion service* (Greenhouse/Lever JSON endpoints). The sibling plan's Phase 5 owns the *in-app browse UI* over that ingestion. Both must be planned together when those waves activate.

Sequencing rule between the two plans: **builder Phase 1 (free checker) and Phase 2 (`ResumeTheme`) land before this plan's Phase 2 (Smarter Brain)**, so the tailor flow ships theme-aware from day one and never needs a backfill.

## Purpose
The phased plan (`browser-extension-implementation-plan.md`) took the extension from "shell" to "Phase 7: company intelligence". The product has all the right surfaces but the extension still looks and feels like a developer prototype, multi-step ATS flows are not orchestrated, and field resolution is brittle.

This document defines the next chapter: turning the current set of working pieces into a single, polished, one-stop job application platform with a measurable target of **80% reduction in manual effort per application** for a developer who has completed onboarding.

This is a planning doc only. No code lands from this file directly. Each wave below becomes its own implementation PR series.

## What Counts as "One Stop"
A user who has signed up and completed onboarding should be able to apply to any job on any reasonable site without leaving the browser, without retyping profile data, without manually tailoring a resume, and without losing track of where they applied.

Concretely, the loop we want to make trivial:
1. Open a job page on any supported or unsupported site.
2. Side panel shows job summary, fit score, and a tailored-resume CTA within ~5 seconds.
3. One click generates a JD-tailored resume.
4. One click fills every safe field across every step of a multi-page application.
5. Custom questions are drafted in-place with the user's voice, with one-click insert.
6. The application is auto-saved as a workspace with status, JD snapshot, and the resume used.
7. The user can return weeks later and see exactly what they sent and to whom.

If any of those seven steps still feels like work, we have not hit the target.

## Success Metrics
Track these starting from Wave 1 ship and revisit every two weeks:

| Metric | Baseline (now) | Target (post Wave 2) |
| --- | --- | --- |
| Median time from JD page load to first field filled | unmeasured | < 8s |
| Median number of fields filled per application | unmeasured | > 80% of total form fields |
| Average user edits per AI-drafted answer | unmeasured | < 1 substantive edit |
| Multi-step form completion without re-opening side panel | n/a | > 80% on Workday/Greenhouse |
| % of applications tracked in workspace inbox | manual | > 95% |
| Extension daily-active per onboarded user | unmeasured | > 0.6 |

Instrumentation work is part of Wave 1.

## Locked Decisions

These choices are baked into this plan. Re-open them only with reason.

1. **Extension UI rewrite goes full React + Vite + shadcn.** Same design system as the Next.js web app. The 1,716-line vanilla `sidepanel.js` becomes a structured component tree. Build tooling moves into the `extension/` folder.
2. **Our own DOM parser stays the primary path. Firecrawl is a fallback.** Reach for Firecrawl only when the DOM reducer returns low-confidence regions or when JD text density falls below a threshold. Default global cap of 100 Firecrawl calls/day across all users. The cap lives in config and is per-user overridable so we can promote it to a paid-tier feature later.
3. **Telegram stays as-is. WhatsApp is parked.** Effort goes into web + extension. The `Channel` enum already includes `whatsapp` so the data model survives the parking.
4. **No auto-submit.** The product principle stays. The extension fills, drafts, and tracks. The user clicks submit.
5. **One backend, one data model.** Existing `UserProfile`, `UserExperience`, `UserProject`, `JobTarget`, `GenerationSession`, `ApplicationWorkspace`, `ReusableAnswer`, `CompanyInsight` models stay authoritative. New work prefers extending these over adding parallel tables.

## Pre-Wave Hygiene
The following exist as uncommitted edits in the working tree and should land as a small standalone commit before Wave 1 starts:
- `extension/parsers/utils.js`: `getElementPath` now handles `document.body` and `document.documentElement` as roots, so the reducer never emits an empty path.
- `src/lib/extension/schemas.ts`: `ExtensionReducedRegionSchema.elementPath` accepts blank strings and coerces to `body`, matching the parser fix above.
- `src/lib/config.ts`: embedding size now resolves from model name when the env override is missing or invalid.

These are robustness fixes that block clean parser work later if left in flight.

## Architectural Direction

### Extension shape after the rewrite
```text
extension/
  package.json          # vite + react + tailwind + shadcn primitives
  vite.config.ts        # multi-entry build: background, content, sidepanel, popup, options
  manifest.json         # MV3, points at /dist outputs
  tsconfig.json
  src/
    background/         # service worker, message router, token storage
      index.ts
      messageBus.ts
      session.ts
    content/            # injected into pages; reuses parser modules
      index.ts
      bridge.ts
    parsers/            # existing parser pipeline, ported to TS, otherwise unchanged
      pageClassifier.ts
      domReducer.ts
      regionSegmenter.ts
      jobMetadataExtractor.ts
      jdExtractor.ts
      fieldExtractor.ts
      fieldNormalizer.ts
      questionExtractor.ts
      confidenceScorer.ts
      mutationManager.ts
      adapters/
        linkedin.ts
        greenhouse.ts
        lever.ts
        workday.ts
    fill/
      planner.ts
      executor.ts
      undoStore.ts
      valueResolver.ts
    sidepanel/          # React app, primary surface
      main.tsx
      App.tsx
      routes/
        ApplyPanel.tsx
        TailorPanel.tsx
        AnswersPanel.tsx
        WorkspacesPanel.tsx
        SettingsPanel.tsx
      components/
        JobHeaderCard.tsx
        FitScoreCard.tsx
        FieldList.tsx
        FieldRow.tsx
        QuestionDrafter.tsx
        ResumePicker.tsx
        StepProgress.tsx
        ProfileCompletenessGate.tsx
      hooks/
        usePageContext.ts
        useFillPlan.ts
        useWorkspace.ts
        useExtensionAuth.ts
      lib/
        backend.ts      # typed client over /api/extension/*
        messages.ts     # background ↔ sidepanel message types
    popup/
      index.html
      main.tsx
      App.tsx           # connection status, link to web app, open side panel
    options/
      index.html
      main.tsx
      App.tsx           # backend URL, Firecrawl preference, telemetry opt-in
    shared/
      ui/               # local re-export of shadcn primitives configured for extension
      types/            # mirrors zod schemas from src/lib/extension/schemas.ts
```

The `extension/src/shared/types` mirrors are generated, not hand-written. Generation step runs in CI off the zod schemas in `src/lib/extension/schemas.ts` so the extension cannot drift from the backend contract.

### Backend additions
The web app's API surface barely grows. The two real additions:

1. `POST /api/extension/session/orchestrate` — accepts a multi-step session payload (`workspaceId`, `step`, `totalSteps`, parsed page model) and returns the fill plan plus what to remember across steps. This is the single source of truth for "what should the extension do next" on multi-page flows.
2. `POST /api/extension/parse/firecrawl-fallback` — server-side Firecrawl call gated by config-driven daily cap. Input is the URL the extension is currently on plus the in-page extraction confidence score. Output is a backfilled `NormalizedPageModel` with the same shape the in-page parser produces, so the consumer doesn't know or care which path produced it.

Both routes go behind the existing extension bearer token.

### Firecrawl configuration model
New entry in `src/lib/config.ts`:
```ts
firecrawl: {
  apiKey: process.env.FIRECRAWL_API_KEY,
  enabled: process.env.FIRECRAWL_ENABLED !== "false",
  dailyCap: Number(process.env.FIRECRAWL_DAILY_CAP || 100),
  perUserDailyCap: Number(process.env.FIRECRAWL_PER_USER_DAILY_CAP || 5),
  confidenceThreshold: Number(process.env.FIRECRAWL_CONFIDENCE_THRESHOLD || 0.45),
}
```

Per-user overrides live on `UserProfile.preferences.firecrawl` so we can promote the per-user cap to a paid-tier setting later without a schema change. A new `FirecrawlUsageDay` table (one row per `(userId, ymd)`) tracks usage cheaply and supports the cap check in O(1).

The fallback only fires when:
- `firecrawl.enabled` is true, and
- in-page JD extraction confidence is below `confidenceThreshold`, or in-page field count is 0 on a classified `application_form`, and
- both global and per-user daily caps have headroom, and
- the user has not opted out in extension settings.

### Field resolution upgrade (Wave 2)
Today's `fieldNormalizer` is regex + synonym dictionary. That stays as the fast path. Two layers go around it:

1. **Embedding match layer.** Pre-compute embeddings for each canonical semantic key plus a few synonyms. Cache per-user-profile embeddings on the server keyed by profile updatedAt. When the deterministic matcher returns `low` band, the extension ships the field's labelCandidates + helperText + sectionHeading to a server endpoint that runs cosine match against the canonical key set. Result comes back with band promoted if cosine clears a threshold.
2. **Remembered corrections layer.** The `ReusableAnswer` table (already added in Phase 6) gets extended to cover non-question fills too, or a sibling `RememberedField` table is added. When the user accepts, edits, or rejects a fill, that signal writes back to memory keyed by `(labelHash, host, semanticKey)`. Next visit, the resolver checks memory first and skips the matcher entirely if a confident match exists.

Critically, neither layer ships large prompts to the model on every page. Embeddings and memory lookups are constant-cost.

### Multi-page session orchestration
Today, each page parse is treated as standalone. After the rewrite the background worker owns a per-tab `ApplicationSession`:

```ts
type ApplicationSession = {
  tabId: number;
  workspaceId: string;        // links to ApplicationWorkspace
  platform: Platform;
  startedAt: string;
  currentUrl: string;
  step: { index: number; total: number; label?: string };
  history: SessionStepRecord[];
  fillsApplied: FillRecord[];
  pendingQuestions: NormalizedQuestion[];
};
```

Lifecycle:
1. First time a known multi-step platform is detected (Workday, Greenhouse with progress bar, Lever multi-step), the worker creates the session and binds it to a workspace (creating one if needed).
2. On each in-tab navigation, parser runs, the worker calls `orchestrate` with `(session, newPageModel)`, gets back an updated session and a fill plan.
3. Fills applied on each step are recorded on the session so the side panel can show "step 3 of 6: 12 fields filled, 2 questions drafted".
4. On reload or accidental close, the side panel restores from the persisted session in `chrome.storage.local` so the user never loses progress.

This is the single biggest UX win after the visual rewrite.

## Waves

### Wave 0 — Pre-rewrite hygiene (~2 days)
Goal: clean baseline so the rewrite branch starts from a known-good state.

Deliverables:
- Land the three in-flight fixes listed under "Pre-Wave Hygiene" as one focused PR.
- Add Playwright fixture tests covering the four supported platforms with sanitized HTML snapshots. The parser tests are listed as a target in `browser-extension-parsing-engine.md §16` but don't exist yet. Without them, the rewrite is dangerous.
- Stand up a `bun test:extension` script and wire it into CI so the rewrite branch keeps the fixtures green.

Done when: fixtures green on CI, no untracked edits remaining, build status doc bumped to "Wave 0 complete".

### Wave 1 — Extension rewrite + multi-page orchestration (~2 weeks)
Goal: ship the visible quality jump. Side panel looks like the website. Multi-page ATS flows feel like one experience.

Deliverables:
- New `extension/` build setup: Vite, React 19, TS, tailwind, shadcn primitives configured for MV3.
- Background worker rewritten in TS with a typed message bus. Token storage and refresh moved here. `chrome.storage.local` access goes through a single facade.
- Content script in TS, re-imports the existing parser pipeline (port files 1:1, no behavior changes in this wave).
- Side panel rebuilt as a React app with five routes: Apply, Tailor, Answers, Workspaces, Settings.
- New components per the shape above. Field rows show confidence chips, "why" tooltip, and per-field actions consistent with `parsing-engine.md §13`.
- `ProfileCompletenessGate` blocks autofill UI until onboarding fields hit a threshold, with a deep link into the web app's account section.
- `ApplicationSession` model in the background worker. `POST /api/extension/session/orchestrate` server route added with zod schema validation.
- Side panel restores a session on reopen and continues mid-flow.
- Telemetry: emit anonymized events for page-parsed, fill-applied, fill-rejected, answer-inserted, session-resumed. Ship as a thin client over `/api/v1/usage` or a new `/api/extension/events` route.
- Update `browser-extension-build-status.md` continuously.

Done when:
- Vanilla `sidepanel.html`/`sidepanel.js`/`popup.html`/`popup.js`/`background.js`/`content.js` are deleted; their behavior lives in `extension/src/**`.
- Manual smoke against Greenhouse, Lever, LinkedIn Easy Apply, and one Workday flow: end-to-end fill across all steps without re-opening the panel.
- Existing API contracts unchanged except for the additive orchestrate route.

### Wave 2 — Smarter brain (~2 weeks)
Goal: fewer wrong matches, fewer ignored fields, novel sites stop falling off the cliff.

Deliverables:
- Embedding-based field resolution layer. New `src/services/fieldEmbeddingMatcher.ts`. Endpoint: `POST /api/extension/fields/resolve`. Uses the existing OpenAI embedding setup (`config.openai.embedding`). Cached canonical-key embeddings at boot; per-user profile-field embeddings cached against `UserProfile.updatedAt`.
- `RememberedField` table (or extension of `ReusableAnswer`) + write-back hooks on accept/edit/reject in the side panel. Resolver reads memory before running matcher.
- Firecrawl fallback path:
  - `firecrawl` config block in `src/lib/config.ts`.
  - `FirecrawlUsageDay` table and a `src/services/firecrawlGate.ts` cap checker.
  - `POST /api/extension/parse/firecrawl-fallback` server route. Output is a backfilled `NormalizedPageModel`.
  - Side panel surfaces "enhanced via Firecrawl" badge so the user knows when the slower path ran.
- Auto-tailor flow: from the side panel's Tailor route, kick off the existing generation pipeline scoped to the current workspace's JD. When complete, the extension shows a signed download URL + a "copy resume to clipboard" + "open native file picker on the upload field" helper. Chrome MV3 does not allow programmatic attachment to `<input type=file>`, so the UX is download-then-drop with the picker pre-focused.
- Resume picker shows the user's saved tailored resumes for this workspace + the master resume, with the most recent tailoring auto-selected.

Done when:
- A handful of "previously low-confidence" labels in our fixture suite get promoted to high-confidence via embeddings.
- A user correction on one site is recalled on the next visit to the same site.
- Firecrawl fallback triggers correctly under the cap and surfaces in the UI.
- Resume tailoring can be initiated from the side panel and the user can attach the result to the page in two clicks.

### Wave 3 — Application tracking (~1.5 weeks)
Goal: the workspace becomes the user's source of truth for "what did I apply to and where does it stand".

Deliverables:
- Application inbox view on the existing web dashboard at `/dashboard/applications`. Lists all `ApplicationWorkspace` rows with status, last activity, source platform, resume used, and a deep link back to the JD URL.
- Status state machine on `ApplicationWorkspace`: `draft → in_progress → submitted → in_review → interview → offer | rejected | ghosted`. Manual status edit in the web UI plus extension setting status from the side panel after submit.
- "Mark submitted" affordance on the side panel that appears when the parser detects a confirmation page (heuristics: thank-you headings, "your application has been received", URL contains `/thanks` or `/submitted`).
- Workspace inbox bulk actions: archive, mark ghosted (auto-suggest if > 30d since submit and no movement).
- Activity timeline per workspace: which resume was used, which questions had drafts, when each step was filled.

Done when:
- Submitting an application on any supported platform results in the workspace flipping to `submitted` without manual intervention in > 80% of fixture cases.
- Inbox renders the user's last 30 days of applications with no manual data entry.

### Wave 4 — Optional discovery (~1.5 weeks)
Lower confidence wave. Worth its own discovery spike before commit.

**Ownership boundary.** This wave owns the *ingestion service*: the scheduled fetchers, normalization, dedup, storage of discovered jobs, and the API that exposes them to consumers. The sibling plan's Phase 5 ([`resume-builder-experience-plan.md`](./resume-builder-experience-plan.md)) owns the *in-app browse + apply UX* that consumes the API. Neither side should ship without the other; coordinate when activating.

Candidates:
- Greenhouse public board ingestion (their JSON endpoints are publicly documented and ToS-friendly). Powers the sibling plan's "Jobs for you" surface, driven by `UserProfile.preferences` filters.
- Lever public board ingestion (same shape).
- Daily digest email via the existing email channel (`Channel.email` already in schema). Telegram digest is opt-in and reuses existing bot.

Explicitly out of this wave:
- LinkedIn scraping. ToS hostile, account-ban risk on the user.
- Generic crawler over arbitrary careers pages. Diminishing returns vs. focused public-board ingestion.

### Wave 5 — Reactivated chat surfaces (when?)
Park, do not commit dates yet. When the web/extension experience is solid:
- Telegram: paste JD URL → tailored resume PDF returned. Reuse `src/agents/resumeAgent.ts`. Status pings on workspace state transitions.
- WhatsApp: mirror Telegram via Meta Cloud API or Twilio. Same agent backend.

The data model already supports both via the `Channel` enum and `GenerationSession.channel` column. No schema work needed when this unparks.

## Cross-cutting Concerns

### Auth and tokens
No change to the established model. Extension bearer tokens minted via `/extension/connect` (already shipped). The rewritten background worker centralizes token lifecycle: storage, expiry detection, silent refresh prompt that opens the connect page in a new tab when the user has a signed-in web session.

### Observability
A modest event stream from the extension is non-negotiable for hitting the success metrics. Events go to a new `ExtensionEvent` table (or reuse `UsageEvent` if structurally compatible). PII-free by default: hash hostnames, never log field values, never log JD content. Surface in the existing admin route under `/admin`.

### Performance budgets
Carry forward the caps from `browser-extension-parsing-engine.md §12`. Add: side panel first paint < 200ms after open, full page parse + fill plan < 1500ms on a typical Greenhouse page. Track in telemetry.

### Trust and safety
- Side panel always shows what was filled and from which profile facts (already a product principle).
- File uploads never programmatically attached. Confirmation pages never auto-clicked.
- Firecrawl never sends user PII as part of scraping the public page; only the URL travels.
- Memory of corrections is local-first in extension storage with server sync, and a "forget remembered fills on this site" control lives in Settings.

### Testing
Each wave grows the fixture suite. Wave 0 seeds it. Wave 1 adds component tests for the React side panel (Vitest + Testing Library). Wave 2 adds embedding-resolver unit tests with deterministic mock vectors so CI doesn't hit OpenAI.

## Open Questions
These are real, listed so they don't get forgotten:

1. **Resume upload assistance.** Chrome MV3 fundamentally blocks programmatic file attachment. The "download then drop, picker pre-focused" pattern is the most we can offer in-browser. Worth checking whether a native messaging host or a desktop helper makes sense later, but out of scope for Waves 0-3.
2. **Workday's iframed scenarios.** Some Workday flows host the application in an iframe with a separate origin. Confirm whether our content-script `<all_urls>` permission covers this in practice on fixture pages before Wave 1's "supports Workday" claim.
3. **Profile completeness threshold.** What exactly gates autofill? Tentative: must have `fullName`, `email`, `phone`, `location`, and at least one experience entry. Tune after dogfooding.
4. **Memory key for remembered corrections.** `(hostname, labelHash)` is the obvious shape, but ATS hosts like `boards.greenhouse.io` serve hundreds of companies. May need `(parentCompanyHost, labelHash)` for hosted boards. Decide in Wave 2 with real data.
5. **Firecrawl pricing posture.** The plan assumes Firecrawl as a free-tier-with-cap utility now and a paid-tier feature later. If pricing turns out worse than expected per page, the configurable cap saves us; if it's cheaper, we lift the cap. No code changes needed either way thanks to the config-driven design.

## Risks
- The rewrite is the largest single change since the extension started. Mitigation: Wave 0 fixture suite, port parser modules 1:1 without behavior changes in Wave 1, keep the rewrite branch behind a feature-flagged dual-build for the first week if practical.
- Embedding-based matching could regress accuracy on the 80% of fields where the deterministic matcher is already correct. Mitigation: embeddings only run when the deterministic matcher returned `low`; never override `high` band matches.
- Multi-page session orchestration depends on the parser correctly detecting "same flow, different step". Get this wrong and the user sees their previous fills appear to vanish. Mitigation: orchestrator hashes (`hostname`, `workspaceId`, `step.index`) and refuses to attribute fills to the wrong step.
- Auto-status detection on confirmation pages is heuristic and will misfire occasionally. Mitigation: never make the status flip irreversible; show a toast with undo.

## What This Document Is Not
- Not a marketing brief. It assumes the product principles in `browser-extension-product-plan.md` are already settled.
- Not a parser rewrite. The parser pipeline in `browser-extension-parsing-engine.md` stays the authoritative design; this plan ports it into TypeScript without behavior changes.
- Not a multi-channel expansion. Telegram stays, WhatsApp is parked, focus is web + extension.
- Not an auto-submit play. Never has been.

## Tracking
When work starts on each wave, update `browser-extension-build-status.md` with the wave name and per-deliverable checkboxes. This document is the strategy; the build-status doc is the live tracker.
