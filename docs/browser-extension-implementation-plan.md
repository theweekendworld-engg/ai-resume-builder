# Browser Extension Implementation Plan

## Goal
Implement the browser extension in phases that are:
- fast to ship
- easy to reason about
- low-risk for user trust
- aligned with the existing Next.js + Prisma + Clerk backend

This plan is intentionally biased toward simplicity. The goal is not to build a massive browser automation platform on day one. The goal is to ship a reliable developer job application copilot with a clean architecture that can grow safely.

## Implementation Strategy

### Keep These Constraints
1. One backend
Use the current Next.js app and Prisma database. Do not create a separate backend service.

2. One source of truth
All user profile, experience, education, projects, job targets, and generation sessions should continue to live in the current data model.

3. Browser extension as a thin client
The extension should primarily:
- detect pages
- extract form context
- render UI
- fill fields
- call backend APIs

AI, persistence, ranking, and company analysis should stay server-side.

4. Delay hard problems until proven necessary
Do not begin with:
- multi-agent browsing workflows
- automatic application submission
- generalized full-site crawling
- too many supported platforms
- too many new database tables

## Recommended Repo Shape
Do not convert the whole repo into a complicated monorepo immediately.

### Keep Current App As-Is
Current app remains:
- Next.js frontend
- API/backend
- resume editor
- dashboard
- generation pipeline

### Add One New Top-Level Folder
Recommended:
- `extension/`

This keeps the extension isolated from the Next.js build without forcing a major repo migration.

Suggested structure:
```text
extension/
  manifest.json
  package.json
  src/
    background/
    content/
    sidepanel/
    popup/
    adapters/
    lib/
    types/
```

### Shared Contracts
Instead of introducing a full shared package too early, start with a small folder inside the main app:
- `src/lib/extension/`

Place shared backend-facing schemas here:
- normalized page schema
- normalized field schema
- question schema
- API input/output zod schemas

If sharing becomes heavy later, extract into a shared package then.

## Technical Decisions

### 1. Auth
Do not use the current public API key flow for the extension.

Why:
- browser extensions are hostile environments for static secrets
- public API key auth is fine for controlled clients, not for distributed extension binaries

Recommended approach:
- use Clerk on the main web app for login
- create a server-issued short-lived extension token
- store token only in extension local storage
- refresh token through a secure web-auth handshake

Implementation shape:
1. User clicks `Sign in` in extension.
2. Extension opens web app auth page in a new tab.
3. Logged-in web app calls a dedicated endpoint to mint an extension session token.
4. Token is passed back to extension through:
   - redirect URL with one-time code, or
   - `chrome.runtime.sendMessage` via an extension bridge page
5. Background worker stores token and attaches `Authorization: Bearer ...` to extension API calls.

Minimal version:
- use opaque session tokens stored in database
- avoid rolling custom JWT logic on day one

### 2. API Design
Do not expose many tiny endpoints at first.

Start with a small extension API surface:
- `POST /api/extension/session/create`
- `GET /api/extension/me`
- `POST /api/extension/page/analyze`
- `POST /api/extension/questions/suggest`
- `POST /api/extension/workspaces/upsert`
- `POST /api/extension/fill-events`
- `POST /api/extension/resume/generate`

This is enough for the MVP.

### 3. Persistence
Avoid creating all proposed tables at once.

Phase-in persistence:
- Phase 1: reuse `JobTarget` plus minimal extension session table
- Phase 2: add `ApplicationWorkspace`
- Phase 3: add `ApplicationQuestion`
- Phase 4: add `ReusableAnswer`
- Phase 5: add `CompanyInsight`

### 4. Site Support
Do not start adapter-first for everything.

Use a layered strategy:
- generic DOM parser first
- site-specific adapters only for exceptions and better UX

This avoids building four complete site implementations before learning what actually varies.

### 5. AI Execution
Keep all AI generation server-side.

Use existing assets:
- JD parsing
- ATS scoring
- generation sessions
- copilot answer generation patterns

Add only thin wrappers for extension-specific prompting.

## Phase-by-Phase Build Plan

## Phase 0: Technical Foundation

### Goal
Set up extension scaffolding and backend contracts without changing core app behavior.

### Deliverables
- `extension/` app scaffold
- Chrome Manifest V3 setup
- background worker
- side panel shell
- popup shell
- content script shell
- shared normalized schemas in `src/lib/extension/`
- extension auth handshake design finalized

### Backend Work
- add `src/lib/extension/schemas.ts`
- add `src/app/api/extension/*` route group
- add extension session table if using opaque tokens

