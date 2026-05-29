# Phase 3 — Application Tracking (Feature Spec)

## Header

| | |
| --- | --- |
| Status | Proposed, blocked on Phase 2 |
| Owner | @jai0651 |
| Last updated | 2026-05-29 |
| Parent plan | [one-stop-platform-plan.md](./one-stop-platform-plan.md) |
| Predecessor | [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md) |
| Successor | Wave 4 (discovery) — outlined in parent plan |
| Target duration | ~7 working days |

## 1. Problem Statement
After Phase 2, the extension is a real co-pilot: polished UI, smart field matching, corrections memory, in-place tailoring. But applications still go into a black hole after the user clicks submit. There is no canonical inbox showing "everything I've applied to", no automatic status detection, no way to differentiate a workspace that's a draft from one already submitted, and no graceful handling of the inevitable ghosted applications.

The user's success metric of "80% manual effort reduction" includes not retyping data **and** not having to manually track what they sent. A spreadsheet kept by hand is not part of the one-stop promise.

Phase 3 turns `ApplicationWorkspace` into a tracked artifact with a real lifecycle and gives the user a single inbox to see everything.

## 2. Goals
1. Add a status state machine to `ApplicationWorkspace` with a clear set of states and transitions.
2. Detect application submission heuristically and auto-flip workspaces from `in_progress` to `submitted` without user action in ≥ 80% of supported-platform cases.
3. Ship `/dashboard/applications` as the canonical inbox surface with filters, sort, bulk actions, and per-workspace detail.
4. Provide an activity timeline per workspace showing every meaningful event (parse, fill, draft, tailor, submit, status change).
5. Auto-suggest ghost status for workspaces submitted >30 days ago with no further activity, with one-click confirm.
6. Surface the inbox in the extension's Workspaces route, mirrored from the web app's data.

## 3. Non-Goals
- No Gmail integration. That was floated in the parent plan but requires Google verification (4-6 weeks) and is out of scope here.
- No external status API integrations (Greenhouse, Lever applicant tracking webhooks). Those are recipient-side, not applicant-side, and not accessible.
- No interview scheduling features.
- No offer comparison or salary negotiation tooling.
- No bulk import of historical applications from a CSV (could be added later).

## 4. Success Criteria
- [ ] `/dashboard/applications` lists all of a user's `ApplicationWorkspace` rows with status, last activity, platform, role, company.
- [ ] Status state machine enforced server-side: invalid transitions return 400.
- [ ] On three of the four supported platforms, navigating to a confirmation page after a real submission flips the workspace to `submitted` within 5 seconds.
- [ ] Each workspace has a visible activity timeline with at least: created, fills applied (rolled up per step), questions drafted (rolled up), resume tailored, submitted, status changed.
- [ ] Workspaces last-updated > 30 days ago and in `submitted` state appear in a "Likely ghosted" filter with a one-click "Mark ghosted" action.
- [ ] Extension Workspaces route shows the same data as the web inbox.
- [ ] Phase 0, Phase 1, Phase 2 tests still green.
- [ ] New tests cover: state-machine transitions, confirmation-page detector heuristics, ghost-suggestion query.

## 5. User-Facing Experience

### 5.1 Web app — /dashboard/applications
- Table view (or card grid; see UI section) of workspaces.
- Columns: company, role, platform, status, last activity, JD link, primary resume used.
- Filter bar: status (multi-select), platform (multi-select), date range, "Likely ghosted" toggle.
- Sort: last activity (default), created date, company A-Z, status.
- Search: substring match on company + role.
- Bulk actions: mark ghosted, archive, delete.
- Row click → workspace detail drawer.

### 5.2 Web app — workspace detail drawer
Right-side drawer (or full page; see UI section):
- Top: company, role, JD link, source platform.
- Status pill with a dropdown allowing manual change (with confirmation if the change is unusual, e.g. submitted → draft).
- Activity timeline (newest first).
- Resume used (link to editor).
- Saved answer drafts for this workspace.
- "Open original JD" button.
- "Delete workspace" tucked under a danger zone.

