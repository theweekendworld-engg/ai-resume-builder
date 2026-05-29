# Phase 1 — Extension Rewrite + Multi-Page Orchestration (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed, blocked on Phase 0 completion |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [one-stop-platform-plan.md](./one-stop-platform-plan.md) |
| Predecessor | [phase-0-hygiene-spec.md](./phase-0-hygiene-spec.md) |
| Successor | [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) |
| Target duration | ~10 working days |

## 1. Problem Statement
The extension works. `sidepanel.js` is 1,716 hand-rolled DOM-manipulation lines. `background.js` is 918. `popup.js` is 192. There is no build pipeline, no type checking, no component model, and no design parity with the Next.js web app that uses shadcn + tailwind. A new user installing the extension experiences a visible quality cliff between the polished web app and the unstyled side panel.

Separately, Workday and Greenhouse applications are typically 3-6 sequential pages. Today the extension treats each page parse as independent. A user who fills page 1, navigates to page 2, and then reloads loses progress visibility in the side panel. There is no notion of "we are 3 steps into one application" — only "here is what the current page looks like".

Phase 1 fixes both: the extension becomes a typed React app that looks like the web product, and a per-tab `ApplicationSession` model in the background worker stitches multi-step flows together as one experience.

## 2. Goals
1. Visible quality jump. Side panel matches the web app's design system (shadcn + tailwind, same typography, same colors, same component primitives).
2. Single-source design system: extension components reuse the same `@/components/ui/*` primitives as the web app where feasible.
3. Type safety end-to-end: TypeScript across background, content, side panel, popup, and options. Zod schemas in `src/lib/extension/schemas.ts` are the source of truth and generate extension-side TS types via a build step.
4. Multi-page application sessions: the background worker maintains a per-tab session that survives navigations, reloads, and tab close-reopen within a TTL. The side panel always shows progress in the context of the full application, not just the current page.
5. Profile completeness gate: users cannot trigger autofill until their profile is complete enough to fill the canonical field set well.
6. Telemetry baseline: anonymized events on parse, fill, answer-insert, session-resume so we have data to measure the success metrics from the parent plan.

## 3. Non-Goals
- No parser behavior changes beyond what the TS port mechanically requires. The parser pipeline is ported 1:1 from JS to TS, then frozen until Phase 2.
- No new adapters. The four existing platforms stay; deeper coverage is later.
- No embedding-based field matching. That is Phase 2.
- No Firecrawl. That is Phase 2.
- No auto-tailor resume from the side panel. That is Phase 2.
- No application status auto-detection. That is Phase 3.
- No new ATS platform support. Workday, Greenhouse, Lever, LinkedIn stay the supported set.

## 4. Success Criteria
- [ ] `extension/popup.html`, `extension/popup.js`, `extension/sidepanel.html`, `extension/sidepanel.js`, `extension/background.js`, `extension/content.js` are deleted from the repo. Their behavior lives in compiled output under `extension/dist/`.
- [ ] `bun run --filter ./extension build` (or equivalent) produces a loadable unpacked extension at `extension/dist/` with manifest v3.
- [ ] Side panel renders five top-level routes: Apply, Tailor (placeholder, wires in Phase 2), Answers, Workspaces, Settings.
- [ ] Manual end-to-end run on Greenhouse, Lever, LinkedIn Easy Apply, and one Workday flow: parses page, shows fit summary, autofills high-confidence fields, drafts at least one answer, persists workspace.
- [ ] On a 6-step Workday flow: opening the side panel on step 3 after a reload shows "step 3 of 6", with previously-applied fills counted in the progress card.
- [ ] Profile completeness gate visible to a fresh user. Cannot trigger autofill before threshold met. Deep link to `/account` works.
- [ ] Phase 0 fixture tests still green.
- [ ] New TS unit tests cover: `messageBus`, `valueResolver`, `fillPlanner`, `useFillPlan` hook, `useWorkspace` hook, `useExtensionAuth` hook.
- [ ] Telemetry events visible in admin route within 24h of dogfood usage.

## 5. User-Facing Experience

### 5.1 First-launch flow (fresh extension install)
1. User clicks the extension icon.
2. Popup shows: "Connect to Patronus" with a button that opens `/extension/connect` in a new tab. If already signed in on the web app, the connect page mints a token and ships it back via `chrome.runtime.sendMessage` to the background worker, then auto-closes after 2s.
3. Popup updates to "Connected as <user email>" with a "Open side panel" button and a "Settings" link.

