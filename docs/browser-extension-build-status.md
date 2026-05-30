# Browser Extension Build Status

## Purpose
Track what has been built, what is currently in progress, and what remains for the browser extension initiative.

This file should be updated as implementation progresses so we always have one current source of truth.

## Current Status
- Current phase: `Phase 8 - Supported Site Depth and Polish`
- Overall state: `In progress`
- Last updated: `2026-03-21`

## Completed

### Planning
- [x] Product plan created
- [x] Phase-by-phase implementation plan created
- [x] Parsing engine architecture created

### Phase 0 Foundation
- [x] Added a living build-status tracker
- [x] Added shared backend extension schemas
- [x] Added backend helper to fetch an extension-friendly profile bundle
- [x] Added backend helper to analyze a job page using existing JD parsing
- [x] Added `GET /api/extension/me`
- [x] Added `POST /api/extension/page/analyze`
- [x] Added initial `extension/` folder scaffold
- [x] Added a minimal Chrome extension shell:
  - [x] manifest
  - [x] background worker
  - [x] content script
  - [x] popup UI
  - [x] side panel UI
- [x] Added popup controls for backend URL configuration and auth/access checks

### Phase 1 Page Detection + Analysis
- [x] Built structured page classifier
- [x] Built DOM reduction pipeline
- [x] Built JD candidate extraction
- [x] Built normalized field detection
- [x] Improved extension shell to publish parsed page context
- [x] Expanded backend analyze contract to accept normalized page payloads
- [x] Added explicit side-panel job analysis and persisted fit summaries into workspaces

### Phase 2 Safe Autofill
- [x] Built fill planner for basic profile fields
- [x] Built profile-to-field resolver for low-risk semantic keys
- [x] Built safe text-like autofill executor
- [x] Built one-run undo support per tab
- [x] Added side panel preview/apply/undo flow
- [x] Expanded safe autofill to selects and high-confidence enumerations
- [x] Added explicit field-by-field confirm flows for review-required items
- [x] Added protected upload handling for resume/CV fields

## In Progress

### Phase 0 Foundation
- [x] Extension auth handshake beyond current web-session assumptions
- [x] Extension-to-backend token/session design
- [ ] Real extension build tooling decision

## Remaining

### Phase 1 Page Detection + Analysis
- [x] Build normalized page model
- [x] Improve analysis payload from browser to backend
- [x] Persist analyzed job context more intentionally

### Phase 2 Safe Autofill
- [x] Build raw field scanner
- [x] Build field normalization engine
- [x] Build confidence scoring for field mapping
- [x] Build fill planner
- [x] Build safe autofill executor
- [x] Build undo support

### Phase 3 AI Answers
- [x] Build question detector
- [x] Build question classification hints
- [x] Build answer suggestion endpoint
- [x] Build answer insert/copy/save UX

### Phase 4 Application Workspace
- [x] Add `ApplicationWorkspace` data model
- [x] Add workspace create/update APIs
- [x] Link browser state to saved workspace state

### Phase 5 Resume Tailoring From Browser
- [x] Add browser-triggered resume generation endpoint
- [x] Show generation progress in extension
- [x] Link generated resumes to the job/application context

### Phase 6 Memory
- [x] Add reusable answers model
- [x] Add recurring application preference memory

### Phase 7 Company Intelligence
- [x] Add company insight model
- [x] Add enrichment pipeline
- [x] Add company trust/fit UI

## Notes
- Extension routes now accept dedicated extension bearer tokens issued through a one-time connect grant approved in the authenticated web app.
- The extension stores a scoped access token in browser extension storage and does not rely on Clerk cookies for day-to-day API calls.
- The initial extension shell is intentionally simple so we can start building the parser and page-analysis loop quickly.

---

## One-stop-platform-plan chapter

A separate set of phase specs ([phase-0-hygiene-spec.md](./phase-0-hygiene-spec.md) → [phase-3-application-tracking-spec.md](./phase-3-application-tracking-spec.md), driven by [one-stop-platform-plan.md](./one-stop-platform-plan.md)) defines the next chapter of extension work beyond Phase 8 above. Status of each:

### Phase 0 — Pre-rewrite hygiene ✅ (in-progress; harness landed, real captures pending)
Goal: clean baseline (in-flight fixes committed + fixture test suite + CI gate) before the Phase 1 TS rewrite begins.

Done:
- ✅ Three in-flight parser fixes committed in `ebdd017` (utils.js body/html guard, schemas.ts elementPath coercion, config.ts embedding-size resolver).
- ✅ `happy-dom` added as a devDep; runs under `bun test`.
- ✅ Regression tests for the three fixes:
  - `extension/__tests__/parsers/utils.test.js` — getElementPath body/html/nested/non-Element cases.
  - `src/lib/extension/schemas.test.ts` — ExtensionReducedRegionSchema elementPath blank-string & whitespace coercion (existing file extended).
  - `src/lib/config.test.ts` — resolveEmbeddingSize across 9 input cases (newly exported from `config.ts`).
- ✅ Pipeline fixture harness at `extension/__tests__/parsers/pipeline.fixture.test.js`:
  - Loads the existing JS parser modules in order under happy-dom.
  - Polyfills `window.SyntaxError` (happy-dom 20.x bug), overrides `getBoundingClientRect`, and proxies `getComputedStyle` defaults so the parser's `isElementVisible` works without a real layout engine.
  - Auto-discovers `<name>.html` + `<name>.expected.json` pairs in `__fixtures__/` and runs tolerant assertions per fixture.
- ✅ Four synthetic placeholder fixtures + tolerant `.expected.json` files (Greenhouse, Lever, LinkedIn Easy Apply, Workday step 1). All pass `bun run test:extension`.
- ✅ `bun run test:extension` script added to `package.json`.
- ✅ `extension/__fixtures__/README.md` documents capture and sanitization rules + the synthetic → real replacement process.
- ✅ `.github/workflows/test.yml` runs `bun test` + `bun run test:extension` on push to `main` and on pull requests.

Operator step (replaces "T0.6–T0.9" from the spec):
- ⬜ Replace the four `*-synthetic.html`/`*-synthetic.expected.json` files with real sanitized captures from production ATS pages. The synthetic fixtures keep the harness green but exercise contrived DOMs — the real value of the test gate lands once production captures replace them. See `extension/__fixtures__/README.md`.

Test status: `bun run test:extension` = 8 passing tests (4 utils + 4 fixture pipeline). `npx tsc --noEmit` clean (excluding the pre-existing `bun:test` type stubs).

### Phase 1 — Extension rewrite + multi-page orchestration ✅ Done
See [phase-1-extension-rewrite-spec.md](./phase-1-extension-rewrite-spec.md). Delivered across three slices: slice 1 landed the build pipeline + React shells; slice 2 ported the parser to TS, wired telemetry, stood up the session state machine, and gated autofill on profile completeness; slice 3 ported the fill executor (so the "Fill" button actually fills), shipped real component depth, the QuestionDrafter, and the backend orchestrate route.

**Slice 1 done:**
- ✅ `extension/package.json` + `tsconfig.json` + `vite.config.ts` + `tailwind.config.ts` + `postcss.config.js` + `manifest.config.ts` — Vite 6 + React 19 + TS + tailwind 3 + crxjs build pipeline.
- ✅ `bun run ext:build` (root alias) → loadable MV3 extension at `extension/dist/`. Build is green.
- ✅ Background service worker in TS:
  - `src/background/messageBus.ts` — typed `Message` union + `on()` + `request<T>()` helpers; single chrome.runtime.onMessage dispatcher.
  - `src/background/tokenStore.ts` — chrome.storage.local wrapper for the extension bearer token, with expiry-aware `getAuthState`.
  - `src/background/tabContext.ts` — per-tab in-memory page model cache; clears on `chrome.tabs.onRemoved`.
  - `src/background/index.ts` — entry; handles PING / AUTH_GET / AUTH_HANDSHAKE / AUTH_CLEAR / PAGE_CONTEXT_UPDATED / GET_PAGE_CONTEXT / REQUEST_REPARSE / OPEN_SIDEPANEL.