### 5.3 Confirmation-page detection (extension)
On any parse, if the page kind is `unknown` or `unsupported` but the URL or page text contains confirmation signals (see §6.3), the extension prompts:
```
[✓] Looks like your application was submitted at <Company>.
    [Mark submitted]  [Not now]
```
Clicking "Mark submitted" flips the bound workspace. "Not now" dismisses. A timer (10s) on the prompt collapses it into a small persistent indicator the user can re-open.

If the heuristic is confident enough (multiple signals + same-tab navigation from a known application page), the flip happens automatically with an undo toast.

### 5.4 Extension Workspaces route
A simplified inbox optimized for ~360px width:
- Vertical card list, newest-active first.
- Filters reduced to status pill row.
- Per-card: company, role, platform, status, "last activity X ago".
- Tap a card → opens the workspace's source URL in the active tab and side panel re-binds to it. If the URL is no longer reachable, opens the dashboard detail page in a new tab.

### 5.5 Ghost suggestions
Daily check (server-side cron or on-read computation) finds workspaces in `submitted` state with `lastActiveAt > 30d ago` and no recent timeline events. The dashboard surfaces a callout:
```
[i] 5 applications haven't moved in over a month.
    [Review and mark ghosted →]
```

## 6. Technical Design

### 6.1 Status state machine

#### 6.1.1 States
```ts
type WorkspaceStatus =
  | 'draft'           // workspace created but not submitted; default
  | 'in_progress'     // user has filled at least one field
  | 'submitted'       // user (or detector) confirmed application sent
  | 'in_review'       // optional user-set state for follow-up tracking
  | 'interview'       // user marked as having interview scheduled
  | 'offer'           // happy path
  | 'rejected'        // explicit rejection received (user marks)
  | 'ghosted'         // auto-suggested then user-confirmed
  | 'archived';       // user-archived, removed from default views
```

#### 6.1.2 Transition matrix
```
draft       -> in_progress, submitted, archived, deleted
in_progress -> submitted, draft, archived, deleted
submitted   -> in_review, interview, offer, rejected, ghosted, archived
in_review   -> interview, offer, rejected, ghosted, archived
interview   -> offer, rejected, ghosted, archived
offer       -> rejected (declined), archived
rejected    -> archived
ghosted     -> in_review, archived  (user might get a late response)
archived    -> draft, in_progress, submitted   (un-archive)
```

Invalid transitions return 400 with a structured error code `INVALID_TRANSITION`.

#### 6.1.3 Migration
Add `status WorkspaceStatus @default(draft)` to `ApplicationWorkspace`. Backfill existing rows:
- Rows with any prior fills or saved answers → `in_progress`.
- Rows with no activity at all → `draft`.
- Rows older than 30 days → `archived`.

Backfill is a single SQL migration script; no application logic depends on the backfill being instant, so it can run as a Prisma migration with raw SQL.

#### 6.1.4 Server enforcement
```ts
// src/lib/applicationWorkspace.ts
export const VALID_TRANSITIONS: Record<WorkspaceStatus, WorkspaceStatus[]> = { /* matrix above */ };

export function canTransition(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

A new helper `updateWorkspaceStatus(workspaceId, userId, to, reason)` wraps the transition with validation, writes a timeline event, and returns the updated row.

### 6.2 Activity timeline

#### 6.2.1 Storage
**Recommendation: separate table.** JSON-on-workspace works for Phase 2 (`activity` JSON), but query needs in Phase 3 (ghost detection scans recent activity) make a relational shape better.

```prisma
model WorkspaceActivity {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  type        WorkspaceActivityType
  payload     Json     @default("{}")
  occurredAt  DateTime @default(now())

  workspace   ApplicationWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, occurredAt])
  @@index([userId, occurredAt])
}

