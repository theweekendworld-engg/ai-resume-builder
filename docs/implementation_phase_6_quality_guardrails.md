# Implementation: Phase 6 Quality Guardrails

## Scope Completed (Only Phase 6)

This implementation covers Phase 6 only:

1. Auto ATS scoring and low-score improvement retry.
2. Stronger truth enforcement (traceability + metric validation).
3. User generation preferences and preference-aware pipeline behavior.

## What Was Implemented

### 1) User Preferences Foundation

Added:

- `src/lib/userPreferences.ts`

Includes:

- Typed preference schema with defaults:
  - `defaultTemplate`
  - `defaultSectionOrder`
  - `maxProjects`
  - `includeOSS`
  - `tonePreference`
  - `autoGenerate`
- Safe parsing and normalization for section order.

### 2) Profile Preferences Integration

Updated:

- `src/actions/profile.ts`
- `src/components/dashboard/ProfilePanel.tsx`

Behavior changes:

1. Profile reads now return normalized preferences.
2. Profile saves now persist normalized preferences to `UserProfile.preferences`.
3. Added `updateUserPreferences(...)` action for focused preference updates.
4. Dashboard profile UI now supports editing generation preferences.

### 3) Preference-Aware Smart Generation

Updated:

- `src/actions/generateResume.ts`

Pipeline now uses preferences to control generation:

- `maxProjects` drives project selection limit (unless explicitly overridden).
- `includeOSS` toggles OSS contribution retrieval in semantic matching.
- `tonePreference` is injected into paraphrasing instructions.
- `defaultSectionOrder` is applied to final resume assembly.

### 4) Truth Enforcement Guardrails

Updated:

- `src/actions/generateResume.ts`

Enhancements:

1. Numeric claim validation:
   - Any metric (e.g. `40%`, `2x`, `15`) in generated claims must exist in source corpus.
   - Claims with unsupported metrics are rejected as unsupported.

2. Strict unsupported-claim sanitization:
   - Unsupported claim lines are removed without fallback to original unsupported text.

3. Coverage gating:
   - Generation fails if traceable claim coverage drops below 50%.

These enforce the Phase 6 truth requirements and prevent low-traceability outputs from being accepted.

### 5) Auto ATS Scoring + Retry Path

Updated:

- `src/actions/generateResume.ts`

Behavior:

1. After truth validation, resume is scored via ATS scoring action.
2. If ATS score is below 70:
   - A constrained improvement pass runs (skills re-optimization using only source-backed JD terms).
   - ATS is re-scored.
   - Improved version is adopted only when score does not regress and truth coverage remains valid.
3. If ATS API scoring fails, deterministic estimate fallback is used.

### 6) Clarification Flow Preference Enforcement

Updated:

- `src/actions/clarify.ts`
- `src/actions/channelGenerate.ts`

Behavior:

- If `autoGenerate` preference is enabled, clarification questions are skipped and generation proceeds directly.
- If disabled, current clarification behavior remains unchanged.

### 7) Plan Status Update

Updated:

- `plan.md`

Marked Phase 6 checklist item as complete.

## Files Added/Changed

Added:

- `src/lib/userPreferences.ts`
- `implementation_phase_6_quality_guardrails.md`

Changed:

- `src/actions/generateResume.ts`
- `src/actions/profile.ts`
- `src/components/dashboard/ProfilePanel.tsx`
- `src/actions/clarify.ts`
- `src/actions/channelGenerate.ts`
- `plan.md`

## Notes

- This work stays within Phase 6 scope.
- No Phase 7 usage/cost logging or admin dashboard functionality is included.
- No Phase 8 pipeline checkpoint/persistent artifact changes are included.
