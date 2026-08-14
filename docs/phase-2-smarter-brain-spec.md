# Phase 2 — Smarter Brain (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed, blocked on Phase 1 **and** sibling-plan Phase 1+2 |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [one-stop-platform-plan.md](./one-stop-platform-plan.md) |
| Sibling plan | [resume-builder-experience-plan.md](./resume-builder-experience-plan.md) — Phases 1 (free checker) and 2 (`ResumeTheme` + templates) **must land before this phase** so the tailor flow ships theme-aware and source-resume-aware from day one |
| Predecessor | [phase-1-extension-rewrite-spec.md](./phase-1-extension-rewrite-spec.md) |
| Successor | [phase-3-application-tracking-spec.md](./phase-3-application-tracking-spec.md) |
| Target duration | ~10 working days |

## 1. Problem Statement
After Phase 1 ships, the extension is visually polished, type-safe, and orchestrates multi-step flows. But the intelligence remains brittle:

1. **Field resolution is regex + synonym dictionary.** Labels like "Where can we reach you?" or "Your professional handle" never match `email` or `linkedin_url` even though a human reads them instantly. The deterministic matcher is a fast path that misses the long tail.
2. **No corrections memory.** A user overriding a fill on a Greenhouse page on Tuesday is starting from scratch when they see the same field on a Greenhouse page on Wednesday. We have a `ReusableAnswer` table from Phase 6 of the original plan, but it only stores text answers, not field-level corrections.
3. **JS-heavy pages fall off a cliff.** Sites that render their JD inside JS-driven shadow DOM, deferred-loading sections, or cross-origin iframes leave the parser with too little text to score high confidence. We give up silently.
4. **Resume tailoring requires a context switch to the web app.** The user has to bounce out of the application flow to generate a tailored resume, then bounce back to upload it. This is the single biggest time sink in the current loop.

Phase 2 closes all four gaps without expanding the surface area of routes or UI.

## 2. Goals
1. Embedding-based field resolution layer that promotes low-confidence semantic mappings to confident ones when the deterministic matcher is ambiguous.
2. Persistent corrections memory: when a user accepts, edits, or rejects a fill, that signal is remembered keyed by host pattern + label hash and surfaces on next visit.
3. Firecrawl fallback for pages where in-DOM extraction is insufficient. Config-driven daily caps (global + per-user) so we can promote it to a paid-tier feature later without code changes.
4. One-click resume tailoring from the side panel. The Phase 1 Tailor route becomes real: user clicks "Tailor for this JD", the existing generation pipeline runs server-side, the side panel shows progress, and a tailored resume is ready to download or copy into the upload field within ~30 seconds.

## 3. Non-Goals
- No new ATS platforms.
- No new UI routes beyond the components added to existing routes.
- No auto-attach of files to file inputs (Chrome MV3 prohibits; download-then-drop pattern stays).
- No model upgrades for the underlying resume generation; we reuse the existing pipeline.
- No new auth or token surfaces.
- No multi-modal parsing (PDFs, images). JD must still be reachable as text.

## 4. Success Criteria
- [ ] Across a curated set of 20 "tricky" label phrasings (collected during Phase 1 dogfood), the embedding-based resolver raises ≥ 70% from `low`/missing to `medium` or `high` band when run against the user's filled profile.
- [ ] A user correction on field X on `boards.greenhouse.io/<companyA>` is recalled and applied on `boards.greenhouse.io/<companyB>` when the same label appears.
- [ ] Firecrawl fallback fires only when configured to and when in-page extraction failed thresholds. Daily cap enforcement verifiable via the `FirecrawlUsageDay` row count.
- [ ] From the Tailor route, "Tailor for this JD" completes a full tailoring run and offers download in ≤ 60s p95.
- [ ] Tailored resume is auto-bound to the current `ApplicationWorkspace` and visible in the workspace's activity timeline.
- [ ] Phase 0 fixtures still green. Phase 1 hooks and components still pass tests.

## 5. User-Facing Experience

### 5.1 Embedding fallback (silent)
The user never explicitly invokes embedding matching. Behavior change is subtle: more fields show as `medium`/`high` confidence than before, with a small annotation in the "Why" tooltip:
```
Why matched 'email':
- label "Where can we reach you" similarity 0.83 to canonical "email"
- input type=email confirms
```