enum WorkspaceActivityType {
  workspace_created
  fills_applied
  fills_undone
  question_drafted
  question_inserted
  resume_tailored
  status_changed
  step_advanced
  submission_detected
  manual_note
}
```

#### 6.2.2 Write paths
- `workspace_created` — when orchestrate creates a workspace.
- `fills_applied` — batched per step; payload `{ stepIndex, count, semanticKeys }`.
- `fills_undone` — batched; payload `{ count }`.
- `question_drafted` — payload `{ questionId, typeHint, tone }`.
- `question_inserted` — payload `{ questionId, edited }`.
- `resume_tailored` — payload `{ resumeId, atsScore, generationSessionId }`.
- `status_changed` — payload `{ from, to, reason: 'user'|'auto'|'ghost-suggestion' }`.
- `step_advanced` — payload `{ stepIndex, stepLabel? }`.
- `submission_detected` — payload `{ signals: string[] }`.
- `manual_note` — payload `{ note: string }` for user-added notes.

#### 6.2.3 Migration from JSON
If Phase 2 stored `activity` as JSON on `ApplicationWorkspace`, migrate it to `WorkspaceActivity` rows during the same Prisma migration that adds the new table.

### 6.3 Confirmation-page detection

#### 6.3.1 Signals
Heuristic combines several signals; weights configurable:
- **URL signals** (path segments contain): `thanks`, `thank-you`, `submitted`, `confirmation`, `success`, `application-sent`, `apply/complete`. Weight: 0.5.
- **Heading signals** (top h1/h2 visible text contains): "thank you", "application received", "we received your application", "successfully submitted", "your application has been submitted". Weight: 0.6.
- **Page kind** is `unsupported` or `unknown` AND there is no form. Weight: 0.2.
- **Same-tab navigation** from a previously bound application session in the last 60s. Weight: 0.4.
- **Platform-specific selectors** matched (e.g. Workday's `[data-automation-id="successHeading"]`). Weight: 0.7.

Sum of weights. Thresholds:
- ≥ 0.9 → auto-flip with undo toast.
- ≥ 0.6 → prompt user with "Mark submitted" suggestion.
- < 0.6 → no action.

#### 6.3.2 Implementation
New module `extension/src/parsers/submissionDetector.ts`:
```ts
export function detectSubmission(input: {
  url: string;
  pageModel: NormalizedPageModel;
  session: ApplicationSession | null;
}): { confidence: number; signals: string[] };
```

Runs after every parse. The result is included in the orchestrate response so the side panel can act on it.

#### 6.3.3 Adapter overrides
Each platform adapter from Phase 1 may provide a `detectSubmissionSignals(doc): string[]` method that returns a list of triggered signals. Worker collects these.

### 6.4 Ghost detection

#### 6.4.1 Server query
A daily scheduled task (Vercel cron or worker if available) computes ghost candidates:
```sql
SELECT id, userId
FROM "ApplicationWorkspace"
WHERE status = 'submitted'
  AND "lastActiveAt" < NOW() - INTERVAL '30 days'
  AND id NOT IN (
    SELECT workspaceId FROM "WorkspaceActivity"
    WHERE "occurredAt" > NOW() - INTERVAL '30 days'
  )