Suggested minimal table:
`ExtensionSession`
- id
- userId
- tokenHash
- expiresAt
- createdAt
- lastUsedAt

### Frontend Extension Work
- side panel loads on any page
- popup shows signed-in or signed-out state
- background worker handles token storage and refresh
- content script can send page metadata to background

### Acceptance Criteria
- extension installs locally
- user can sign in
- side panel opens
- background can call a protected backend endpoint

### Why This Phase Matters
If auth and communication are messy, every later feature becomes fragile. This phase should stay narrow and boring.

## Phase 1: Page Detection and Job Analysis MVP

### Goal
Detect job pages reliably and show a useful analysis panel before touching autofill.

### Why Start Here
This gives value early and teaches us page structure differences without risking bad form fills.

### Deliverables
- normalized page extraction pipeline
- platform detection
- `Analyze this job` action
- fit summary in side panel
- save job context to backend

### Backend Work
Create `POST /api/extension/page/analyze`

Input:
- source URL
- platform hint
- visible page title
- extracted company
- extracted role
- extracted location
- job description text
- detected question labels

Output:
- normalized job snapshot
- fit score
- strengths
- gaps
- recommended next action
- recommended project highlights

Implementation notes:
- reuse existing JD parsing
- reuse ATS estimate logic
- reuse project matching concepts from current generation pipeline
- store a slim job record using `JobTarget` first

### Frontend Extension Work
Create:
- `pageDetector.ts`
- `jobExtractor.ts`
- `platformResolver.ts`

Normalized model:
```ts
type NormalizedJobPage = {
  url: string;
  platform: 'linkedin' | 'greenhouse' | 'lever' | 'workday' | 'generic';
  companyName: string;
  roleTitle: string;
  location?: string;
  jobDescription: string;
  questions: Array<{ label: string; typeHint?: string }>;
  pageType: 'job_detail' | 'application_form' | 'unknown';
};
```

### Adapter Strategy
Implement in this order:
1. generic extractor
2. LinkedIn detector
3. Greenhouse detector
4. Lever detector
5. Workday detector

### Acceptance Criteria
- extension detects supported pages with high precision
- side panel shows analysis in under a few seconds
- user can save job from browser to backend

## Phase 2: Safe Autofill for High-Confidence Fields

### Goal
Remove repetitive basic form filling without risking wrong data in ambiguous fields.

### Scope
Only support high-confidence fields first:
- full name
- email
- phone
- LinkedIn
- GitHub
- portfolio
- location

Maybe support after review:
- work authorization
- sponsorship
- years of experience

Defer:
- salary expectations
- start date
- complex multi-step employment history sections
- file uploads automation

### Backend Work
Create `GET /api/extension/me`

Response should be a profile bundle:
- profile
- experiences summary
- education summary
- project summary
- preferences relevant to applications

Important:
add missing preference fields in profile/preferences for common application questions:
- work authorization
- sponsorship needs
- willing to relocate
- preferred work modes
- salary expectation range

Do not add all preference fields at once unless the UI is ready to collect them.

### Frontend Extension Work
Create:
- `fieldScanner.ts`
- `fieldNormalizer.ts`
- `fillEngine.ts`
- `fillPlanner.ts`

Normalized field shape:
```ts
type NormalizedField = {
  key: string;
  label: string;
  inputType: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'radio' | 'checkbox';
  required: boolean;
  confidence: 'high' | 'medium' | 'low';
  selector: string;
  platformMeta?: Record<string, unknown>;
};
```

### Fill Algorithm
1. Scan all candidate inputs.
2. Normalize each field by label + placeholder + nearby text.
3. Match against known profile keys.
4. Create a fill plan:
   - safe fills
   - review-required fills
   - unhandled fields
5. Execute safe fills only.
6. Present review queue in side panel.

### UX Rules
- highlight fields before fill
- allow one-click undo
- show provenance for each value
- never fill hidden fields
- never submit forms

### Acceptance Criteria
- high-confidence fields fill correctly on supported pages
- users can undo fills
- no autofill happens without explicit user action

## Phase 3: AI Answers for Custom Questions

### Goal
Handle the most painful part of job applications: open-text responses.

### Scope
Support:
- motivational questions
- role-fit questions
- project/experience proof questions
- "tell us about yourself"
- cover-letter style prompts

Defer:
- highly legal/compliance questions unless mapped to strict structured answers

### Backend Work
Create `POST /api/extension/questions/suggest`