### 5.2 Corrections memory (silent on read, visible on write)
- When the user clicks "Override" or types a different value into a filled field, the side panel shows a small toast: "We'll remember this for similar fields."
- Next visit to a similar field on the same host pattern, the field row shows a small "Remembered" badge instead of (or alongside) the confidence chip.
- In Settings, "Forget remembered fills on this site" lists the host patterns with a count of remembered fields and a per-site delete.

### 5.3 Firecrawl fallback (semi-visible)
- When the parser reports low JD confidence, the side panel shows a "Trying deeper scan…" indicator for ~3-5s.
- On success, a small badge "Enhanced via Firecrawl" appears next to the JD section in the JobHeaderCard tooltip.
- On daily-cap hit, no Firecrawl invocation is attempted; the side panel shows the original low-confidence JD with an "Analyze with text I select" affordance as a manual fallback.

### 5.4 Tailor resume from side panel
1. User on a job page with a bound workspace.
2. Clicks Tailor route.
3. Sees the current resume picker (master + any prior tailored versions for this workspace) and a primary "Tailor for this JD" button.
4. On click: progress card appears showing pipeline steps (JD parsing → semantic search → paraphrasing → assembly → PDF). Powered by existing `GenerationSession` progress.
5. On completion, the picker auto-selects the new tailored resume. Buttons appear: "Download PDF", "Copy to clipboard (Markdown)", "Open in editor".
6. If the current page has a `resume_upload` field detected, an additional helper: "Click the upload button on the page, then drop the downloaded file" with a small visual highlight on the field. Clicking the helper focuses the upload field on the page.

## 6. Technical Design

### 6.1 Embedding-based field resolution

#### 6.1.1 Where it runs
Backend, on a new route. The extension does not embed locally. Reasons:
- Bundle size: embedding inference in-browser balloons.
- Cache reuse: server-side caching of canonical and per-user-profile embeddings is trivial; in-browser cache invalidation is not.
- Cost containment: we already pay OpenAI for embeddings; backend-only keeps the bill predictable.

#### 6.1.2 Canonical key embeddings
At server boot (or on demand with cache), embed each canonical semantic key as a phrase:
```ts
const CANONICAL_PHRASES: Record<SemanticKey, string[]> = {
  email: ['email', 'email address', 'work email', 'contact email'],
  phone: ['phone', 'phone number', 'mobile', 'cell'],
  linkedin_url: ['linkedin', 'linkedin profile', 'linkedin url'],
  github_url: ['github', 'github profile', 'github url'],
  portfolio_url: ['portfolio', 'personal website', 'website'],
  work_authorization: ['work authorization', 'authorized to work', 'right to work'],
  visa_sponsorship_required: ['visa sponsorship', 'sponsorship', 'require sponsorship'],
  salary_expectation: ['salary expectation', 'desired salary', 'compensation expectation'],
  notice_period: ['notice period', 'available start date', 'when can you start'],
  // ...
};
```
Embed each phrase with the configured embedding model. Average the per-phrase vectors per key to produce a canonical vector. Cache in process memory keyed by `(model, phrasesHash)`. Refresh on hot reload only when the canonical set changes.

#### 6.1.3 Profile field embeddings
A user's profile has fields too — e.g. `experiences[i].role` or `defaultTitle`. For most canonical keys these are not needed (mapping is to a fixed key, not to a profile entry). For two cases they help:
- `job_title` (asking for current title) → matches `defaultTitle` or latest experience role.
- `company_name` (asking for current company) → matches latest experience company.
These are computed on the fly per request and not cached at canonical level.

#### 6.1.4 New service: `src/services/fieldEmbeddingMatcher.ts`
```ts
type ResolveInput = {
  labelCandidates: string[];     // ordered by reliability
  helperText: string | null;
  sectionHeading: string | null;
  placeholder: string | null;
  inputType: string | null;
  optionValues: string[] | null; // for selects, to help disambiguate
};

type ResolveOutput = {
  semanticKey: SemanticKey | null;
  similarity: number;
  band: 'high' | 'medium' | 'low' | 'unknown';
  reason: string;                // e.g. "cosine 0.83 between 'Where can we reach you' and canonical 'email'"
};

export async function resolveField(input: ResolveInput): Promise<ResolveOutput>;
```

Algorithm:
1. Compose a query string: top label + helper text + section heading + placeholder (truncate to ~200 chars).
2. Embed the query.
3. Cosine-similarity against every canonical key vector.
4. Take top match; check it clears `EMBEDDING_HIGH_THRESHOLD` (default 0.78) → band `high`, or `EMBEDDING_MED_THRESHOLD` (default 0.62) → band `medium`.
5. Below `med_threshold` → band `unknown`, semanticKey null.
6. If two top matches are within 0.04 of each other → band downgraded one step (ambiguity penalty).
7. Optional: if the field has `inputType=email`, hard-set `email` if it's in the top 3 regardless of similarity.

