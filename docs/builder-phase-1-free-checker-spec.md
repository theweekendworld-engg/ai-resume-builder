# Builder Phase 1 — Free No-Login ATS Checker (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [resume-builder-experience-plan.md](./resume-builder-experience-plan.md) |
| Successor | [builder-phase-2-template-system-spec.md](./builder-phase-2-template-system-spec.md) |
| Downstream dependency | [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) §6.4.6 — adopts the `jdFitReport` shape introduced here |
| Target duration | ~7 working days |

## 1. Problem Statement
A first-time visitor to the marketing site is asked to sign up before getting any value. The site sells "ATS scoring", "JD-tailored resumes", "AI rewrites" — all features behind an auth wall. Visitors with no prior trust have no reason to convert, and the funnel collapses at the sign-up gate.

Meanwhile, the underlying engine that scores resumes (`computeAtsEstimate`) and the parser that turns a PDF into structured data (`storeResumeImportArtifact` → `pdf-parse` → `resumeParser.ts`) already exist. They are gated behind authentication only because the product never offered an anonymous surface. The capability to deliver a useful free result in under 30 seconds is already in the codebase.

Phase 1 unblocks it: a public, no-login route where a visitor drops a resume PDF or DOCX, gets a real scored report with 3-6 specific fixes, and is offered a one-click path into the builder with their parsed resume preloaded and the fix list ready to resolve.

## 2. Goals
1. A public, anonymous route at `/score` that scores a dropped PDF or DOCX in ≤ 30 seconds (median).
2. A scored report that is **specific, not generic**: per fix, the exact offending text and a concrete suggested rewrite.
3. Optional JD textarea for JD-aware scoring; defaults to general ATS heuristics when empty.
4. Frictionless conversion: "Fix all of these" → sign-up → land in the builder with the parsed resume and the fix list both preloaded.
5. Genuine privacy posture: uploaded files are ephemeral. Discarded after the session unless the user converts and explicitly saves.
6. Anonymous abuse control via Upstash rate-limiting, reusing the existing pattern.
7. Instrumentation against the funnel metrics in the parent plan.
8. A reusable `jdFitReport` shape that the extension Phase 2 Tailor route will consume verbatim. One report, two surfaces.

## 3. Non-Goals
- No new scoring engine. We extend `atsScorer.ts` and ride on the existing JD parser.
- No new PDF/DOCX parsing engine. We reuse `pdf-parse` and the existing resume parser; we add a DOCX path only if it falls out cheaply (it does — `mammoth` is the standard).
- No persistent storage of anonymous uploads or scores beyond the session TTL.
- No login/email-capture wall in disguise. Free really means free.
- No premium-only scoring dimensions. The free checker shows the full report. Premium is downstream (tailoring + apply + track).
- No A/B test infrastructure in this phase. We ship the canonical experience.

## 4. Success Criteria
- [ ] Logged-out user can navigate to `/score`, drop a 1-2 page PDF resume, and see a scored report within 30s p95.
- [ ] Report includes: headline score 0-100, band label, dimension breakdown, **3-6 specific fixes** with the original text and suggested rewrite.
- [ ] Privacy line is visible inline ("Your file is not stored. We parse it, score it, and discard it.") and matches what the code actually does (no blob persisted past TTL, no DB row created until sign-up).
- [ ] "Fix all of these" CTA opens the existing sign-up flow with a session token; after sign-up the user lands at `/build` (or equivalent) with their parsed resume saved as their first resume row and the fix list rendered as a checklist in the editor.
- [ ] Anonymous rate limit triggers a friendly message at the configured cap; cap configurable via env without code change.
- [ ] Telemetry events (`score_started`, `score_completed`, `score_cta_clicked`, `score_to_signup`) visible in `/admin` within 24h of dogfood.
- [ ] No `ResumeImportSession` or `Resume` rows created for users who never sign up.
- [ ] Phase 0 (extension) fixture tests still green; existing resume-import flow for logged-in users unaffected.

## 5. User-Facing Experience

### 5.1 Landing on `/score`
- Outcome-led hero: "See exactly what's wrong with your resume. No signup."
- Single drop zone occupying the visual center.
- Optional secondary field: "Paste a job description for JD-aware scoring (optional)" — collapsible textarea.
- File constraints displayed inline: PDF or DOCX, ≤ 2 MB.
- Privacy line below the drop zone: "Your file is not stored. We parse it, score it, and discard it."

