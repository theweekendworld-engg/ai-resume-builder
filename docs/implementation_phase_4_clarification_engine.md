# Implementation: Phase 4 Clarification Engine

## Scope Completed (Only Phase 4)

This implementation covers Phase 4 only:

1. Gap detection from JD requirements vs generated resume evidence.
2. Clarification question generation for detected gaps.
3. Session state persistence for clarification workflow.
4. Editor integration to collect answers and regenerate resume with clarifications.

## What Was Implemented

### 1) Session Persistence Model

Updated Prisma schema and migration:

- `prisma/schema.prisma`
- `prisma/migrations/20260228192000_phase4_clarification_engine/migration.sql`

Added:

- `GenerationStatus` enum (`pending`, `awaiting_clarification`, `generating`, `completed`, `failed`)
- `Channel` enum (`web`, `telegram`, `whatsapp`, `email`)
- `GenerationSession` model with persisted fields:
  - `userId`, `jobDescription`
  - `parsedJD`, `matchedItems`
  - `clarifications` (questions + answers + gaps)
  - `status`, `resultResumeId`, `channel`
  - timestamps + indexes

### 2) Clarification Engine Actions

Added:

- `src/actions/clarify.ts`

New server actions:

1. `startClarificationSession(...)`
   - Runs smart generation baseline.
   - Detects requirement gaps from parsed JD required skills.
   - Generates targeted clarification questions.
   - Persists a `GenerationSession` row.
   - Returns either:
     - `awaiting_clarification` + questions, or
     - `completed` + resume when no clarifications are needed.

2. `submitClarificationAnswers(...)`
   - Loads existing session and merges answers.
   - Updates session status to `generating`.
   - Appends verified user clarifications into generation context.
   - Regenerates smart resume with clarification context and focus areas.
   - Updates session status to `completed` (or `failed` on error).

### 3) Editor UI Integration

Updated:

- `src/components/editor/JobTargetEditor.tsx`

Behavior changes:

1. Clicking `Tailor Resume` now starts clarification flow first.
2. If gaps are found, inline questions are shown in the same panel.
3. User submits answers via `Generate With Clarifications`.
4. Final resume is generated and ATS score recalculated.

This preserves one-click behavior while adding a gated clarification step only when needed.

### 4) Plan Status Update

Updated:

- `plan.md`

Marked Phase 4 checklist item as complete.

## Files Added/Changed

Added:

- `src/actions/clarify.ts`
- `prisma/migrations/20260228192000_phase4_clarification_engine/migration.sql`
- `implementation_phase_4_clarification_engine.md`

Changed:

- `prisma/schema.prisma`
- `src/components/editor/JobTargetEditor.tsx`
- `plan.md`

## Notes

- This work stays within Phase 4 scope.
- Phase 5+ delivery channels and orchestration APIs are not implemented here.