- ✅ Content script in TS (`src/content/index.ts`):
  - Drives the existing vanilla JS parsers (`parsers/*.js`) — kept 1:1 during this slice.
  - Debounced re-parse on MutationObserver churn (>5 mutations → 600ms debounce).
  - SPA navigation patches (`pushState`/`replaceState` → `patronus:locationchange` event).
  - Ships `PAGE_CONTEXT_UPDATED` to the background worker.
- ✅ Side panel React app:
  - `AppShell` with header (auth chip) + 5-route tab bar (Apply / Tailor / Answers / Workspaces / Settings).
  - `ApplyRoute` is real: pulls page context via `usePageContext`, renders job header card, fields summary card (high-confidence count + "Fill N ready fields" CTA, currently visual), questions list, re-scan affordance.
  - Other routes are scoped placeholders that ship in slice 2/3.
  - `useExtensionAuth` + `usePageContext` hooks read from the background worker; chrome.storage.onChanged + chrome.tabs.onActivated keep state fresh.
- ✅ Popup React app: connected / expired / disconnected states; "Open side panel" calls `chrome.sidePanel.open` with background-worker fallback.
- ✅ Local design tokens (`src/shared/ui/tokens.css`) match the web app's tailwind theme — same primary, surface, border, muted, success/warning/destructive colors.
- ✅ Root `package.json` scripts: `ext:install`, `ext:dev`, `ext:build`, `ext:type-check`.
- ✅ `extension/README.md` documents the new build + load workflow.
- ✅ `extension/.gitignore` excludes `node_modules/` and `dist/`.

**Slice 2 done:**
- ✅ Parsers ported 1:1 to TypeScript at `extension/src/parsers/`:
  - `utils.ts`, `pageClassifier.ts`, `domReducer.ts`, `jdExtractor.ts`, `fieldDetector.ts`, `index.ts` (exports `parseCurrentPage`). Proper ES module exports — no more IIFE-on-window globals.
  - Phase 0 fixture suite (utils + 4 ATS fixtures) was the safety net during the port and remains green against the TS modules (`bun run test:extension` = 8 pass).
- ✅ `extension/__tests__/parsers/*.test.ts` rewritten to import directly from `src/parsers` (no more `new Function(code).call(globalThis)`). Polyfills `window.SyntaxError` (happy-dom 20.x quirk), overrides `getBoundingClientRect`, and proxies `window.getComputedStyle` to fill in real-browser style defaults so `isElementVisible` reflects browser behavior.
- ✅ Content script (`src/content/index.ts`) now imports `parseCurrentPage` from `@/parsers` and ships a `page.parsed` telemetry event alongside the `PAGE_CONTEXT_UPDATED` relay.
- ✅ Manifest content_scripts collapsed to a single entry: Vite bundles the parser pipeline into the content script (~20 KB gzipped 7 KB).
- ✅ Legacy vanilla files **deleted**: `extension/parsers/`, `extension/popup.html`, `extension/popup.js`, `extension/sidepanel.html`, `extension/sidepanel.js`, `extension/background.js`, `extension/content.js`, `extension/manifest.json`, `extension/fill/`, `extension/lib/`. Recoverable from git history if anything else depended on them.
- ✅ `ExtensionEvent` Prisma model added to `prisma/schema.prisma` (userId, type, payload Json, extVersion, occurredAt + indexes on (userId, occurredAt) and (type, occurredAt)). `prisma generate` ran locally. ⚠️ **Operator step**: `bunx prisma migrate dev --name add-extension-event` (or `migrate deploy` in prod) before this route is exercised against the DB.
- ✅ `POST /api/extension/events` route (`src/app/api/extension/events/route.ts`):
  - Authenticated via the existing `requireExtensionAuth` (bearer token or web session).
  - Rate-limited at 60/min per user (reuses `checkFunnelEventRateLimit` keyed `ext:<userId>`).
  - Accepts a single event or `{events: [...]}` batch (max 20).
  - Returns 200 on all parse failures so telemetry is invisible to end users.