#### 6.1.5 New route: `POST /api/extension/fields/resolve`
**Request**:
```ts
{
  fields: Array<{
    fieldId: string;             // client-side id, returned unchanged
    labelCandidates: string[];
    helperText: string | null;
    sectionHeading: string | null;
    placeholder: string | null;
    inputType: string | null;
    optionValues: string[] | null;
    currentSemanticKey: SemanticKey | null;
    currentBand: 'high' | 'medium' | 'low' | 'unknown';
  }>;
}
```

**Response**:
```ts
{
  resolutions: Array<{
    fieldId: string;
    semanticKey: SemanticKey | null;
    band: 'high' | 'medium' | 'low' | 'unknown';
    similarity: number;
    reason: string;
  }>;
}
```

**Gating**: only fields where `currentBand` is `low` or `unknown` are eligible. The extension filters before sending. The backend re-validates the gate to prevent extension bugs from over-billing embeddings.

**Auth**: bearer token. **Rate limit**: 60 RPM per user; batched calls (up to 32 fields) count as one.

#### 6.1.6 Wiring into the orchestrate flow
After the orchestrate route computes the initial fill plan from deterministic matching, if any fields land in `low`/`unknown` band, the same route internally calls the embedding matcher on those fields and merges the results before returning. This keeps the extension calling one route, not two. Embedding-resolved fields carry a `viaEmbedding: true` flag in their `ConfidenceExplanation.reasons` chain so the UI tooltip can show the provenance.

### 6.2 Corrections memory (`RememberedField`)

#### 6.2.1 Data model
New Prisma model:
```prisma
model RememberedField {
  id              String   @id @default(cuid())
  userId          String
  hostPattern     String   // e.g. "boards.greenhouse.io" or "*.myworkdayjobs.com"
  labelHash       String   // SHA-256 of normalized label text
  labelSample     String   // human-readable sample for the user's Settings list
  semanticKey     String?  // canonical key, may be null if user said "this is not a field I want filled"
  value           String?  // last value the user supplied; null if user chose "skip on this field"
  outcome         String   // 'override' | 'reject' | 'edit'
  source          String   // 'user' | 'inferred'
  hitCount        Int      @default(0)
  lastUsedAt      DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, hostPattern, labelHash])
  @@index([userId, lastUsedAt])
}
```

#### 6.2.2 Host pattern normalization
- `boards.greenhouse.io` → keep as-is (multi-tenant ATS).
- `<company>.myworkdayjobs.com` → normalize to `*.myworkdayjobs.com`.
- `<company>.lever.co` → normalize to `*.lever.co`.
- `jobs.lever.co` → keep as-is.
- Default: full hostname.

Logic lives in `src/lib/extension/hostPatterns.ts` with a small lookup table for known multi-tenant hosts. New hosts default to full hostname.

#### 6.2.3 Label normalization for hashing
- Lowercase.
- Strip leading/trailing punctuation and whitespace.
- Collapse internal whitespace runs to single space.
- Strip trailing `*` and `(required)`.
- Stable across minor copy edits.

#### 6.2.4 Write paths
The extension emits one of three events to the worker, which forwards to a new route:
- User clicks "Override" → `RememberedField.outcome = 'override'`, store value if user provided one.
- User clicks "Don't fill this on similar sites" → `outcome = 'reject'`, value `null`.
- User edits the inline value before applying → `outcome = 'edit'`, store the edited value.

New route: `POST /api/extension/fields/remember`. Batched payload of (hostPattern, labelHash, labelSample, semanticKey, outcome, value).

#### 6.2.5 Read paths
The orchestrate route reads `RememberedField` first (single query joined on `(userId, hostPattern, labelHash IN (...))`). Any match wins and short-circuits both the deterministic matcher and the embedding fallback for that field. The merged plan annotates the field with `remembered: true` and `hitCount` increments.

#### 6.2.6 Settings UI
The Settings route in the side panel gains a "Remembered fills" panel:
- Lists host patterns with field counts.
- Click into a host shows the list with `labelSample`, semanticKey, value (masked for sensitive fields), last used.
- Per-row delete and bulk "Forget all for this host".

### 6.3 Firecrawl fallback