### 5.2 Upload progress
- On file drop: drop-zone collapses to a compact "Scoring your resume..." card with a determinate progress indicator that maps to backend phases (upload → parse → score → report).
- Estimated time displayed: "About 20-30 seconds."
- If processing exceeds 30s, the card text shifts to "Still working..." rather than failing silently.
- If parsing fails (unreadable PDF), card flips to an error state with a "Try another file" button and a one-line cause ("We couldn't read text from this PDF. It may be image-only.").

### 5.3 Report view
Above the fold:
```
Your resume score: 67 / 100 — Good, but improvable
                                    [Fix all of these in one click →]

Top fixes:
1. Add metrics to your "Lead Engineer" bullet
   Current:  "Built API for internal tools"
   Try:      "Built API serving 2M req/day for internal tools, cutting median latency 40%"
   Why:      Bullets without numbers underperform — recruiters scan for impact.

2. Missing keywords for your target role
   You're missing: Kubernetes, gRPC, Postgres
   Add these to your skills section or work them into recent bullets where true.

3. ...
```

Below: dimension breakdown.
```
Keywords & Skills     ████████░░  78
Impact & Metrics      █████░░░░░  52
Formatting/Parse      █████████░  91
Length & Structure    ███████░░░  74
Contact Completeness  ██████████  100
```

Side panel (or below on narrow screens): privacy reaffirmation, "Save these fixes to keep working in our builder" sign-up callout.

### 5.4 Conversion to the builder
- Primary CTA "Fix all of these in one click" → opens the existing Clerk sign-up modal/page with a session token in the URL (`?score_session=<token>`).
- After sign-up completes, the session token is consumed server-side:
  - Creates the user's first `Resume` row from the parsed structured content.
  - Creates a `FixListChecklist` row attached to that resume (see §6.5).
  - Discards the in-memory parsed content and any short-lived blob.
- User lands at `/editor/<resumeId>` with the fix-list checklist visible in a side panel. Each item is one click to apply (Phase 3 polish — Phase 1 ships the checklist read-only with a "Show in resume" highlight per item).

### 5.5 Rate-limit hit
Inline message: "We've hit the free hourly limit. Wait an hour or create a free account for unlimited checks." Account creation here uses the same flow as §5.4 minus the parsed-resume seed.

## 6. Technical Design

### 6.1 Route + page structure
```text
src/app/(marketing)/score/
  page.tsx               # server component, renders shell
  ScoreClient.tsx        # client component, drop-zone + state machine
  ScoreReport.tsx        # client component, report view
  components/
    DropZone.tsx
    DimensionBar.tsx
    FixCard.tsx
    ScoreHeader.tsx
    PrivacyLine.tsx
```

Linked from the existing marketing landing page (Hero CTA) — wiring in Phase 4 of the parent plan.

### 6.2 Anonymous score API

**New route: `POST /api/score/anonymous`**

Why a new route instead of extending `/api/resume-import`: the existing import route is auth-gated, writes a `ResumeImportSession` DB row, persists a blob, and runs through an async queue. The free checker needs none of that — anonymous, synchronous-feeling, ephemeral. Carving a separate route keeps the existing flow's invariants intact and makes the privacy story easy to verify.

**Request**: `multipart/form-data` with `file` (PDF or DOCX, ≤ 2 MB) and optional `jobDescription` (string, ≤ 30,000 chars).

**Response (success)**:
```ts
{
  scoreSessionToken: string;  // opaque, short-lived, used to claim into account on signup
  report: JDFitReport;
}
```

**Response (rate-limited)**: 429 with `{ error: 'rate_limited', retryAfterSeconds: number }`.

**Response (parse failed)**: 422 with `{ error: 'parse_failed', reason: 'image_only' | 'corrupted' | 'unsupported_encoding' }`.

**Auth**: none. Rate-limited per-IP via Upstash.

**Timeout**: 30s server-side. The route returns 504 with a structured error if exceeded; client shows "Still working..." longer than 30s only when the server is still streaming progress (see §6.3).

### 6.3 Synchronous parse + score pipeline