LIMIT 1000;
```

For each, write a `WorkspaceActivity` with type `status_changed`, payload `{ from: 'submitted', to: 'ghost_suggested', reason: 'auto' }` — note this is a **soft suggestion**, not an actual status flip. The workspace status stays `submitted`.

A new column `ghostSuggestedAt DateTime?` on `ApplicationWorkspace` flags the suggestion so the UI can surface it. User confirmation moves it to `ghosted`; user dismissal clears `ghostSuggestedAt`.

#### 6.4.2 On-read alternative
If we do not have a scheduled task surface available, compute ghost candidates lazily when the inbox is loaded with the "Likely ghosted" filter on. Same query, just gated to the requesting user. Trade-off: slightly slower inbox load when the filter is active; no infrastructure to operate. **Recommendation: start with the on-read variant.** Move to scheduled if list grows large enough that on-read is slow (~thousands of workspaces per user — unlikely in v1).

### 6.5 Web inbox routes

#### 6.5.1 `GET /api/applications` (or `/api/v1/applications`)
List + filter. Query params: `status`, `platform`, `from`, `to`, `q`, `ghosted=true`, `cursor`, `limit`.

Response:
```ts
{
  items: Array<{
    id: string;
    company: string;
    role: string;
    platform: Platform;
    status: WorkspaceStatus;
    lastActiveAt: string;
    createdAt: string;
    sourceUrl: string;
    ghostSuggestedAt: string | null;
    resumeId: string | null;
  }>;
  nextCursor: string | null;
}
```

#### 6.5.2 `GET /api/applications/:id`
Workspace detail including timeline. Joins `WorkspaceActivity` (last 100 events).

#### 6.5.3 `PATCH /api/applications/:id`
Body:
```ts
{ status?: WorkspaceStatus; note?: string }
```
Validates transition. On success writes a `status_changed` activity event.

#### 6.5.4 `DELETE /api/applications/:id`
Soft delete: sets `archived = true` and `status = 'archived'`. Hard delete only via admin or per-user "purge archived".

#### 6.5.5 `POST /api/applications/bulk`
Body:
```ts
{ ids: string[]; action: 'archive'|'mark_ghosted'|'delete' }
```

### 6.6 Web inbox UI

#### 6.6.1 Page shape
`/dashboard/applications` — server component renders the shell, client component loads the filtered list.

Layout (desktop):
```
[Filters bar]                              [Search box]
+-----------------------------------------------------+
| Status | Platform | Date | Likely ghosted toggle    |
+-----------------------------------------------------+
| Company | Role | Platform | Status | Last Activity  |
+-----------------------------------------------------+
| ... rows ...                                        |
+-----------------------------------------------------+
[Bulk actions appear when rows selected]
```

Layout (mobile / narrow): vertical cards.

#### 6.6.2 Components
- `ApplicationsTable` — sortable, selectable rows, virtualized for >100 rows.
- `ApplicationFilters` — controlled component, state in URL query params.
- `ApplicationStatusPill` — shared with extension via design tokens.
- `ApplicationDrawer` — opens on row click, contains workspace detail.
- `WorkspaceTimeline` — newest-first list with icons per `WorkspaceActivityType`.
- `WorkspaceStatusEditor` — dropdown showing only valid transitions for current status.
- `GhostSuggestionBanner` — appears above the table when any rows have `ghostSuggestedAt`.

#### 6.6.3 Empty state
First-time user (zero workspaces):
```
You haven't applied to anything yet.
Install the Patronus Job Copilot extension and start applying — your work shows up here automatically.
[Install extension]  [Read quick start]
```

### 6.7 Extension Workspaces route updates

The Workspaces route from Phase 1 expands:
- Same filters as the web inbox (status + platform).
- Same status pill component.
- Tapping a row navigates the active tab to the source URL and re-binds the session.
- A "View all in dashboard" link opens the web inbox.
- A "Mark submitted" action available when status is `in_progress` (for users who want to confirm without relying on the detector).

## 7. Data Model Changes Summary

```prisma
// added
model WorkspaceActivity { /* see §6.2.1 */ }

enum WorkspaceActivityType { /* see §6.2.1 */ }

// modified
model ApplicationWorkspace {
  // ...existing fields
  status              WorkspaceStatus  @default(draft)  // new
  ghostSuggestedAt    DateTime?                         // new
  archived            Boolean          @default(false)  // ensure present
  activities          WorkspaceActivity[]               // relation
}