### 5.2 On a job page (single-page application form, e.g. Greenhouse)
1. User opens the side panel.
2. Within ~1s the parser runs. The side panel shows:
   - **Job header card**: company, role, location, fit score badge (computed from existing analyze endpoint).
   - **Profile completeness chip**. If incomplete, autofill is disabled with a deep link.
   - **Fields card**: count of fields detected, breakdown by confidence band, "Fill all high confidence (12)" primary action, expandable list with confidence chip + value + "why" tooltip per field.
   - **Questions card**: list of detected long-form questions with "Draft answer" buttons.
   - **Workspace card**: shows whether this URL is already a saved workspace. Save action otherwise.
3. User clicks "Fill all high confidence". Fields fill on the page with a brief flash animation per field. Side panel updates per-field status to "Filled". An "Undo" affordance appears for 30s.
4. User clicks "Draft answer" on a question. Side panel shows a generated draft inline with tone toggle and "Insert" / "Copy" / "Save to memory" actions.

### 5.3 On a multi-page application (Workday, ~6 steps)
1. First page (My Information): same as §5.2 plus a "step 1 of 6" indicator in the workspace card.
2. User fills, clicks next on the page. The page navigates.
3. Background worker detects same-tab navigation under the same host with a workspace already bound to this tab.
4. Side panel refreshes. Workspace card now shows "step 2 of 6 — 8 fields filled, 0 questions answered" with a horizontal step progress bar.
5. User can click any previous step in the bar to see what was filled. Going forward, the workspace activity timeline records each step.
6. If the user closes the tab and reopens the same URL within a TTL (default 4h), the side panel restores the session.

### 5.4 Profile completeness gate
A small full-width banner above the fields card when profile is incomplete:
```
[!] Finish your profile to enable autofill
    Missing: phone, work authorization, 1 work experience
    [Complete profile →]
```
The autofill button on the fields card is disabled with a tooltip. Field rows can still be inspected, but "Fill" actions are greyed.

Threshold definition (configurable in code, not user-facing):
```ts
function isProfileComplete(profile: ExtensionProfile): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!profile.fullName) missing.push('full name');
  if (!profile.email) missing.push('email');
  if (!profile.phone) missing.push('phone');
  if (!profile.location) missing.push('location');
  if ((profile.experiences ?? []).length === 0) missing.push('at least one work experience');
  return { complete: missing.length === 0, missing };
}
```

## 6. Technical Design

### 6.1 Top-level extension directory after rewrite
```text
extension/
  package.json
  tsconfig.json
  vite.config.ts
  postcss.config.js
  tailwind.config.ts
  manifest.json
  __fixtures__/         # from Phase 0
  __tests__/            # from Phase 0 + new TS tests
  src/
    background/
      index.ts
      messageBus.ts
      session.ts        # ApplicationSession state machine
      tokenStore.ts
      tabContext.ts
    content/
      index.ts
      bridge.ts         # postMessage between content & background
    parsers/            # 1:1 TS port of current JS parsers
      index.ts
      pageClassifier.ts
      domReducer.ts
      regionSegmenter.ts
      jdExtractor.ts
      fieldExtractor.ts
      fieldNormalizer.ts
      questionExtractor.ts
      confidenceScorer.ts
      mutationManager.ts
      utils.ts
      adapters/
        index.ts
        linkedin.ts
        greenhouse.ts
        lever.ts
        workday.ts
    fill/
      planner.ts
      executor.ts
      undoStore.ts
      valueResolver.ts
    sidepanel/
      index.html
      main.tsx
      App.tsx
      routes/
        ApplyRoute.tsx
        TailorRoute.tsx
        AnswersRoute.tsx
        WorkspacesRoute.tsx
        SettingsRoute.tsx
      components/
        JobHeaderCard.tsx
        FitScoreBadge.tsx
        ProfileCompletenessBanner.tsx
        FieldsCard.tsx
        FieldRow.tsx
        QuestionsCard.tsx
        QuestionDrafter.tsx
        WorkspaceCard.tsx
        StepProgress.tsx
        ConfidenceChip.tsx
        AppShell.tsx
      hooks/
        usePageContext.ts
        useFillPlan.ts
        useWorkspace.ts
        useSession.ts
        useExtensionAuth.ts
        useProfile.ts
      lib/
        backend.ts
        messages.ts
        telemetry.ts
    popup/
      index.html
      main.tsx
      App.tsx
    options/
      index.html
      main.tsx
      App.tsx
    shared/
      ui/               # local re-exports of shadcn primitives
      types/            # generated from zod schemas in src/lib/extension/schemas.ts
      constants.ts
```

### 6.2 Build pipeline (Vite + crxjs)
Use `@crxjs/vite-plugin` for MV3 bundling. It handles multi-entry compilation (background service worker, content scripts, side panel, popup, options) and HMR for the side panel during development.