A new orchestration module `src/services/anonymousScorer.ts`:
```ts
export async function scoreAnonymous(input: {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  jobDescription: string | null;
  clientIp: string;
}): Promise<{ scoreSessionToken: string; report: JDFitReport }>;
```

Pipeline steps:
1. **Validate**: size, mime, basic header sniff.
2. **Extract text**:
   - PDF: reuse `pdfParser.ts` (built on `pdf-parse`, already in deps).
   - DOCX: new helper `src/lib/docxParser.ts` using `mammoth` (add to deps).
3. **Parse into structured resume**: reuse `resumeParser.ts` (lines 1-402). It expects raw text and returns `ResumeData`. The existing function is synchronous-friendly; we call it directly without going through `resumeImportQueue.ts`.
4. **Parse JD if provided**: reuse `services/jdParser.ts`.
5. **Compute report**: new service `src/services/jdFitReport.ts` (see §6.4).
6. **Store ephemerally**: write `{ resumeData, fixList, expiresAt }` to short-TTL Upstash Redis under key `score:session:<token>`. TTL: 1 hour. Token is a 24-char crypto-random hex string.
7. **Return** the token + report.

Total budget per call: ≤ 25s server time. PDF parse is the long pole (typically 3-8s for 2 MB), OpenAI calls for the fix list (typically 4-12s) are the rest. Margin for the 30s SLA.

### 6.4 `jdFitReport` shape and computation

This is the contract the extension Phase 2 Tailor route consumes. Defining it carefully here pays off later.

```ts
type JDFitReport = {
  scoreOutOf100: number;
  band: 'needs_work' | 'good' | 'strong';
  computedAt: string;
  scopedToJD: boolean;             // true when JD was provided

  dimensions: {
    keywords: DimensionScore;
    impactAndMetrics: DimensionScore;
    formattingAndParseability: DimensionScore;
    lengthAndStructure: DimensionScore;
    contactCompleteness: DimensionScore;
  };

  fixes: Fix[];                    // 3-6, prioritized

  jdSummary: {                     // only present when scopedToJD === true
    requiredSkills: string[];
    preferredSkills: string[];
    missingFromResume: string[];
  } | null;
};

type DimensionScore = {
  score: number;        // 0-100
  band: 'needs_work' | 'good' | 'strong';
  shortReason: string;  // ≤ 80 chars
};

type Fix = {
  id: string;                              // stable hash; used by extension to thread accepted fixes
  priority: number;                        // 1 = highest
  category: 'keywords' | 'impact' | 'formatting' | 'length' | 'contact' | 'targeting';
  title: string;                           // ≤ 80 chars
  why: string;                             // 1-2 sentences
  location: FixLocation;                   // where in the resume
  before: string | null;                   // exact offending text, if any
  after: string;                           // suggested replacement or addition
  appliesTo: 'bullet' | 'section' | 'header' | 'skills' | 'global';
};

type FixLocation = {
  section: 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'contact';
  experienceIndex?: number;
  bulletIndex?: number;
  projectIndex?: number;
};
```

#### 6.4.1 Service: `src/services/jdFitReport.ts`
```ts
export async function computeJDFitReport(input: {
  resume: ResumeData;
  parsedJD: ParsedJDType | null;
  rawJobDescription: string | null;
}): Promise<JDFitReport>;
```

Composition:
- **Dimension scores** computed deterministically from `resume` + optional `parsedJD`:
  - `keywords`: existing `computeAtsEstimate` if JD provided, else a general keyword density check against a curated common-skills vocabulary.
  - `impactAndMetrics`: regex pass for numeric patterns (`\d+%`, `\$\d+`, `x\d+`, `\d+,\d{3}+`, `\d+\s*(users|customers|requests|engineers|reports|deals)`) per bullet; score = % of bullets containing at least one metric.
  - `formattingAndParseability`: heuristics on the parsed text — multi-column suspicion, image-heavy regions (low text-to-page-bytes ratio), header/footer anomalies. Most of these need the raw `pdf-parse` output, not just the structured resume.
  - `lengthAndStructure`: page count proxy (chars / typical-chars-per-page), section presence, ordering coherence.
  - `contactCompleteness`: presence of name/email/phone/links.