#### 6.3.1 Config
Extend `src/lib/config.ts`:
```ts
firecrawl: {
  apiKey: process.env.FIRECRAWL_API_KEY,
  enabled: process.env.FIRECRAWL_ENABLED !== "false",
  dailyCapGlobal: Number(process.env.FIRECRAWL_DAILY_CAP_GLOBAL || 100),
  dailyCapPerUser: Number(process.env.FIRECRAWL_DAILY_CAP_PER_USER || 5),
  jdConfidenceThreshold: Number(process.env.FIRECRAWL_JD_CONF_THRESHOLD || 0.45),
  apiTimeoutMs: Number(process.env.FIRECRAWL_TIMEOUT_MS || 8000),
},
```

Per-user override stored in `UserProfile.preferences.firecrawl`:
```ts
preferences: {
  firecrawl?: {
    enabled?: boolean;
    dailyCap?: number;
  };
};
```

Resolution at request time: `userOverride ?? globalConfig`.

#### 6.3.2 Usage tracking table
```prisma
model FirecrawlUsageDay {
  id        String   @id @default(cuid())
  userId    String
  ymd       String   // "2026-05-29"
  count     Int      @default(0)
  updatedAt DateTime @updatedAt

  @@unique([userId, ymd])
  @@index([ymd])
}
```

Global cap check is `sum(count) WHERE ymd = today`. Per-user check is a single row read.

#### 6.3.3 Gate service: `src/services/firecrawlGate.ts`
```ts
export async function canUseFirecrawl(userId: string): Promise<{
  allowed: boolean;
  reason?: 'disabled' | 'user-opt-out' | 'user-cap' | 'global-cap';
}>;

export async function recordFirecrawlUse(userId: string): Promise<void>;
```

`recordFirecrawlUse` increments `(userId, ymd)` atomically using Prisma upsert with `count: { increment: 1 }`. Global cap row is `userId = '__global__'` or similar sentinel; cleaner: keep global aggregate computed lazily from sum.

#### 6.3.4 Firecrawl client: `src/lib/firecrawl.ts`
Thin wrapper over the Firecrawl HTTP API. Methods:
- `scrapeUrl(url: string, options?): Promise<{ markdown: string; html: string }>` — for JD page scraping.

We do not use Firecrawl's crawl (recursive) features. Only single-URL scrapes.

Timeouts: hard `apiTimeoutMs` cap. On timeout, throws and the caller falls back to the in-page result.

#### 6.3.5 Decision pipeline
When `orchestrate` finishes deterministic + embedding resolution:
1. Compute `jdConfidence` from the in-page parser's score.
2. If `jdConfidence >= jdConfidenceThreshold` → no Firecrawl, return.
3. Check `canUseFirecrawl(userId)`. If false → no Firecrawl, return (with reason logged for telemetry).
4. Call `scrapeUrl(currentUrl)` with timeout.
5. Re-run the JD extractor on the Firecrawl markdown (text-only path; the JD extractor needs a text-only variant — see §6.3.6).
6. If the new JD scores higher than the in-page one, replace in the page model with a marker `viaFirecrawl: true`.
7. `recordFirecrawlUse(userId)`.

#### 6.3.6 Text-only JD extractor
The current JD extractor assumes a DOM. We add a sibling path: `extractJDFromText(text: string): JobDescriptionExtraction`. Same scoring heuristics applied to text blocks split by blank lines or markdown headers. Lives in `src/services/jdParser.ts` (the existing JD parsing service used by the resume tailoring pipeline) — likely already supports this.

#### 6.3.7 New route: `POST /api/extension/parse/firecrawl-fallback`
Optional: if we want the extension to be able to invoke Firecrawl directly (not just via orchestrate). For Phase 2 we keep it internal to orchestrate. The route can be added later if needed.

### 6.4 Resume tailoring from the side panel

#### 6.4.1 Existing pipeline reuse
The web app's tailoring pipeline (`src/workflows/generationSession.ts` + `src/services/jdParser.ts`, `paraphraser.ts`, `resumeAssembler.ts`, `claimValidator.ts`, `atsScorer.ts`) already does the work. We do not change it. We expose a thin wrapper.

**`ResumeTheme` inheritance (depends on sibling-plan Phase 2).** Once the sibling plan introduces `ResumeTheme` (`{ templateId, accentColor, fontFamily, density, sectionOrder }`) on the `Resume` model, the tailor flow must inherit the source resume's theme onto the newly generated resume. The wrapper takes the source resume's `theme` and writes it onto the new resume row before the LaTeX render runs, so the user's chosen look survives every tailoring. If the source resume has no theme set (legacy rows pre-sibling-Phase-2), fall back to the system default theme. The resume picker (§6.4.4) surfaces theme info per row so the user can see at a glance which look a given tailored resume uses.

