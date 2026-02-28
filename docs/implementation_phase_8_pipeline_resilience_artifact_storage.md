# Implementation: Phase 8 Pipeline Resilience and Artifact Storage

## Scope Completed (Only Phase 8)

This implementation covers Phase 8 only:

1. Pipeline state persistence with step-level checkpoints and failure metadata.
2. PDF artifact storage with feature flags (`local` or `blob` mode) and persistent metadata.
3. Smart resume reuse check before expensive generation work.

## What Was Implemented

### 1) Prisma Model + Enum Extensions for Checkpointed Sessions

Updated `GenerationSession` to store step-level state and outcomes:

- `currentStep`, `errorStep`, `errorMessage`
- checkpoint fields: `matchedProjects`, `matchedAchievements`, `staticData`, `paraphrasedContent`, `draftResume`, `validationResult`
- completion fields: `atsScore`, `pdfBlobKey`, `pdfUrl`, `startedAt`, `completedAt`, `totalLatencyMs`, `totalTokensUsed`, `totalCostUsd`

Added new enum:

- `PipelineStep`

Added new table:

- `GeneratedPdf` for stored artifacts (`blobKey`, `blobUrl`, `fileSizeBytes`, template, timestamps)

Files:

- `prisma/schema.prisma`
- `prisma/migrations/20260228232000_phase8_pipeline_resilience_artifact_storage/migration.sql`

### 2) Step-Checkpoint-Aware Smart Generation Pipeline

Extended smart generation to emit checkpoint callbacks per major step:

- `jd_parsing`
- `semantic_search`
- `static_data_load`
- `paraphrasing`
- `resume_assembly`
- `claim_validation`
- `ats_scoring`

Added:

- `generateSmartResumePipeline(...)` returning final result + full intermediate artifacts
- existing `generateSmartResume(...)` now wraps this and returns the legacy shape

File:

- `src/actions/generateResume.ts`

### 3) New Resilient Session Orchestrator

Added:

- `runGenerationSession(...)`
- `retryGenerationSession(sessionId)`

Behavior:

1. Starts from `GenerationSession.currentStep`.
2. Runs smart reuse check first (`reuse_check`).
3. Persists every checkpoint into session fields during generation callbacks.
4. On failure, records `status=failed`, `errorStep`, and `errorMessage`.
5. On completion, stores timing/cost/tokens summary for that session.

File:

- `src/actions/generationPipeline.ts`

### 4) Smart Resume Reuse

Implemented reuse gate before full generation:

- Reads user resumes with ATS score threshold
- Scores semantic overlap against incoming JD (role/company boost included)
- If match is strong, marks session complete without expensive regeneration
- Returns existing resume + stored PDF URL when available

Feature flags:

- `RESUME_REUSE_ENABLED`
- `RESUME_REUSE_MIN_ATS_SCORE`
- `RESUME_REUSE_SIMILARITY_THRESHOLD`

Files:

- `src/actions/generationPipeline.ts`
- `src/lib/config.ts`
- `env.example`

### 5) PDF Artifact Storage + Caching

Added storage service:

- `storePdfArtifact(...)` in `src/lib/pdfStorage.ts`

Modes:

- `PDF_STORAGE_MODE=local` (fully implemented, writes to filesystem)
- `PDF_STORAGE_MODE=blob` (guarded; requires provider integration)

Pipeline integration:

1. Compile LaTeX to PDF.
2. Store PDF artifact via storage service.
3. Persist `GeneratedPdf` row and link key/url in `GenerationSession`.
4. Keep only latest 3 stored PDFs per resume.
5. Track `pdf_storage` usage event.

Related updates:

- `compileLatex(...)` now accepts optional tracking context (`userId`, `sessionId`) for authenticated channel/background runs.

Files:

- `src/lib/pdfStorage.ts`
- `src/actions/generationPipeline.ts`
- `src/actions/ai.ts`

### 6) Channel Flow Wired to Resilient Pipeline

Updated channel generation flow to use the resilient session runner for final generation:

- session starts at `currentStep=reuse_check`
- clarification-complete path resets to `reuse_check` and runs resilient pipeline
- completed responses now include `pdfUrl`

File:

- `src/actions/channelGenerate.ts`

### 7) Retry API Endpoint

Added API endpoint to resume failed sessions:

- `POST /api/generate/retry` with `sessionId`

File:

- `src/app/api/generate/retry/route.ts`

### 8) Plan Status Update

Updated:

- `plan.md`

All Phase 8 checklist items are marked complete.

## Config Added

- `RESUME_REUSE_ENABLED`
- `RESUME_REUSE_MIN_ATS_SCORE`
- `RESUME_REUSE_SIMILARITY_THRESHOLD`
- `PDF_STORAGE_MODE`
- `PDF_STORAGE_LOCAL_DIR`
- `PDF_STORAGE_PUBLIC_BASE_URL`
- `PDF_STORAGE_ENABLE_FETCH`

## Files Added/Changed

Added:

- `prisma/migrations/20260228232000_phase8_pipeline_resilience_artifact_storage/migration.sql`
- `src/lib/pdfStorage.ts`
- `src/actions/generationPipeline.ts`
- `src/app/api/generate/retry/route.ts`
- `implementation_phase_8_pipeline_resilience_artifact_storage.md`

Changed:

- `prisma/schema.prisma`
- `src/actions/generateResume.ts`
- `src/actions/channelGenerate.ts`
- `src/actions/ai.ts`
- `src/lib/config.ts`
- `env.example`
- `plan.md`

## Notes

- Local PDF storage is fully functional behind feature flags.
- Blob mode is intentionally guarded until provider-specific upload wiring is configured.
- Retry now uses persisted session checkpoints and failure metadata to continue from known pipeline state.