- **Fixes** generated via a single LLM call structured-output (zod schema) with the resume + dimensions + parsedJD as context. Prompt requirements:
  - "Return 3-6 fixes."
  - "Each fix must reference an exact `before` string from the resume (or `null` if it's an additive fix like new keywords)."
  - "Each fix must have a concrete `after` string the user could paste in."
  - "Do not produce vague advice like 'use stronger verbs'."
  - Schema enforced via `aiSchemas.ts` pattern already used in the codebase.
- **Fix IDs** are deterministic hashes of `(category, location, before)` so the same resume + JD produces stable IDs across calls — important for the extension's Tailor route to thread accepted fixes through (extension Phase 2 §6.4.6).

#### 6.4.2 Caching
Within a session, the same `(resumeHash, jdHash)` → same fixes. Cache hits return in ~50ms. Upstash key: `jdfit:<resumeHash>:<jdHash>` with 1h TTL.

### 6.5 Session token + signup handoff

#### 6.5.1 Token issuance
On successful `scoreAnonymous` completion, a token is minted and stored in Redis:
```
key:   score:session:<token>
value: { resumeData, report, jobDescription, createdAt, expiresAt }
ttl:   3600s
```
Token format: `sct_<24 hex chars>` (`sct` = score session token). The token has no PII embedded.

#### 6.5.2 Sign-up integration
The "Fix all of these" CTA links to:
```
/sign-up?score_session=sct_<token>&redirect=/build
```

The sign-up page (existing Clerk page) reads `score_session` from the URL and, after successful sign-up:
1. POST `/api/score/claim` with `{ token }` (authenticated as the newly-created user).
2. Server-side: load `score:session:<token>` from Redis. If missing/expired → return 410.
3. If present: create a `Resume` row with `content = resumeData`, mark as the user's first/primary resume.
4. Create a `FixListChecklist` row attached to that resume.
5. Delete the Redis key.
6. Redirect the user to `/editor/<resumeId>?fix_list=<checklistId>`.

#### 6.5.3 Token security
- Tokens are unguessable (24 hex chars = 96 bits entropy).
- Tokens are single-use (deleted on claim).
- Tokens expire in 1h.
- Tokens are bound to the IP that minted them? **No.** A user uploading from one device and signing up on another is realistic; binding to IP breaks that. Token unpredictability is the only security mechanism. Acceptable.

### 6.6 Data model changes

```prisma
model FixListChecklist {
  id            String   @id @default(cuid())
  userId        String
  resumeId      String?
  jdHash        String?  // present if scoped to a JD; for the free checker, null
  fixes         Json     // array of Fix
  resolved      Json     @default("[]")  // array of fix ids the user has marked done
  origin        FixListOrigin
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([userId, createdAt])
  @@index([resumeId])
}

enum FixListOrigin {
  free_checker_signup
  builder_recheck
  extension_jd_fit
}
```

`Resume` row is unchanged structurally for Phase 1; theme work is Phase 2.

Migration: one Prisma migration adding the new table + enum.

### 6.7 Rate limiting

Extend `src/lib/rateLimit.ts` with a new anonymous-score limiter:
```ts
function getAnonymousScoreLimiter(): Ratelimit | null {
  if (ratelimitAnonScore !== undefined) return ratelimitAnonScore;
  const redis = getRedis();
  ratelimitAnonScore = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          Number(process.env.ANON_SCORE_PER_IP_HOURLY || 5),
          '1 h'
        ),
        prefix: 'rl:anonScore',
      })
    : null;
  return ratelimitAnonScore;
}
```

Identity key: IP address from `x-forwarded-for` (first hop) or `req.headers.get('x-real-ip')`. Behind a CDN/edge proxy as Next.js typically is, this is the user's IP.

Default cap: 5 per IP per hour. Configurable via `ANON_SCORE_PER_IP_HOURLY`. We start conservative.

Daily global cap: a separate counter (sliding window 24h, threshold 1000) protects against viral abuse independent of per-IP. Configurable via `ANON_SCORE_GLOBAL_DAILY`.

### 6.8 DOCX support

Add `mammoth` to deps. Helper:
```ts
// src/lib/docxParser.ts
import mammoth from 'mammoth';

export async function parseDocxToText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
```