- ✅ Extension telemetry client (`extension/src/shared/lib/telemetry.ts`):
  - In-memory queue, 20-event or 5s flush, capped at 200 events under repeated failure.
  - Flushes via the background worker's `TELEMETRY_BATCH` handler, which reads the bearer token from `tokenStore` and the backend URL from `backendConfig.ts` (new) and POSTs.
  - Never throws. PII rules: no JD text, no field values — only platform, pageKind, structural counts, durations.
- ✅ Events wired:
  - `sidepanel.opened` — `App.tsx` mount.
  - `sidepanel.route` — route change in `App.tsx`.
  - `page.parsed` — content script after parse (platform/pageKind/fieldCount/questionCount/jdConfidenceBand).
- ✅ `ApplicationSession` state machine (`extension/src/background/session.ts`):
  - Per-tab session persisted under `session.<tabId>` in `chrome.storage.local`.
  - First parse of an `application_form` or `multi_step_application` page creates a session.
  - Same-tab navigation to a different URL pathname under the same origin advances `step.index` and appends to `history`.
  - Cross-origin navigation archives the session and starts fresh on the next parse.
  - TTL default 4 hours via `chrome.alarms`; tab close archives via `chrome.tabs.onRemoved`.
  - New messages: `GET_SESSION`, `BIND_WORKSPACE`.
- ✅ Session state machine surfaced in the side panel:
  - `useSession` hook + step counter in `JobHeaderCard`-equivalent section of `ApplyRoute` ("Step N of M · K visited").
- ✅ Profile completeness gate:
  - `GET_PROFILE` background handler hits `/api/extension/me` with the bearer token, returns `{ bundle, completeness: { complete, missing } }`.
  - `useProfile` hook in the side panel.
  - `<ProfileCompletenessBanner>` renders at the top of `ApplyRoute` when incomplete, with a "Complete profile" deep link to `${appBase}/account`.
  - Autofill button in `ApplyRoute` is disabled when profile incomplete; tooltip explains why.
- ✅ Backend URL config moved from hardcoded constants to `extension/src/background/backendConfig.ts` (reads from `chrome.storage.local`, defaults to `http://localhost:3000`).

**Verification:**
- `bun run ext:type-check` clean.
- `bun run test:extension` = **8 pass / 0 fail** (4 utils, 4 fixture pipeline).
- `bun run ext:build` green; sidepanel bundle 43 KB (gzip 13 KB), content script 20 KB (gzip 7 KB).
- Root `npx tsc --noEmit` clean (extension `src`, `dist`, `__tests__`, `node_modules` excluded from the root tsconfig).

**Slice 3 done:**
- ✅ **Fill executor ported to TS** in `extension/src/fill/`:
  - `valueResolver.ts` — maps a semantic field key (`email`, `first_name`, etc.) to the user's profile value plus provenance.
  - `planner.ts` — `buildFillPlan(fields, bundle)` produces `FillAction`s with `auto_fill | review_required | manual_upload | skip`, choice-option resolution for selects/radios/checkboxes, conservative SAFE_FIELD_KEYS allow-list.
  - `executor.ts` — locates DOM nodes from `FieldLocator`, dispatches `input`/`change`/`blur` events the page expects, snapshots prior state for one-run undo, supports text inputs, textareas, selects, radio/checkbox groups, and the protected file-upload focus-only path.
  - Recovered 1:1 from git history (legacy `extension/fill/*.js` in commit `1460b4a`) and re-typed.
- ✅ **Fill bus**: new messages `GET_FILL_PLAN`, `APPLY_FILLS`, `UNDO_FILLS`, `SUGGEST_ANSWER`, `INSERT_ANSWER`:
  - Background worker holds the bearer token + profile bundle cache (60s TTL) and builds the plan server-side-of-side-panel.
  - Content script does the actual DOM mutation via `CONTENT_APPLY_FILLS` / `CONTENT_UNDO_FILLS` / `CONTENT_INSERT_TEXT`.
  - `tabContext` caches the last apply's `undoEntries` per tab so undo is one click.