`extension/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import manifest from './manifest.json' assert { type: 'json' };

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

`extension/package.json`:
```json
{
  "name": "patronus-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "type-check": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "zod": "^4.3.6",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.555.0",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.25",
    "@types/chrome": "^0.0.270",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5.0.0",
    "autoprefixer": "^10",
    "postcss": "^8",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vite": "^7"
  }
}
```

Root `package.json` gets a workspace-style passthrough:
```json
{
  "scripts": {
    "ext:dev": "cd extension && bun run dev",
    "ext:build": "cd extension && bun run build",
    "ext:type-check": "cd extension && bun run type-check"
  }
}
```

### 6.3 Manifest v3 changes
```json
{
  "manifest_version": 3,
  "name": "Patronus Job Copilot",
  "description": "Developer job application copilot for analysis, autofill, and resume tailoring.",
  "version": "0.1.0",
  "permissions": ["storage", "tabs", "sidePanel", "scripting", "alarms"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "action": {
    "default_title": "Patronus Job Copilot",
    "default_popup": "src/popup/index.html"
  },
  "options_page": "src/options/index.html",
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ]
}
```

Key changes vs today: `alarms` permission for session TTL expiry, `options_page` added, `all_frames: true` on the content script for Workday iframes, single TS entry point for the content script.

### 6.4 Shared types generation
`src/lib/extension/schemas.ts` already defines all the zod schemas. The extension imports types via a generated TS file:

`scripts/generate-extension-types.ts` (new):
- Imports every exported zod schema from `src/lib/extension/schemas.ts`.
- Walks them, infers TS types via `z.infer`, and writes them to `extension/src/shared/types/generated.ts`.
- Uses `zod-to-typescript` or a small hand-rolled walker.

Wired into:
- root `package.json`: `"ext:gen-types": "bun run scripts/generate-extension-types.ts"`
- ran in `predev` and `prebuild` hooks for the extension
- ran in CI before `tsc --noEmit`

This guarantees the extension's TS view of the wire protocol is always the same as the backend's runtime view.

### 6.5 Background worker design

#### 6.5.1 Message bus
`src/background/messageBus.ts` defines a typed RPC layer over `chrome.runtime.sendMessage`. Messages have shape:
```ts
type Message =
  | { type: 'PARSE_PAGE'; tabId: number }
  | { type: 'GET_FILL_PLAN'; tabId: number }
  | { type: 'APPLY_FILLS'; tabId: number; fieldIds: string[] }
  | { type: 'UNDO_LAST_FILL'; tabId: number }
  | { type: 'GET_PAGE_CONTEXT'; tabId: number }
  | { type: 'GET_SESSION'; tabId: number }
  | { type: 'BIND_WORKSPACE'; tabId: number; workspaceId?: string }
  | { type: 'REQUEST_ANSWER'; tabId: number; questionId: string; tone?: string }
  | { type: 'INSERT_ANSWER'; tabId: number; questionId: string; text: string }
  | { type: 'AUTH_HANDSHAKE'; token: string; userId: string }
  | { type: 'AUTH_CLEAR' }
  | { type: 'TELEMETRY_EVENT'; event: TelemetryEvent };

type Response<T> = { ok: true; data: T } | { ok: false; error: string };
```

The bus exports:
- `request<TReq extends Message, TRes>(msg: TReq): Promise<Response<TRes>>` — from side panel/popup.
- `on(type, handler)` — in the worker.

Handlers are co-located in `src/background/handlers/<message-type>.ts`.

#### 6.5.2 Token store
`src/background/tokenStore.ts`:
- Stores the extension bearer token in `chrome.storage.local` under key `auth.token`.
- Stores userId, expiry, backend URL.
- Exposes `getToken()`, `setToken(token, expiresAt, userId)`, `clear()`, `isExpired()`.
- On `isExpired()` true, opens `/extension/connect` in a new tab (via `chrome.tabs.create`) when next API call attempted.

#### 6.5.3 Tab context
`src/background/tabContext.ts` maintains per-tab in-memory state:
```ts
type TabContext = {
  tabId: number;
  url: string;
  origin: string;
  lastParseAt: number | null;
  lastPageModel: NormalizedPageModel | null;
  session: ApplicationSession | null;
  fillsAppliedThisStep: FillRecord[];
};
```
Persists session-related fields to `chrome.storage.local` keyed by tabId. Listens to `chrome.tabs.onUpdated`, `chrome.tabs.onRemoved`, `chrome.webNavigation.onCommitted` to track navigation.

### 6.6 ApplicationSession state machine

```ts
type ApplicationSession = {
  id: string;                          // uuid generated in worker
  workspaceId: string;                 // links to ApplicationWorkspace on backend
  tabId: number;
  platform: Platform;
  startedAt: string;
  lastActiveAt: string;
  ttlExpiresAt: string;                // default startedAt + 4h, refreshed on activity
  origin: string;                      // host the session is scoped to
  currentUrl: string;
  step: { index: number; total: number; label?: string };
  history: SessionStepRecord[];
  pendingQuestions: NormalizedQuestion[];
};