enum WorkspaceStatus { /* see §6.1.1 */ }
```

Three migrations:
1. Add `WorkspaceStatus` enum, `status`, `ghostSuggestedAt` columns; backfill `status` per §6.1.3.
2. Add `WorkspaceActivity` table + `WorkspaceActivityType` enum.
3. Backfill activity from any pre-existing `activity` JSON on workspace (drop the JSON column after backfill in a second migration once code paths are cut over).

## 8. API Routes Summary

| Route | Method | Purpose | Added in |
| --- | --- | --- | --- |
| `/api/applications` | GET | List/filter workspaces | Phase 3 |
| `/api/applications/:id` | GET | Workspace + timeline | Phase 3 |
| `/api/applications/:id` | PATCH | Status / note update | Phase 3 |
| `/api/applications/:id` | DELETE | Soft delete (archive) | Phase 3 |
| `/api/applications/bulk` | POST | Bulk actions | Phase 3 |
| `/api/extension/workspaces` | GET | Same as `/api/applications`, scoped for extension consumer | Phase 1 extended in Phase 3 |
| `/api/extension/workspaces/:id/status` | PATCH | Status change from extension | Phase 3 |

Permission model: all routes scoped by `userId` from auth (Clerk for web, extension token for extension).

## 9. Telemetry additions

```ts
| { type: 'workspace.status.changed'; from: WorkspaceStatus; to: WorkspaceStatus; reason: 'user'|'auto'|'ghost' }
| { type: 'workspace.submission.detected'; confidence: number; signals: string[]; outcome: 'auto-flipped'|'user-confirmed'|'user-dismissed' }
| { type: 'workspace.ghost.suggested'; ageDays: number }
| { type: 'workspace.ghost.confirmed'; ageDays: number }
| { type: 'inbox.opened' }
| { type: 'inbox.filter.applied'; filter: string }
| { type: 'inbox.bulk.action'; action: 'archive'|'mark_ghosted'|'delete'; count: number }
```

## 10. Implementation Plan

| # | Task | Est. | Depends on |
| --- | --- | --- | --- |
| T3.1 | Define `WorkspaceStatus` enum + transition matrix + helpers | 4h | Phase 2 done |
| T3.2 | Prisma migration: add status, ghostSuggestedAt, backfill | 4h | T3.1 |
| T3.3 | Prisma migration: add `WorkspaceActivity` table, backfill from JSON if present | 4h | T3.2 |
| T3.4 | Activity write helpers + integrate into existing flows (orchestrate, fills, tailor) | 1d | T3.3 |
| T3.5 | `submissionDetector.ts` module + adapter signal hooks | 1d | Phase 2 done |
| T3.6 | Wire detector into orchestrate response + side panel prompt UI | 4h | T3.5 |
| T3.7 | Auto-flip + undo toast logic in side panel | 4h | T3.6 |
| T3.8 | `GET/PATCH/DELETE /api/applications` + bulk route + tests | 1d | T3.4 |
| T3.9 | Inbox page: `ApplicationsTable`, `ApplicationFilters`, status pill | 1d | T3.8 |
| T3.10 | Inbox drawer: `ApplicationDrawer`, `WorkspaceTimeline`, status editor | 1d | T3.9 |
| T3.11 | Ghost detection on-read query + `GhostSuggestionBanner` | 4h | T3.8 |
| T3.12 | Extension Workspaces route updates (filters, status pill, mark submitted) | 4h | T3.7 |
| T3.13 | Telemetry events wired | 2h | T3.10, T3.12 |
| T3.14 | Manual QA: end-to-end loop submission detection on 3 platforms | 1d | T3.7, T3.10 |
| T3.15 | Update build status doc | 30m | T3.14 |

Total estimated effort: ~7 working days.

## 11. Testing Strategy

### 11.1 Unit
- `canTransition`: matrix verified against the spec in §6.1.2 with table-driven tests.
- `detectSubmission`: deterministic inputs (mock URLs + page models) produce expected confidence scores; edge cases for empty pages, multi-step apps.
- Adapter `detectSubmissionSignals`: per-platform fixtures with confirmation snapshots.
- `WorkspaceActivity` write helpers: assert payload shape per type.

### 11.2 Integration
- `/api/applications` filter combinations.
- `/api/applications/:id PATCH` rejects invalid transitions.
- Ghost detection query against a seeded test DB.

### 11.3 Manual QA (T3.14)
For each of 3 platforms:
- [ ] Reach a real confirmation page after a real submission.
- [ ] Within 5s, detector confidence ≥ 0.6 (prompt) or ≥ 0.9 (auto-flip).
- [ ] Workspace status visible as `submitted` in both web inbox and extension Workspaces route.
- [ ] Timeline event `submission_detected` recorded.
- [ ] Inbox filter "Submitted" shows the row.
- [ ] Seed a workspace `lastActiveAt - 45 days` with status `submitted`; "Likely ghosted" filter shows it; one-click confirm flips to `ghosted` and writes activity event.

## 12. Rollout

### 12.1 Migration order
Migrations 1 → 2 → 3 must run in order. Code that reads `activity` JSON must keep reading both the JSON column and the new table during the transition window. Cutover happens when migration 3 backfills and a follow-up migration drops the JSON column.

### 12.2 Feature flags
- `INBOX_ENABLED` (server) — controls whether `/dashboard/applications` is reachable. Default true at merge.
- `SUBMISSION_AUTO_FLIP_ENABLED` (extension config + server) — if false, detector still runs but only suggests, never auto-flips. Default true for `confidence >= 0.9`; if false-positives appear in dogfood, lower the threshold or flip this off without a deploy.
- `GHOST_SUGGESTIONS_ENABLED` — default true.

### 12.3 User communication
Brief in-app banner on first inbox load: "New: track all your applications in one place." Dismissible.

## 13. Open Questions
1. **Should `archived` be a separate state or a boolean orthogonal to status?** Argument for orthogonal: a user might archive a `rejected` workspace and want to see "rejected & archived" later. Argument for state: simpler state machine. **Lean orthogonal**: keep `archived Boolean @default(false)` separate from `WorkspaceStatus`. Update the matrix and §6.1.1 accordingly.
2. **Confidence threshold tuning.** 0.9 for auto-flip is a guess. Dogfood data should drive a tuning round before broader use.
3. **Timeline rollup granularity.** Rolling up "fills applied" per step is reasonable, but if a step has 30 fills, do we list every semanticKey? **Recommend: top 5 + "and 25 more"** for visual hygiene.
4. **Per-workspace notes.** The `manual_note` activity event supports notes but no UI exists for it in this phase. Consider whether to add a small note field on the drawer in Phase 3 or punt. **Lean: add a single text-area "Notes" on the drawer in Phase 3**; minimal cost.
5. **External calendar integration for interview state.** Skip in Phase 3; document as a future hook.
6. **Inbox export.** Some users will want CSV export for personal tracking. Skip in Phase 3 but the routes are designed to support it later trivially.

## 14. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Submission detector false positives flip workspaces incorrectly | High | Medium | Auto-flip threshold high (0.9). Undo toast for 30s. User can revert manually. Telemetry shows false-positive rate. |
| Submission detector false negatives (user submits, no flip) | High | Low | "Mark submitted" button in extension is one-click. Inbox status editor lets user fix any state. |
| Activity table grows large for power users | Low | Low | Index on `(workspaceId, occurredAt)` keeps drawer queries fast. Hard cap of 1000 events per workspace; older trimmed in a daily cleanup. |
| Migration backfill of `status` is wrong for some workspaces | Medium | Low | Backfill rules are conservative (`draft` is the default if any ambiguity). Users can fix individually. |
| `WorkspaceActivity` schema needs to evolve | Medium | Low | `payload Json` is intentionally schemaless. New event types only need an enum addition. |
| Extension Workspaces filter UI feels cramped at 360px | Medium | Low | Filter row uses horizontal scroll fallback. Two filters max (status + platform). |
| Ghost suggestion query is slow on a user with many workspaces | Low | Low | Index on `(userId, status, lastActiveAt)`. On-read variant only queries the requesting user. |
| Bulk delete is dangerous | Medium | High | Soft delete only via UI. Hard delete only via dedicated admin endpoint or per-user "purge archived" action with a confirmation modal. |

## 15. References
- [one-stop-platform-plan.md](./one-stop-platform-plan.md)
- [phase-2-smarter-brain-spec.md](./phase-2-smarter-brain-spec.md)
- [browser-extension-product-plan.md](./browser-extension-product-plan.md)
- Existing `ApplicationWorkspace` model in `prisma/schema.prisma`
