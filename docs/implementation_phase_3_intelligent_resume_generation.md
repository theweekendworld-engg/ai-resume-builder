# Implementation: Phase 3 Intelligent Resume Generation Pipeline

## Scope Completed (Only Phase 3)

This implementation covers Phase 3 only:

1. JD parser (structured extraction).
2. Semantic matching for projects/knowledge items from Qdrant with strict user isolation.
3. Static data loading from Postgres (profile, all experience, all education).
4. AI paraphrasing for summary and experience descriptions.
5. Smart resume assembly from structured user data.
6. Claim validation pass that verifies generated claims against source data.
7. One-click generate flow in editor wired to the new smart pipeline.

## What Was Implemented

### 1) New Smart Generation Action

Added:

- `src/actions/generateResume.ts`

Main exported action:

- `generateSmartResume(jobDescription, options?)`

Pipeline implemented in this action:

1. Parse JD into structured object (`role`, `company`, `requiredSkills`, `preferredSkills`, `experienceLevel`, `keyResponsibilities`, `industryDomain`).
2. Query Qdrant for dynamic content relevance:
   - `type=project`
   - knowledge types (`achievement`, `oss_contribution`, `certification`, `award`, `publication`, `custom`)
3. Enforce user isolation through `searchQdrantByUser` (always filtered by `userId`).
4. Load static data from Postgres:
   - `UserProfile`
   - all `UserExperience`
   - all `UserEducation`
5. Rank dynamic items with deterministic scoring combining:
   - semantic score
   - JD skill overlap
   - recency / quantified signal
6. Paraphrase static content with AI while preserving facts (summary + per-experience descriptions).
7. Assemble final `ResumeData` from profile + all static data + selected dynamic projects.
8. Run claim validation (token-overlap evidence mapping from output claim to source corpus).
9. Sanitize unsupported claims and return validated output.

### 2) JD Parsing + Cache

Implemented in `src/actions/generateResume.ts`:

- JD parser using OpenAI JSON output.
- Hash-based in-memory cache (`sha256(jobDescription)`) to avoid repeated parsing work for same JD during runtime.

### 3) Smart Selection

Implemented scoring utilities in `src/actions/generateResume.ts`:

- `scoreProject(...)`
- `scoreKnowledge(...)`

Ranking factors:

- vector relevance from Qdrant,
- overlap with parsed JD skills,
- additional weighting (project recency / quantified knowledge signal).

### 4) AI Paraphraser

Implemented function:

- `paraphraseStaticData(...)`

Behavior:

- Rewrites summary + experience descriptions to align with JD emphasis.
- Prompt explicitly forbids invented metrics, tools, projects, or claims.
- Returns structured JSON parsed with Zod validation.

### 5) Claim Validator

Implemented functions:

- `validateClaims(...)`
- `sanitizeUnsupportedClaims(...)`

Behavior:

- Builds source corpus from:
  - original experience data,
  - selected projects,
  - selected knowledge items,
  - profile summary.
- Verifies each generated claim line has evidence overlap with at least one source.
- Flags unsupported lines and removes them in sanitize pass.
- Returns validation metadata (`valid`, `coverageRate`, `unsupportedClaims`, `mappings`).

### 6) One-Click Generate UI Integration

Updated:

- `src/components/editor/JobTargetEditor.tsx`

Change:

- Replaced old `generateTailoredResume` call with `generateSmartResume`.
- Kept existing ATS scoring flow after generation (`calculateATSScore`).

Result:

- User can paste JD and click one button to get a smart-generated resume built from Phase 1/2 data foundation.

## Files Added/Changed

Added:

- `src/actions/generateResume.ts`
- `implementation_phase_3_intelligent_resume_generation.md`

Changed:

- `src/components/editor/JobTargetEditor.tsx`
- `plan.md` (Phase 3 checklist items marked done)

## Notes

- This work intentionally stays within Phase 3 scope.
- Later-phase items (clarification engine, channel APIs, usage/billing tracking, pipeline checkpoint persistence, blob storage reuse) were not implemented here.