type SessionStepRecord = {
  stepIndex: number;
  url: string;
  visitedAt: string;
  fieldsFilled: number;
  fieldsRejected: number;
  questionsAnswered: number;
  pageKind: PageKind;
};
```

#### 6.6.1 Lifecycle states
```text
[NONE]
  |
  | first parse of a multi-step platform on this tab
  v
[BOUND] -- step navigation within same origin --> [BOUND] (step.index++)
  |                                                    |
  | tab closed                                         | TTL expires
  v                                                    v
[ARCHIVED]                                          [EXPIRED]
```

#### 6.6.2 Step detection rules
A step transition fires when **all** of:
- Same tabId.
- Same origin.
- Workspace already bound to this tab.
- A new parse arrives with `pageKind` that is consistent with continuing an application (`application_form`, `multi_step_application`) — not `job_detail` or `unsupported`.
- URL pathname differs from the previously recorded step's URL pathname, OR `pageKind` is `multi_step_application` and the platform's stepper indicates a change.

When fired:
- `session.step.index += 1`.
- New `SessionStepRecord` appended to `session.history`.
- `session.lastActiveAt = now`.
- `session.ttlExpiresAt = now + ttl`.
- `chrome.alarms` refreshes the TTL alarm.

Step total is initialized from platform detection (Workday's stepper exposes total, Greenhouse single page is 1, Lever varies). If unknown, total stays `null` and the UI shows "step N" without the total.

#### 6.6.3 Orchestrate API
The worker does not embed all step-transition logic itself. After each parse, it POSTs to `/api/extension/session/orchestrate` and receives an updated session view plus a fill plan. This keeps complex decisions server-side where they are testable and easier to evolve.

Request:
```json
{
  "sessionId": "uuid-or-null",
  "tabId": 12,
  "workspaceId": "wks_abc123",
  "platform": "workday",
  "currentUrl": "https://example.wd5.myworkdayjobs.com/.../step-2",
  "previousUrl": "https://example.wd5.myworkdayjobs.com/.../step-1",
  "pageModel": <NormalizedPageModel>,
  "fillsAppliedSinceLastPing": [
    { "fieldLocator": {...}, "semanticKey": "email", "value": "..." }
  ]
}
```

Response:
```json
{
  "session": <ApplicationSession>,
  "fillPlan": <FillPlan>,
  "instructions": {
    "shouldShowResumeAction": true,
    "shouldRequestAnswerForQuestionIds": ["q_1", "q_3"],
    "stepLabel": "My Information"
  }
}
```

#### 6.6.4 Persistence
- Background worker writes session to `chrome.storage.local` under `session.<tabId>` after every transition.
- On worker startup (service worker may restart anytime in MV3), session is re-hydrated from storage.
- On `chrome.tabs.onRemoved`, session is moved from `session.<tabId>` to `archive.<sessionId>` with retention of 24h then evicted.
- On `chrome.alarms` TTL fire, session is also moved to archive.

### 6.7 Side panel React app

#### 6.7.1 App shell
`AppShell` renders a fixed header (logo + auth chip + settings cog) and a tab bar for the five routes. Routes are URL-less; navigation is local state via a simple custom router. Routes wrap in a `Suspense` boundary with a skeleton fallback.

#### 6.7.2 Routes
- **ApplyRoute** — primary; shows `JobHeaderCard`, `ProfileCompletenessBanner` (if needed), `FieldsCard`, `QuestionsCard`, `WorkspaceCard`.
- **TailorRoute** — placeholder UI with "Coming in Phase 2" copy + button that opens the web app's resume editor for the current workspace.
- **AnswersRoute** — shows all reusable answers for the user (from `ReusableAnswer` table) with search, edit, delete.
- **WorkspacesRoute** — shows recent workspaces for the user, status, last activity, deep link to the JD URL.
- **SettingsRoute** — backend URL, sign out, telemetry opt-out, "forget remembered fills on this site".

#### 6.7.3 Data hooks
- `usePageContext` — subscribes to `PAGE_CONTEXT_UPDATED` events from the worker, returns latest parse for the active tab.
- `useFillPlan` — derived from `usePageContext`, calls `GET_FILL_PLAN`, memoized by `pageModel.hash`.
- `useWorkspace` — fetches the workspace bound to the current tab, or `null`.
- `useSession` — fetches the `ApplicationSession` for the current tab.
- `useExtensionAuth` — subscribes to auth state changes; returns `{ status: 'connected'|'disconnected'|'expired', userId, email }`.
- `useProfile` — fetches `ExtensionProfile` from `/api/extension/me`, cached per user with `updatedAt` invalidation.

#### 6.7.4 Component specs

**JobHeaderCard**
- Top: company name + location chip.
- Middle: role title (h2).
- Bottom: fit score badge + "Analyze again" link.
- States: loading (skeleton), parsed (full data), error (compact error with retry).
- Fit score from the existing analyze API; presented as `<FitScoreBadge score={0-100} band="good"|"okay"|"stretch" />`.

**FieldsCard**
- Header row: "Fields detected: 14 (8 ready)" + "Fill 8 fields" primary button.
- List: rows by section heading (use `sectionHeadingCandidates[0]`).
- Each row: `<FieldRow>` with label, value preview, confidence chip, expand for details (locator, why, alternatives, manual override).
- Bulk fill button is disabled when profile incomplete.
- After fill: row state shows "Filled · Undo" for 30s, then transitions to "Filled".

**FieldRow**
- Confidence chip colors: green (high), amber (medium), red-orange (low).
- Hover tooltip on chip shows the reason chain from `ConfidenceExplanation.reasons`.
- "Override" inline lets the user supply a custom value that takes effect for this fill only and writes to `RememberedField` in Phase 2; for Phase 1 it just edits the current plan in-memory.

**QuestionsCard**
- Lists detected questions with type-hint badge.
- Each row has "Draft" button.
- Drafting opens `QuestionDrafter` inline expansion: tone dropdown, generated text, edit, "Insert" / "Copy" / "Save to memory".

**WorkspaceCard**
- States:
  - Not saved: "Save this job as a workspace" button. Creates `ApplicationWorkspace` via API.
  - Saved + single-page: status pill, "Open in dashboard" link.
  - Saved + multi-page: includes `StepProgress` bar across steps with per-step fill/answer counts on hover.

**StepProgress**
- Horizontal pill bar, one pill per step, current step highlighted.
- Hover any pill shows tooltip with that step's `SessionStepRecord` summary.
- Steps without recorded data show as outlined; visited steps filled.

**ProfileCompletenessBanner**
- Only rendered when profile is incomplete.
- Lists missing fields succinctly.
- Primary CTA opens `/account` in a new tab.

**ConfidenceChip**
- Small `<Badge>` (shadcn primitive re-exported in `shared/ui`).
- Variants: `high` → green, `medium` → amber, `low` → red-orange.
- Tooltip on hover shows score and reasons.

### 6.8 Popup
Single-purpose. States:
- **Disconnected** — "Connect to Patronus" CTA that opens `/extension/connect` in a new tab.
- **Connected** — user email, "Open side panel" button (`chrome.sidePanel.open`), "Settings" link to options page.
- **Expired** — same as disconnected with extra "Your session expired" line.

Pop is intentionally minimal because the side panel is the primary surface.

### 6.9 Options page
Settings:
- Backend URL override (default reads from `config.app.url`).
- "Open side panel automatically on job pages" toggle.
- Telemetry opt-out.
- Sign out (clears tokenStore and session storage).
- "Forget remembered fills on this site" with site picker (Phase 2 feature; UI scaffolded in Phase 1).

## 7. API Contracts

### 7.1 New: `POST /api/extension/session/orchestrate`
**Request body** (`zod ExtensionOrchestrateRequestSchema` in `src/lib/extension/schemas.ts`):
```ts
{
  sessionId: string | null;
  tabId: number;
  workspaceId: string | null;
  platform: Platform;
  currentUrl: string;
  previousUrl: string | null;
  pageModel: NormalizedPageModel;
  fillsAppliedSinceLastPing: Array<{
    fieldLocator: FieldLocator;
    semanticKey: string | null;
    value: string;
    appliedAt: string;
  }>;
}
```

**Response body** (`ExtensionOrchestrateResponseSchema`):
```ts
{
  session: ApplicationSession;
  fillPlan: FillPlan;
  instructions: {
    stepLabel: string | null;
    shouldShowResumeAction: boolean;            // false in Phase 1, true in Phase 2
    shouldRequestAnswerForQuestionIds: string[];
  };
}
```

**Auth**: existing extension bearer token via `Authorization: Bearer <token>` header.

**Rate limit**: 30 RPM per user (the worker debounces parses to ~1-2 per page load).

**Server behavior**:
- If `workspaceId` is null, create an `ApplicationWorkspace` for `(userId, currentUrl host + role)` and return its id.
- If `sessionId` is null, create a new session row in a new `ApplicationSession` table (or persist on workspace if we choose not to add a table — see §8).
- Detect step transition vs same step: compare `currentUrl` pathname against the last recorded URL on the session. If different → new step.
- Compute `FillPlan` server-side from the current profile + `pageModel.fields`. The server is authoritative on confidence, not the extension.
- Identify which questions need a fresh answer suggestion (those without prior drafts on this workspace).

**Errors**:
- 400 if `pageModel` does not satisfy `NormalizedPageModelSchema`.
- 401 if token missing/invalid.
- 409 if workspace conflict (multiple sessions for same workspace from different tabs) — return existing session id.

### 7.2 New: `POST /api/extension/events`
Telemetry intake. See §10.

### 7.3 Updated routes
- `GET /api/extension/me` — adds `profileCompleteness: { complete: boolean; missing: string[] }` to the response so the extension does not recompute.
- `POST /api/extension/page/analyze` — unchanged contract; the orchestrate route subsumes it on multi-step flows.

## 8. Data Model Changes

### 8.1 Option A: persist sessions on `ApplicationWorkspace`
The simplest move: add JSON fields to `ApplicationWorkspace`:
```prisma
model ApplicationWorkspace {
  // ...existing fields
  activeSessionId   String?
  sessionState      Json?   // last known session blob from worker
  stepHistory       Json    @default("[]")
  totalSteps        Int?
  currentStepIndex  Int?
  currentStepLabel  String?
}
```

### 8.2 Option B: separate `ApplicationSession` table
```prisma
model ApplicationSession {
  id            String   @id @default(cuid())
  userId        String
  workspaceId   String
  tabId         Int
  platform      String
  startedAt     DateTime @default(now())
  lastActiveAt  DateTime @default(now())
  ttlExpiresAt  DateTime
  origin        String
  currentUrl    String
  stepIndex     Int      @default(1)
  stepTotal     Int?
  stepLabel     String?
  history       Json     @default("[]")
  archived      Boolean  @default(false)

  @@index([userId, workspaceId])
  @@index([userId, lastActiveAt])
}
```

**Recommendation: Option A.** A session is functionally the live state of a workspace. Adding a parallel table doubles the query surface without buying anything we can't model with JSON columns on the workspace. If, later, we need to query across sessions for analytics, extract then.

### 8.3 Migration
Single Prisma migration adds the four nullable columns on `ApplicationWorkspace`. No backfill needed; null state means "no live session".

## 9. Telemetry

### 9.1 Event schema
```ts
type TelemetryEvent =
  | { type: 'extension.installed'; version: string }
  | { type: 'extension.connected'; userId: string }
  | { type: 'page.parsed'; platform: Platform; pageKind: PageKind; fieldCount: number; questionCount: number; jdConfidence: number; parseTimeMs: number; hostnameHash: string }
  | { type: 'fill.plan.computed'; safeCount: number; reviewCount: number; planTimeMs: number }
  | { type: 'fill.applied'; semanticKey: string; band: 'high'|'medium'|'low'; outcome: 'success'|'failed' }
  | { type: 'fill.undone'; count: number }
  | { type: 'fill.overridden'; semanticKey: string }
  | { type: 'fill.rejected'; semanticKey: string; band: 'high'|'medium'|'low' }
  | { type: 'question.drafted'; typeHint: string; tone: string; durationMs: number }
  | { type: 'question.inserted'; typeHint: string; edited: boolean }
  | { type: 'session.bound'; platform: Platform; totalSteps: number | null }
  | { type: 'session.step.advanced'; stepIndex: number }
  | { type: 'session.resumed'; ageMinutes: number }
  | { type: 'session.expired' }
  | { type: 'workspace.saved'; platform: Platform }
  | { type: 'sidepanel.opened' }
  | { type: 'sidepanel.route'; route: 'apply'|'tailor'|'answers'|'workspaces'|'settings' };