**Source resume defaulting.** The default source for tailoring is the user's master resume. Users who came in via the sibling plan's free-checker conversion arrive with their parsed resume already loaded as their first resume row; that row is a valid source like any other and needs no special handling.

#### 6.4.2 New route: `POST /api/extension/resume/tailor`
**Request**:
```ts
{
  workspaceId: string;
  sourceResumeId: string | null;   // defaults to user's master resume
  channel: 'web';                  // we keep channel=web for tracking; not 'extension' since GenerationSession channel enum doesn't have it; revisit
}
```

Open question: do we add `'extension'` to the `Channel` enum? **Yes.** Add migration. Filtering generation-session analytics by channel keeps the data clean.

**Response**:
```ts
{
  generationSessionId: string;     // pollable
}
```

**Server behavior**:
- Looks up the `ApplicationWorkspace`, pulls the saved JD.
- Creates a `GenerationSession` row with `channel = 'extension'` and `workspaceId` reference.
- Kicks off the existing pipeline via `src/lib/generationQueue.ts`.
- Returns the new session id.

#### 6.4.3 Polling vs streaming
Reuse the existing `GET /api/extension/generate/:sessionId` route (already in place under `src/app/api/extension/generate/`) for polling status. The side panel polls every 1500ms until terminal state.

#### 6.4.4 Tailor route UI
- `ResumePicker` lists workspace-bound tailored resumes + master. Each row shows a small **theme chip** (template name + accent color swatch) so the user knows at a glance which look that resume uses.
- Primary button "Tailor for this JD".
- On click: button disables, `GenerationProgressCard` renders showing current step (mirrors the web app's progress UI).
- On completion: progress card collapses, picker now includes the new resume at top with its inherited theme chip, "Download PDF" + "Copy as Markdown" + "Open in editor" buttons.
- "Open in editor" deep-links to `/editor/<resumeId>` in a new tab. (Note: the editor surface is being upgraded in parallel by the sibling plan's Phases 2-3; this deep link continues to work and the editor experience strengthens around it.)
- If `resume_upload` field detected on the current page, an additional helper card appears: "Attach to this application" with a button that focuses the file input on the page (uses existing fill-executor focus path).

#### 6.4.5 Workspace activity timeline
On successful tailoring, append a `WorkspaceActivity` event:
```ts
{
  workspaceId,
  type: 'resume_tailored',
  resumeId,
  generationSessionId,
  atsScore: ...,
  occurredAt,
}
```
Stored on `ApplicationWorkspace.activity` JSON array (Phase 3 may extract).

#### 6.4.6 Fix-list pattern in the Tailor route (mirrors sibling plan's free-checker)
The sibling plan's Phase 1 free-checker returns a prioritized fix list: 3-6 specific rewrites with the exact offending text and the suggested improvement. That same pattern fits the extension's Tailor route — but scoped to the **current JD** rather than generic ATS heuristics — so a user moving between the builder and the extension sees the same "here's what to fix" language and trust model in both places.

**What the user sees.** Below the resume picker, before they hit "Tailor for this JD", a `JDFitFixList` card appears:
```
This resume vs. this JD
- 3 keywords missing: Kubernetes, gRPC, Postgres
- Bullet "Built API" lacks metrics — JD emphasizes scale
- Summary doesn't mention backend systems
[Tailor with these fixes →]   [Show what changes]
```
Each item is one click to accept into the tailoring pass (the pipeline takes the fix list as an additional input bias). The user can dismiss any item before tailoring, and the tailored resume's `WorkspaceActivity` records which fixes were applied.

**Implementation.** The fix list is computed by the existing `atsScorer` + JD parser against the selected source resume. No new model, no new pipeline — same call the free-checker uses, just with a JD attached and scoped to the workspace's selected source.

- New helper: `src/services/jdFitReport.ts` exposes `computeJDFitReport(resumeId, jdText)` returning the same shape the sibling plan's free-checker returns. The free-checker and this surface call the same helper.
- New route: `POST /api/extension/resume/jd-fit` returns the report for `(workspaceId, sourceResumeId)`.
- The `tailor` route accepts an optional `fixListAccepted: string[]` (the fix item ids) and threads them into the generation pipeline as JD emphasis.
- Telemetry: `tailor.fixlist.shown`, `tailor.fixlist.item.accepted`, `tailor.fixlist.item.dismissed`.

**Why this matters.** The user already trusts the fix-list pattern from the sibling plan's free-checker. Reusing it here makes the extension feel like a continuation of the same product, not a separate tool, and gives the tailoring pass concrete guidance instead of "make this better." It also gives us a measurable answer to "did the user's resume actually improve for this JD?" that we can surface in Phase 3's workspace timeline.

**Sequencing.** This sub-feature depends on the sibling plan's Phase 1 having shipped `jdFitReport`-shaped logic. If the sibling plan changes the report shape during its build, this sub-feature inherits the change. Coordinate with sibling-plan owner during T2.22.

## 7. Data Model Changes Summary

```prisma
// new
model RememberedField {
  // see §6.2.1
}

model FirecrawlUsageDay {
  // see §6.3.2
}

// modified
enum Channel {
  web
  telegram
  whatsapp
  email
  extension   // new
}

model UserProfile {
  // preferences JSON gains optional `firecrawl` sub-key (no schema change)
}

model ApplicationWorkspace {
  // gains `activity` Json @default("[]") if not already present
}
```

Three migrations: `RememberedField`, `FirecrawlUsageDay`, `Channel.extension`. None require backfill.

## 8. API Routes Summary

| Route | Method | Purpose | Added in |
| --- | --- | --- | --- |
| `/api/extension/session/orchestrate` | POST | Returns updated session + fill plan, internally calls embedding + firecrawl | Phase 1, modified in Phase 2 |
| `/api/extension/fields/resolve` | POST | Embedding-based field resolution batch | Phase 2 |
| `/api/extension/fields/remember` | POST | Write corrections memory | Phase 2 |
| `/api/extension/fields/remembered` | GET | List remembered fills for Settings UI | Phase 2 |
| `/api/extension/fields/remembered/:id` | DELETE | Forget one entry | Phase 2 |
| `/api/extension/resume/tailor` | POST | Trigger tailored resume generation for the workspace | Phase 2 |

All authenticated with the existing extension bearer token.

## 9. UI Spec — additions

### 9.1 FieldRow updates
- New `Remembered` badge (small purple chip) replaces or accompanies the confidence chip when the source is `remembered`.
- "Why" tooltip distinguishes between deterministic / embedding / remembered sources:
```
Why matched 'email':
- remembered from a previous visit on boards.greenhouse.io
- you previously entered: jane.doe@example.com
```
- New row action menu: "Forget this remembered fill".

### 9.2 JobHeaderCard updates
- Tooltip on the JD line: "Extracted from page" vs "Enhanced via Firecrawl".

### 9.3 Tailor route
- Becomes the real component, not a placeholder.
- See §6.4.4.

### 9.4 Settings route
- New "Remembered fills" panel as described in §6.2.6.
- New "Firecrawl preferences" panel:
  - Toggle: "Enable enhanced scanning on tricky pages".
  - Counter: "Used today: 3 of 5".
  - Helper text linking to a docs page describing what Firecrawl does and why we use it.

## 10. Telemetry additions

```ts
| { type: 'field.embedding.resolved'; semanticKey: SemanticKey; band: 'high'|'medium'; similarity: number }
| { type: 'field.embedding.skipped'; reason: 'gated'|'no-match' }
| { type: 'field.remembered.hit'; hostPattern: string; semanticKey: SemanticKey | null }
| { type: 'field.remembered.write'; outcome: 'override'|'reject'|'edit'; hostPattern: string }
| { type: 'firecrawl.invoked'; outcome: 'success'|'timeout'|'error'; durationMs: number }
| { type: 'firecrawl.skipped'; reason: 'disabled'|'user-opt-out'|'user-cap'|'global-cap'|'confidence-ok' }
| { type: 'resume.tailor.started'; workspaceId: string }
| { type: 'resume.tailor.completed'; workspaceId: string; durationMs: number; atsScore: number | null }
| { type: 'resume.tailor.failed'; workspaceId: string; errorClass: string }
```

PII rules unchanged. `hostPattern` is hashed in transport.

## 11. Implementation Plan

| # | Task | Est. | Depends on |
| --- | --- | --- | --- |
| T2.1 | Canonical phrases per semantic key + averaging | 4h | Phase 1 done |
| T2.2 | `fieldEmbeddingMatcher.ts` service + in-process cache | 1d | T2.1 |
| T2.3 | `POST /api/extension/fields/resolve` route + schemas + tests | 4h | T2.2 |
| T2.4 | Wire embedding fallback into orchestrate route | 4h | T2.3 |
| T2.5 | Update FieldRow UI to render "via embedding" reason chain | 2h | T2.4 |
| T2.6 | Prisma: `RememberedField` + migration | 2h | — |
| T2.7 | `hostPatterns.ts` lookup + label normalization | 3h | T2.6 |
| T2.8 | `POST /api/extension/fields/remember` route + tests | 4h | T2.6 |
| T2.9 | `GET /api/extension/fields/remembered` + delete route | 3h | T2.6 |
| T2.10 | Wire remembered read into orchestrate, write into UI actions | 4h | T2.8 |
| T2.11 | Settings panel: "Remembered fills" | 4h | T2.9 |
| T2.12 | Prisma: `FirecrawlUsageDay` + migration | 1h | — |
| T2.13 | Config block + per-user override resolution | 2h | T2.12 |
| T2.14 | `firecrawlGate.ts` + tests | 4h | T2.12 |
| T2.15 | `firecrawl.ts` client wrapper + tests with fixtures | 4h | — |
| T2.16 | Text-only JD extractor variant in `jdParser.ts` | 4h | — |
| T2.17 | Wire Firecrawl into orchestrate decision pipeline | 4h | T2.14, T2.15, T2.16 |
| T2.18 | Settings panel: "Firecrawl preferences" | 3h | T2.13 |
| T2.19 | JobHeaderCard tooltip updates (enhanced via Firecrawl) | 2h | T2.17 |
| T2.20 | Prisma migration: `Channel.extension` | 1h | — |
| T2.21 | `POST /api/extension/resume/tailor` route | 4h | T2.20 |
| T2.22 | Tailor route real component (ResumePicker w/ theme chips, GenerationProgressCard) | 1d | T2.21 |
| T2.23 | Upload helper card with file-input focus | 4h | T2.22 |
| T2.24 | `WorkspaceActivity` event append on tailor success | 2h | T2.21 |
| T2.25 | `jdFitReport` helper + `/api/extension/resume/jd-fit` route + thread `fixListAccepted` into tailor pipeline | 1d | T2.21, sibling-plan Phase 1 shipped |
| T2.26 | `JDFitFixList` card in Tailor route + telemetry | 4h | T2.22, T2.25 |
| T2.27 | Manual QA pass across all four platforms | 1d | T2.5, T2.10, T2.17, T2.26 |
| T2.28 | Update `browser-extension-build-status.md` | 30m | T2.27 |

Total estimated effort: ~11 working days (~10 + 1 day added for fix-list integration).

### 11.1 Sequencing recommendation
Four parallelizable workstreams:
- **A (embedding)**: T2.1 → T2.5 (~2 days)
- **B (memory)**: T2.6 → T2.11 (~2.5 days)
- **C (Firecrawl)**: T2.12 → T2.19 (~2 days)
- **D (tailor + fix-list)**: T2.20 → T2.26 (~3.5 days, includes sibling-plan coordination on T2.25)

Integration + QA: T2.27, T2.28 (~1 day).

A and B touch the orchestrate route; merge order matters. Recommend completing A first, then B, then C interleaved with D. Workstream D's fix-list sub-feature (T2.25-T2.26) is gated on the sibling plan's Phase 1 having shipped the `jdFitReport` shape — coordinate before starting.

## 12. Testing Strategy

### 12.1 Unit
- `resolveField` with mocked OpenAI embedding client (deterministic vectors): asserts band assignment, ambiguity penalty, input-type override.
- `hostPatterns.normalize`: table-driven tests for known multi-tenant hosts.
- `labelHash` normalization: tests asserting equivalent variants produce the same hash.
- `firecrawlGate.canUseFirecrawl`: tests for each `reason` branch.
- `firecrawlGate.recordFirecrawlUse`: tests for concurrent increment safety (use a small chaos test with `Promise.all`).

### 12.2 Integration
- `/api/extension/fields/resolve`: gated input rejection, batched response shape, error path on OpenAI failure (returns 502, extension falls back to deterministic-only).
- `/api/extension/fields/remember` + `/orchestrate` round trip: write a remembered field, then orchestrate a fresh request, assert the field appears with `remembered: true`.
- Firecrawl path: mock the Firecrawl client to return a fixed markdown blob; assert JD replacement happens when in-page confidence is below threshold.

### 12.3 Manual QA (T2.25)
Same platforms as Phase 1. Additional checks:
- [ ] At least 2 of the 4 platforms surface a "via embedding" reason on at least one field.
- [ ] Overriding a field on platform A surfaces as remembered on platform A on next visit.
- [ ] Firecrawl badge appears on at least one constructed low-confidence test page.
- [ ] Tailor flow completes end-to-end on one platform.
- [ ] Phase 0 fixtures still pass.

## 13. Rollout

### 13.1 Feature flags
Each workstream guarded by a server-side flag readable from config:
- `EXTENSION_EMBEDDING_RESOLVER_ENABLED` (default true at merge).
- `EXTENSION_REMEMBERED_FIELDS_ENABLED` (default true).
- `EXTENSION_FIRECRAWL_ENABLED` (default false until API key set in env, then true).
- `EXTENSION_TAILOR_FROM_SIDEPANEL_ENABLED` (default true).

Flags exist so we can disable any workstream without a deploy if it misbehaves in production.

### 13.2 Cost monitoring
Daily report in admin route showing:
- Embedding-resolve invocations and average fields-per-call.
- Firecrawl invocations and remaining global cap.
- Tailoring runs initiated from extension.

If embedding cost spikes, the gate (`currentBand` filter) is the lever to tighten.

## 14. Open Questions
1. **Should embedding resolution also run when current band is `medium`?** Currently we only run on `low`/`unknown`. Running on `medium` could catch more misclassifications but doubles embedding cost. Defer until we see post-launch data.
2. **Granularity of remembered fields when the same label appears in different sections.** E.g. "Email" can appear under "Personal" and "Emergency Contact". Today we hash only the label; we should include section heading in the hash if collisions show up. Punt to data.
3. **What happens when Firecrawl produces a wildly different role/company than the in-page parser?** Mismatch could mean we scraped a page meta description vs the actual form. Confidence comparison should be apples-to-apples; if values disagree, prefer in-page. Document this in the merging logic comments.
4. **Cost of `Channel.extension` enum addition.** No downstream code branches on channel for behavior, only for analytics. Confirm by grep before migrating.
5. **Tailor from side panel: source resume defaulting.** Defaulting to master is safe; should we automatically use the most recent tailored resume for this workspace as the source instead, treating tailoring as iterative? Recommend: master by default, with a dropdown.
6. **Permissions for "Forget all remembered fills" on a multi-tenant host.** Forgetting all `boards.greenhouse.io` entries removes the user's memory across every company on Greenhouse, which is a lot. UI should warn explicitly.

## 15. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Embedding cost spikes | Medium | Medium | Gated to `low`/`unknown` band only. Daily admin report. Easy off-switch via flag. |
| Embedding model returns vectors of unexpected dimension | Low | High | `resolveEmbeddingSize` from Phase 0 already normalizes; assert vector length in `resolveField` and 502 on mismatch. |
| Remembered fields stored with sensitive PII (e.g. SSN-like values) | Medium | High | Allowlist of `semanticKey` values that may persist `value`. SSN-like, government-ID-like, salary fields → memory stores outcome only, never value. Hard list in `src/lib/extension/rememberedAllowlist.ts`. |
| Firecrawl API outage | Medium | Medium | Timeout + fallback to in-page result. No user-visible error; telemetry captures the skip. |
| Firecrawl rate caps abused | Low | Low | Per-user daily cap defaults to 5. Global cap defaults to 100. Both adjustable without code changes. |
| Tailor flow blocks the side panel UI | Medium | Medium | Tailor runs async on the backend; the side panel polls. The progress card never blocks the rest of the side panel; user can still parse and fill in other tabs. |
| Workspace activity JSON grows unbounded | Low | Low | Truncate activity to last 50 events on append. Phase 3 may extract to a sibling table. |
| New `Channel.extension` enum breaks queries that pattern-match | Low | Medium | Grep for `Channel\.web\b` and `Channel.telegram` etc., ensure no exhaustive switches assume a closed set. |

## 16. References
- [one-stop-platform-plan.md](./one-stop-platform-plan.md)
- [resume-builder-experience-plan.md](./resume-builder-experience-plan.md) — sibling plan; Phase 1 (`jdFitReport` shape) and Phase 2 (`ResumeTheme`) are hard prerequisites for §6.4
- [phase-1-extension-rewrite-spec.md](./phase-1-extension-rewrite-spec.md)
- [phase-3-application-tracking-spec.md](./phase-3-application-tracking-spec.md)
- [browser-extension-parsing-engine.md](./browser-extension-parsing-engine.md)
- Firecrawl API docs: https://docs.firecrawl.dev
- OpenAI embeddings: https://platform.openai.com/docs/guides/embeddings