Returns plain text suitable for `resumeParser.ts` to consume. DOCX is detected by mimetype and the `.docx` magic-number sniff for safety.

If parsing fails (e.g. password-protected, corrupt), the route returns 422 with `reason: 'unsupported_encoding'`.

### 6.9 Telemetry

```ts
type ScoreEvent =
  | { type: 'score_started'; hasJD: boolean; fileType: 'pdf' | 'docx'; fileSizeKb: number }
  | { type: 'score_completed'; durationMs: number; score: number; band: string; fixCount: number; hasJD: boolean }
  | { type: 'score_failed'; reason: string; durationMs: number }
  | { type: 'score_rate_limited' }
  | { type: 'score_cta_clicked' }
  | { type: 'score_to_signup'; durationMsFromCompletion: number };
```

PII rules: never log the file, the parsed resume, or the JD. Hash IP for `score_rate_limited`. Use the same `ExtensionEvent` table introduced in the extension Phase 1 plan — rename to `ProductEvent` if it makes sense, or add a sibling `AnonymousEvent` table for unauthenticated events. **Recommendation: rename `ExtensionEvent` → `ProductEvent`** with a `surface: 'extension' | 'web_anonymous' | 'web_authenticated'` column. One events table beats two.

### 6.10 Component breakdown

#### 6.10.1 `<DropZone>`
- Single file input, drag/drop or click.
- Accepts `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- On accept, calls `onFile(file)` prop.
- On invalid type / oversize, shows inline error.

#### 6.10.2 `<ScoreClient>` (state machine)
States:
- `idle` → drop zone visible.
- `uploading` → progress card with "About 20-30 seconds".
- `parsing` / `scoring` → same card, animated step indicator.
- `done` → renders `<ScoreReport>`.
- `error` → error card with retry.
- `rate_limited` → rate-limit message.

Uses `fetch('/api/score/anonymous', { method: 'POST', body: formData })` with no abort timeout client-side. The server enforces the 30s ceiling.

#### 6.10.3 `<ScoreReport>`
- Top: `<ScoreHeader>` with score number, band, "Fix all" CTA.
- Middle: scrollable list of `<FixCard>` per fix.
- Bottom: dimension breakdown `<DimensionBar>` per dimension.
- Sticky footer (on narrow screens) with the conversion CTA.

#### 6.10.4 `<FixCard>`
- Title.
- Side-by-side before/after blocks (collapsing to stacked on narrow).
- "Why" expandable.
- Category chip.
- (Read-only in Phase 1. Phase 3 of the parent plan adds one-click accept in the editor.)

#### 6.10.5 `<DimensionBar>`
- Label, score number, horizontal bar, color coded by band.
- Hover reveals `shortReason`.

#### 6.10.6 `<PrivacyLine>`
- Single line, muted text, repeated above and below the report.
- "Your file is not stored. We parse it, score it, and discard it."

### 6.11 Editor side-panel checklist (preview)
Detailed work for the editor's fix-list checklist UI happens in builder Phase 3. Phase 1 ships:
- A read-only checklist panel in the editor on `/editor/<resumeId>` when `?fix_list=<id>` is present in the URL.
- Each row: title, category chip, "Show in resume" button that scrolls the editor and highlights the bullet/section referenced by `FixLocation`.
- A "Mark as resolved" toggle (writes to `FixListChecklist.resolved`) — purely manual in Phase 1.
- A persistent "Re-check my resume" CTA at the bottom that re-runs the report against the current resume.

## 7. API Routes Summary

| Route | Method | Auth | Purpose | Added in |
| --- | --- | --- | --- | --- |
| `/api/score/anonymous` | POST | none + rate-limit | Score uploaded resume | Phase 1 |
| `/api/score/claim` | POST | required | Convert score session into a Resume + FixListChecklist | Phase 1 |
| `/api/score/refresh` | POST | required | Re-score the current resume against a (new) JD | Phase 1 |

## 8. Implementation Plan

| # | Task | Est. | Depends on |
| --- | --- | --- | --- |
| BP1.1 | Add `mammoth` to deps; implement `docxParser.ts` + tests | 3h | — |
| BP1.2 | Define `JDFitReport`, `Fix`, `FixLocation` zod schemas in `aiSchemas.ts` | 3h | — |
| BP1.3 | Implement `jdFitReport.ts` service (dimension scorers) | 1d | BP1.2 |
| BP1.4 | LLM fix-list generation: prompt + structured-output schema + retry/fallback | 1d | BP1.3 |
| BP1.5 | `anonymousScorer.ts` orchestration + Redis short-TTL session storage | 4h | BP1.4 |
| BP1.6 | `POST /api/score/anonymous` route + Upstash rate-limit + tests | 4h | BP1.5 |
| BP1.7 | `POST /api/score/claim` route + token consumption + Resume + FixListChecklist creation | 4h | BP1.5 |
| BP1.8 | `POST /api/score/refresh` route | 3h | BP1.3 |
| BP1.9 | Prisma migration: `FixListChecklist` + `FixListOrigin` enum | 2h | — |
| BP1.10 | Rename `ExtensionEvent` → `ProductEvent` with `surface` column (or add new table; decide during T1) | 3h | — |
| BP1.11 | `<DropZone>`, `<ScoreClient>`, `<ScoreReport>` components | 1d | BP1.6 |
| BP1.12 | `<FixCard>`, `<DimensionBar>`, `<ScoreHeader>`, `<PrivacyLine>` | 4h | BP1.11 |
| BP1.13 | `/(marketing)/score/page.tsx` shell + tailwind polish | 4h | BP1.11 |
| BP1.14 | Clerk sign-up page integration: read `score_session` URL param, call claim on success | 4h | BP1.7 |
| BP1.15 | Editor side-panel fix-list checklist (read-only) | 1d | BP1.7 |
| BP1.16 | Telemetry wiring for all events in §6.9 | 4h | BP1.10 |
| BP1.17 | Marketing landing page Hero CTA points at `/score` | 1h | BP1.13 |
| BP1.18 | Manual QA: 5 real PDFs of varying quality, 2 DOCX, 1 image-only PDF (negative case) | 1d | BP1.13, BP1.14 |
| BP1.19 | Update build status doc | 30m | BP1.18 |

Total estimate: ~7 working days.

### 8.1 Sequencing recommendation
- Day 1: BP1.1 → BP1.2 → BP1.3 (foundations).
- Day 2: BP1.4 (LLM is the highest-risk task; do it early to leave time for tuning).
- Day 3: BP1.5 → BP1.6 → BP1.7 (routes).
- Day 4: BP1.9, BP1.10, BP1.11 (data + UI scaffolds).
- Day 5: BP1.12 → BP1.13 (UI depth).
- Day 6: BP1.14 → BP1.15 → BP1.16 (handoff + telemetry).
- Day 7: BP1.17 → BP1.18 → BP1.19 (polish + QA + ship).

## 9. Testing Strategy

### 9.1 Unit
- `docxParser.parseDocxToText`: golden DOCX fixture (a sanitized resume DOCX) → expected text.
- `jdFitReport` dimension scorers: pure functions; table-driven tests for each.
- `Fix` ID determinism: same input → same id.
- Rate-limit identity extraction: tests for `x-forwarded-for`, `x-real-ip`, and direct.

### 9.2 Integration
- `/api/score/anonymous`: rate-limit triggers at threshold, returns 422 on image-only PDF (fixture), returns 200 with valid report on a real fixture PDF.
- `/api/score/claim`: token consumption is single-use, expired tokens return 410.
- LLM call mocked with deterministic fixture response in CI; live calls only run in a dedicated `bun test:live-llm` script gated behind an env var.

### 9.3 Manual QA (BP1.18)
- 3 real PDFs of varying quality (1 strong, 1 weak, 1 mid).
- 2 real DOCX files.
- 1 image-only PDF (negative case: must return 422 with `image_only`).
- 1 oversized PDF (negative case: must return 400).
- 1 corrupt PDF (negative case: must return 422 with `corrupted`).
- For each: report renders, fix cards make sense, "Fix all" CTA flows through sign-up cleanly, resume + checklist visible in editor afterward.

## 10. Rollout

### 10.1 Internal dogfood
- @jai0651 runs the route on staging for 3-5 days against personal resumes.
- Tune the LLM fix prompt based on outputs.
- Confirm the editor's checklist surface looks coherent.

### 10.2 Feature flag
`FREE_SCORE_ENABLED` (default true at merge to main). Allows quick off-switch if LLM cost spikes unexpectedly or if a parsing pathology causes 5xx storms.

### 10.3 Cost monitoring
Daily summary in admin route:
- Anonymous scores per day.
- Avg LLM tokens per fix-list generation.
- Conversion rate (`score_completed` → `score_to_signup`).
- Rate-limit hits per day.

If LLM cost per score exceeds an internal budget (suggest: $0.05/score initial cap), tighten the prompt or switch to a cheaper model for fix generation.

## 11. Open Questions
1. **DOCX rendering parity.** If a user's DOCX uses unusual styling, our parser extracts plain text and we score the text. The user may be surprised that "formatting" dimension scores well even if their DOCX looks ugly in Word. Probably fine — we score what parsers see, not what humans see. Document this on the privacy line.
2. **Image-only PDF UX.** When a resume is image-only (scanned), we currently return 422. Should we OCR? OCR is expensive and slow. Defer; surface the limitation in the error message clearly.
3. **JD parser performance on short JDs.** `services/jdParser.ts` is built for real JDs. If the user pastes "Software Engineer" we should not blow up. Add an input guard: JD must be ≥ 200 chars to be considered; below that, treat as no-JD.
4. **Should the report show the user's parsed structured resume?** Showing it would help users verify parse fidelity. Risk: it leaks PII into the report HTML (already visible only to that user). Recommendation: yes, with a small "We parsed your resume — preview" expandable section.
5. **`ExtensionEvent` rename.** This phase wants to rename to `ProductEvent`. If extension Phase 1 has already shipped with `ExtensionEvent`, do a migration that renames the table and adds the `surface` column. Either order works; coordinate with whoever ships first.
6. **Embedding-based fix generation.** The free-checker fix generation could use embeddings to surface JD-keyword gaps even without an LLM call. Punt — LLM-driven fixes are higher quality and the cost is acceptable at expected scale. Revisit if cost data says otherwise.

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| LLM produces vague advice ("use stronger verbs") | High | High | Prompt explicitly bans vague advice. Schema requires `before` (if applicable) and `after` to be concrete strings. Manual review of 20 sample reports before launch. |
| LLM cost balloons under viral traffic | Medium | High | Per-IP rate limit + global daily cap. Feature flag for emergency off-switch. Cost monitoring dashboard daily. |
| Parsed resume fidelity is poor on certain templates | Medium | Medium | We surface the parsed preview (Open Question 4). User can edit in the builder after conversion. Future work could add template-aware parsing. |
| Privacy claim drifts from reality | Low | High | Code review checklist: any change to the anonymous route must justify any persistence. Audit log for `/api/score/*` reviewed periodically. |
| Token leak via referer headers | Low | Medium | Token is in URL only briefly during sign-up redirect. Server consumes it immediately. Single-use limits exposure. Consider `Referrer-Policy: no-referrer` on the sign-up page. |
| `pdf-parse` chokes on certain PDFs | Medium | Medium | Wrap in try/catch; return 422 with structured reason. Add fixture for the failing PDF to regression set. |
| Free checker cannibalizes paid usage | Low | Low | The free checker reports + onboards into the same builder that paid features run inside. Conversion is the goal, not protection. |
| Image-only PDFs frustrate users | Medium | Low | Clear error message. OCR is a future enhancement. |
| Rate-limit caps too aggressive, blocks legit users | Medium | Low | Configurable via env. Start at 5/IP/hr; loosen if dogfood feedback shows it's punishing. |

## 13. References
- [resume-builder-experience-plan.md](./resume-builder-experience-plan.md)
- [builder-phase-2-template-system-spec.md](./builder-phase-2-template-system-spec.md)
- [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) §6.4.6 — consumes the `JDFitReport` shape defined here
- Existing code: `src/services/atsScorer.ts`, `src/services/jdParser.ts`, `src/lib/pdfParser.ts`, `src/lib/resumeParser.ts`, `src/lib/rateLimit.ts`, `src/app/api/resume-import/route.ts`
- `pdf-parse` (already in deps), `mammoth` (new)
- Upstash Ratelimit: https://upstash.com/docs/redis/sdks/ratelimit-ts