Input:
- workspace or job context
- question text
- nearby helper text
- role/company context
- selected tone

Output:
- 1-3 answer drafts
- confidence
- source facts used
- warnings

Implementation notes:
- reuse current copilot prompting patterns
- add a dedicated grounding layer that picks source facts before generation
- require answer provenance in output schema

Recommended internal pipeline:
1. classify question
2. retrieve supporting facts
3. draft answer
4. add provenance and warnings

### Minimal New Table
Add `ApplicationQuestion` only in this phase, not earlier.

Store:
- question text
- type
- draft answer
- final answer if user inserts/edits
- source facts
- confidence

### Frontend Extension Work
Create:
- `questionDetector.ts`
- `questionClassifier.ts`
- answers tab UI
- insert/copy/save actions

### UX Rules
- show short answer first
- allow regenerate with tone options
- clearly label inferred content
- never auto-insert long answers

### Acceptance Criteria
- user can get a grounded answer suggestion for detected text questions
- answer generation is fast enough to feel interactive
- saved answers are tied to the job/application context

## Phase 4: Application Workspace and Tracking

### Goal
Turn each job page interaction into a recoverable workspace instead of a one-off session.

### Why This Matters
Without a workspace model, extension usage becomes stateless and hard to continue across browser and web app.

### Backend Work
Add `ApplicationWorkspace`

Suggested minimal fields for first version:
- id
- userId
- sourcePlatform
- sourceUrl
- companyName
- roleTitle
- location
- jobDescription
- status
- fitScore
- summary
- linkedJobTargetId
- selectedResumeId
- createdAt
- updatedAt

Status enum suggestion:
- discovered
- analyzed
- in_progress
- applied
- archived

Create endpoints:
- `POST /api/extension/workspaces/upsert`
- `GET /api/extension/workspaces/:id`

### Web App Work
Add a dashboard section later for:
- recent applications
- saved questions
- generated answers
- resume used

Keep this simple at first. A plain list is enough.

### Extension Work
- side panel persists current workspace state
- browser tab can resume prior workspace if same URL/company/role matches

### Acceptance Criteria
- user can return to a job and resume context
- browser and dashboard share the same job/application record

## Phase 5: Resume Tailoring From Browser

### Goal
Let the user trigger tailored resume generation from the job page with visible progress.

### Backend Work
Create `POST /api/extension/resume/generate`

This should wrap existing generation logic instead of duplicating it.

Flow:
1. accept workspace ID or job description
2. create `GenerationSession`
3. return session ID
4. extension listens to generation status via polling or SSE
5. attach result resume/PDF back to workspace

Do not invent a second generation pipeline.

### Extension Work
- add Resume tab
- show current selected resume if any
- add `Generate tailored resume`
- show progress steps already used in web app
- show actions:
  - open in editor
  - download PDF
  - use for upload

### Upload Support
For MVP:
- do not automate file chooser interactions across all sites
- instead provide:
  - quick download
  - open local file path instructions where needed

Later:
- explore controlled upload assistance for supported sites only

### Acceptance Criteria
- user can trigger and monitor resume generation from extension
- generated result is linked to job/application workspace

## Phase 6: Reusable Answers and Preference Memory

### Goal
Make the product faster with repeated use.

### Backend Work
Add `ReusableAnswer`

Use it only after we have real question traffic.

How to populate:
- when a user accepts or edits an answer
- fingerprint question
- store canonical form
- suggest reuse for similar questions later

Also expand stored user preferences for recurring application fields:
- sponsorship
- relocation
- desired compensation band
- notice period
- work mode preference

### Extension Work
- `Use previous answer`
- `Save as reusable`
- `Always use this for similar questions` only after trust is earned

### Acceptance Criteria
- repeated application questions become significantly faster to answer

## Phase 7: Company Intelligence

### Goal
Add company-fit and trust insights after the core application workflow is already strong.

### Why This Is Later
This is valuable, but it is also the easiest area to overcomplicate and the easiest to get wrong with stale or low-confidence data.

### Backend Work
Add `CompanyInsight`

Pipeline:
1. normalize company identity
2. fetch enrichment from providers or curated sources
3. summarize server-side
4. cache results
5. attach confidence and freshness metadata

Keep raw data and summary separate.

### Data Model
Store:
- normalized company name
- website
- employee count
- funding total
- revenue estimate text
- review summary
- engineering summary
- school/alumni signal summary
- confidence
- updatedAt

### UX Rules
- show "estimated" when estimated
- show freshness date
- never imply certainty where data is sparse
- separate facts from interpretation