- ✅ **Apply route is real**:
  - `useFillPlan` hook fetches + applies + undoes.
  - "Fill N ready fields" button now actually fills. Disabled while profile incomplete (existing gate) and while applying.
  - `<FieldRow>` per detected field: confidence chip (high/medium/low), label, value preview, expandable "Why" panel with the reason chain + provenance + per-row "Fill this" / "Skip".
  - `<FillUndoToast>` appears for 30s after each fill batch with one-click undo.
  - Telemetry events `fill.applied` (with count, source bulk/single, semanticKey, band) wired.
- ✅ **QuestionDrafter component**:
  - Per-question expansion with tone select (concise / balanced / high_conviction).
  - "Draft answer" calls existing `/api/extension/questions/suggest` route through the background worker (bearer token attached); response drafts surfaced into an editable textarea.
  - "Insert" pushes the (possibly edited) text into the page's textarea via `CONTENT_INSERT_TEXT`.
  - "Copy" copies to clipboard.
  - Telemetry: `question.drafted`, `question.inserted`.
- ✅ **`POST /api/extension/session/orchestrate` route** (`src/app/api/extension/session/orchestrate/route.ts`):
  - Bearer-auth via existing `requireExtensionAuth`.
  - Accepts the live `ApplicationSession` blob + optional `pageSummary`.
  - Upserts the `ApplicationWorkspace` by `(userId, sourceUrl)` and mirrors `activeSessionId`, `sessionState`, `currentStepIndex`, `totalSteps`, `currentStepLabel`, `stepHistory` onto it.
  - Returns the updated workspace.
- ✅ **Prisma migration**: added the 6 session-mirror columns to `ApplicationWorkspace` (`activeSessionId`, `sessionState Json?`, `currentStepIndex Int?`, `totalSteps Int?`, `currentStepLabel String?`, `stepHistory Json @default("[]")`). ⚠️ **Operator step**: `bunx prisma migrate dev --name workspace-session-mirror` before this route is exercised against the DB.
- ✅ Background worker `BIND_WORKSPACE` handler now upsyncs to the orchestrate route after binding locally, with keepalive: true so it survives a tab close.

**Phase 1 verification:**
- `bun run ext:type-check` ✓
- `bun run test:extension` = **8 pass / 0 fail** (parsers still green against the TS port).
- `bun run ext:build` ✓ — sidepanel 54 KB (gzip 16 KB), content+fill bundle 28 KB (gzip 9 KB), popup 14 KB (gzip 5 KB).
- Root `npx tsc --noEmit` ✓ (excluding `extension/src`, `extension/__tests__`, `extension/dist`).

**Phase 1 operator steps (consolidated):**
1. `bunx prisma migrate dev --name add-extension-event` (slice 2 — `ExtensionEvent` model).
2. `bunx prisma migrate dev --name workspace-session-mirror` (slice 3 — workspace session columns).
3. Build + load: `bun run ext:install && bun run ext:build`; in Chrome → `chrome://extensions` → Load unpacked → select `extension/dist/`.

**Possible follow-ups (out of Phase 1 scope):**
- Auto-generate `extension/src/shared/types/generated.ts` from `src/lib/extension/schemas.ts` so the wire protocol can't drift.
- Workspace-card depth in the Workspaces route — currently a placeholder; Phase 3 (application tracking) owns the inbox + status state machine.
- `Bind workspace` UI on the side panel — for now `BIND_WORKSPACE` is wired but no UI control invokes it. The natural place is the new step counter on the JobHeaderCard.

### Phase 2 — Smarter brain ⬜ Not started
See [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md). Blocked on Phase 1 AND builder Phase 2 (already done — `ResumeTheme` and `JDFitReport`-shape work shipped on the builder side, see `resume-builder-build-status.md`).

### Phase 3 — Application tracking ⬜ Not started
See [phase-3-application-tracking-spec.md](./phase-3-application-tracking-spec.md). Blocked on Phase 2.