```

### 9.2 PII rules
- Never include field values.
- Never include JD or question text.
- `hostnameHash` is SHA-256 of `location.hostname`. We never store raw hostnames.
- `userId` is included server-side from the auth token, never from the event payload.

### 9.3 Storage
New table:
```prisma
model ExtensionEvent {
  id          String   @id @default(cuid())
  userId      String
  type        String
  payload     Json
  occurredAt  DateTime @default(now())

  @@index([userId, occurredAt])
  @@index([type, occurredAt])
}
```

### 9.4 Admin surface
Reuse `/admin` route. Add a small panel "Extension activity" with last 24h event counts by type and a daily-active extension users number. No drill-down into per-user data in Phase 1.

## 10. UI Spec — Visual

### 10.1 Design tokens
Inherit the web app's tailwind theme. Extension's `tailwind.config.ts` extends from the same shared theme file. Same primary, accent, muted, destructive colors.

### 10.2 Typography
- Heading: Inter 600, 14px.
- Body: Inter 400, 13px.
- Mono (for selectors in advanced panels): JetBrains Mono 12px.

### 10.3 Side panel widths
Chrome side panel is ~360-380px wide. All component layouts assume 360px content width as the lower bound.

### 10.4 Empty states
Each card has an explicit empty state:
- JobHeaderCard empty: "We did not detect a job page here. Open a job listing and try again."
- FieldsCard empty: "No application form detected on this page."
- QuestionsCard empty: "No long-form questions detected."

### 10.5 Loading states
- First parse: skeleton placeholders for ~700ms; if parse exceeds 2s, show "Still scanning..." progress.
- Fill apply: per-row spinner replaces the apply icon.
- Workspace save: button shows spinner; success flips to "Saved".

### 10.6 Error states
- Auth expired: full-panel banner "Your session expired. Reconnect →" linking to connect page.
- Network error during parse upload: in-panel toast with retry; parse result still visible from local cache.

## 11. Implementation Plan

### 11.1 Task list
| # | Task | Est. | Depends on |
| --- | --- | --- | --- |
| T1.1 | Initialize Vite + React + TS + tailwind + crxjs in `extension/` | 4h | Phase 0 done |
| T1.2 | Port `tailwind.config.ts` and shadcn primitives into `extension/src/shared/ui` | 3h | T1.1 |
| T1.3 | Write `scripts/generate-extension-types.ts` and wire `predev`/`prebuild` | 3h | T1.1 |
| T1.4 | Port parser modules to TS 1:1 (no behavior changes); ensure Phase 0 fixtures still pass | 1.5d | T1.3 |
| T1.5 | Implement `messageBus` and `tokenStore` | 4h | T1.1 |
| T1.6 | Implement `tabContext` with persistence to `chrome.storage.local` | 4h | T1.5 |
| T1.7 | Implement `ApplicationSession` state machine in worker | 1d | T1.6 |
| T1.8 | Add `POST /api/extension/session/orchestrate` (backend) with zod schemas | 1d | — |
| T1.9 | Prisma migration: add session fields to `ApplicationWorkspace` | 1h | T1.8 |
| T1.10 | Implement `ExtensionEvent` model + `POST /api/extension/events` route | 4h | — |
| T1.11 | Implement `AppShell`, `AppRouter`, route shells | 4h | T1.2 |
| T1.12 | Implement `JobHeaderCard`, `FitScoreBadge` | 4h | T1.11 |
| T1.13 | Implement `FieldsCard`, `FieldRow`, `ConfidenceChip` | 1d | T1.11, T1.4 |
| T1.14 | Implement `QuestionsCard`, `QuestionDrafter` | 1d | T1.11 |
| T1.15 | Implement `WorkspaceCard`, `StepProgress` | 1d | T1.7, T1.11 |
| T1.16 | Implement `ProfileCompletenessBanner` and gate logic | 4h | T1.11 |
| T1.17 | Implement hooks: `usePageContext`, `useFillPlan`, `useWorkspace`, `useSession`, `useExtensionAuth`, `useProfile` | 1d | T1.5, T1.6 |
| T1.18 | Telemetry client (`src/sidepanel/lib/telemetry.ts`) | 4h | T1.10 |
| T1.19 | Implement popup (connected/disconnected/expired states) | 4h | T1.5 |
| T1.20 | Implement options page (settings) | 4h | T1.5 |
| T1.21 | Manual QA pass: Greenhouse, Lever, LinkedIn, Workday flows | 1d | T1.13-T1.16 |
| T1.22 | Delete legacy vanilla files; verify nothing imports them | 1h | T1.21 |
| T1.23 | Update `browser-extension-build-status.md` | 30m | T1.22 |

Total estimated effort: ~10 working days.

### 11.2 Sequencing recommendation
- Day 1: T1.1 → T1.2 → T1.3
- Day 2: T1.4 (parser port)
- Day 3: T1.5 → T1.6
- Day 4: T1.7 (worker) + start T1.8 (backend)
- Day 5: Finish T1.8, T1.9, T1.10
- Day 6: T1.11 → T1.17 (UI scaffolding, big chunk)
- Day 7-8: T1.13 → T1.16 (component depth)
- Day 9: T1.18 → T1.20
- Day 10: T1.21 → T1.23

### 11.3 Risk-mitigating order
The parser port (T1.4) runs against the Phase 0 fixture suite. Do not advance past T1.4 until every fixture stays green with the TS port. Everything downstream depends on the parser being trustworthy.

## 12. Testing Strategy

### 12.1 Test layers
1. **Phase 0 fixture tests** stay as-is and run against the TS-ported parsers via a thin loader that imports the TS modules and runs them.
2. **Hook tests** with React Testing Library: `usePageContext`, `useFillPlan`, `useExtensionAuth`. Mocks the message bus.
3. **Component tests** for the key cards: `FieldsCard`, `WorkspaceCard`, `QuestionDrafter`. Snapshot tests for empty/loading/error states.
4. **State machine tests** for `ApplicationSession` step transitions. Pure functions; trivial to test.
5. **Backend route tests** for the new orchestrate route. Existing schema test conventions in `src/lib/extension/*.test.ts` apply.

### 12.2 Manual smoke checklist (T1.21)
For each platform:
- [ ] Parse completes within 2s on first load.
- [ ] Fit score badge renders.
- [ ] Fields card lists detected fields with reasonable confidence distribution.
- [ ] "Fill all high confidence" applies fills without console errors.
- [ ] Per-field "Why" tooltip shows the reasons chain.
- [ ] Undo works within 30s window.
- [ ] At least one question detected; draft generates within 4s.
- [ ] Insert action writes the draft into the page field.
- [ ] Workspace is created on save and visible at `/dashboard`.
For Workday additionally:
- [ ] Step counter shows "step 1 of N" on first page.
- [ ] Navigating to step 2 updates the counter.
- [ ] Closing and reopening the tab restores the session within TTL.

## 13. Rollout

### 13.1 Internal dogfood
- @jai0651 runs the development build for one week before merge.
- Optional: share the unpacked extension folder with one or two trusted reviewers for parallel dogfood.

### 13.2 Migration for existing users
Existing extension installs (from `version: 0.0.1`) keep their stored auth token (same `chrome.storage.local` key) when upgrading. No user-visible migration needed. The first parse after upgrade emits a `extension.installed` event with the new version string.

### 13.3 Versioning
Bump manifest version to `0.1.0`. Tag the merge commit `extension/v0.1.0`.

## 14. Open Questions
1. **Service worker lifecycle.** Chrome MV3 stops the service worker after ~30s of inactivity. Session state persisted to `chrome.storage.local` survives this, but in-flight HTTP requests do not. The worker design must treat any operation as restart-safe. Confirm with a manual test before T1.7 lands.
2. **Side panel state preservation.** When the user switches tabs, the side panel reloads if `default_path` is global. We want per-tab state. Need to verify Chrome's API behavior — `chrome.sidePanel.setOptions({ path, tabId })` allows per-tab paths, and hooks should re-fetch on visibility change.
3. **shadcn primitives in MV3.** No DOM features should hit issues, but verify Radix primitives' portal behavior renders inside the side panel iframe correctly.
4. **Workday iframe origin.** Some Workday flows put the form in a same-origin iframe; others use a different subdomain. The content script needs `all_frames: true` (already set in manifest). Confirm fills target the right document during T1.21.
5. **Should orchestrate also return the workspace, or assume a separate fetch?** Returning it bundled saves one round trip; separating keeps the route focused. Recommend: return workspace as part of the response for now; revisit if the payload grows.

## 15. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Parser port introduces a silent regression | Medium | High | Phase 0 fixtures are the gate. T1.4 is not done until all fixtures pass against the TS port. |
| Service worker churn loses session state | Medium | High | All session state writes go to `chrome.storage.local` and the worker re-hydrates on cold start. |
| Side panel re-render thrashes on `MutationObserver` storms | Medium | Medium | Debounce parser invocations in the content script (200-500ms) per the parser engine doc. |
| `crxjs/vite-plugin` proves unreliable for MV3 | Low | High | Fallback: `webextension-toolbox` or a hand-rolled multi-entry esbuild config. Decide by end of T1.1. |
| Type generation script becomes fragile | Low | Low | If `zod-to-typescript` proves brittle, generate types by re-exporting `z.infer` results from the schema module via a small TS file. |
| Workday multi-step detection misfires | Medium | Medium | Step transition rules are conservative (§6.6.2). Manual test on a real Workday flow during T1.21. |
| Telemetry leaks PII | Low | High | PII rules in §9.2 are codified in event schema; reviewer checklist enforces. |
| Scope creep | High | Medium | Hard cap: features explicitly listed in non-goals do not enter this phase even if "small". |

## 16. References
- [one-stop-platform-plan.md](./one-stop-platform-plan.md)
- [phase-0-hygiene-spec.md](./phase-0-hygiene-spec.md)
- [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md)
- [browser-extension-parsing-engine.md](./browser-extension-parsing-engine.md)
- [browser-extension-product-plan.md](./browser-extension-product-plan.md)
- Chrome MV3 service workers: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- crxjs vite plugin: https://crxjs.dev/vite-plugin
- shadcn/ui: https://ui.shadcn.com