### Acceptance Criteria
- company panel adds decision-making value without looking misleading or overly authoritative

## Phase 8: Supported Site Depth and Polish

### Goal
Go deeper on the platforms that matter most after real usage data arrives.

### Work Areas
- better field detection for LinkedIn, Greenhouse, Lever, Workday
- multi-step application navigation support
- improved education/employment history autofill
- resume upload helper for selected sites
- better textarea placement and inline actions

### Important Rule
Use telemetry and user feedback to decide which site gets deeper investment. Do not assume all four need the same level of custom work.

## Data Model Rollout Plan

### Phase 0
- `ExtensionSession`

### Phase 1
- reuse `JobTarget`

### Phase 3
- `ApplicationQuestion`

### Phase 4
- `ApplicationWorkspace`

### Phase 6
- `ReusableAnswer`

### Phase 7
- `CompanyInsight`

This sequencing keeps schema churn low in the beginning.

## API Rollout Plan

### First Wave
- `POST /api/extension/session/create`
- `GET /api/extension/me`
- `POST /api/extension/page/analyze`

### Second Wave
- `POST /api/extension/questions/suggest`
- `POST /api/extension/workspaces/upsert`

### Third Wave
- `POST /api/extension/resume/generate`
- `GET /api/extension/generate/:sessionId/status`

### Fourth Wave
- company insight endpoints
- reusable answer endpoints

## Keep It Simple: Architecture Rules

### Rule 1
No separate extension backend service.

### Rule 2
No custom agent orchestration framework for MVP.

### Rule 3
No provider abstraction explosion for company data too early.

### Rule 4
No giant field ontology in version one. Start with the 15-20 most common application fields.

### Rule 5
No "fill every field automatically" promise. Promise safe assistance, not magic.

## Testing Strategy

### Backend
- unit test schema validation
- unit test question classification
- unit test fill-plan generation
- integration test extension API endpoints

### Extension
- manual fixture pages for each supported platform
- saved HTML snapshots for detector tests
- end-to-end local tests for:
  - auth
  - page detection
  - safe fill
  - answer suggestion insertion

### Most Important Test Cases
- wrong field match prevention
- ambiguous question classification
- stale session handling
- multi-step page navigation state persistence

## Observability Plan

Add event logging for:
- page detected
- page analysis requested
- field scan complete
- fill accepted
- fill undone
- answer generated
- answer inserted
- resume generation started
- resume generation completed

Use this to learn:
- which fields fail often
- which platforms need custom adapters
- which answers get heavily edited

## Recommended Milestone Sequence

### Milestone 1
Foundation:
- extension shell
- auth
- side panel
- protected API call

### Milestone 2
Analysis:
- page detection
- job extraction
- fit summary
- save job

### Milestone 3
Autofill:
- high-confidence fields
- fill planner
- undo support

### Milestone 4
Answers:
- question detection
- grounded answer drafts
- save final answers

### Milestone 5
Workspace:
- persistent application object
- browser/web continuity

### Milestone 6
Resume:
- browser-triggered tailoring
- generation progress
- workspace linking

### Milestone 7
Intelligence:
- company insight pipeline
- trust/freshness/confidence layer

## Recommended Team Execution Order

If one engineer:
- build phases strictly in order
- do not parallelize company intelligence early

If two engineers:
- engineer 1: extension shell + detectors + fill engine
- engineer 2: backend APIs + auth + answer generation

If three engineers:
- engineer 1: extension platform and adapters
- engineer 2: backend contracts and persistence
- engineer 3: AI answers and workspace UX

Still keep company intelligence later.

## Biggest Efficiency Wins
1. Reuse current JD parsing and generation sessions.
2. Reuse current user profile and project data instead of inventing new candidate models.
3. Start with analysis before autofill, then autofill before company intelligence.
4. Build a generic field model first, then adapter overrides.
5. Introduce new tables only when the product proves the need.

## Biggest Failure Modes To Avoid
1. Overbuilding company research before nailing autofill.
2. Shipping weak autofill that users stop trusting.
3. Using browser-stored static API keys.
4. Adding too many schema changes before usage patterns are known.
5. Making the extension stateful in too many places at once.

## Final Recommendation
The cleanest path is:
1. extension shell and auth
2. page analysis
3. safe autofill
4. answer suggestions
5. application workspace
6. tailored resume from browser
7. company intelligence

That order is the fastest way to deliver obvious user value while keeping the architecture simple, reusing your current backend strengths, and avoiding unnecessary complexity.
