# Implementation: Phase 2 Smart Knowledge Base + Auto-Embed

## Scope Completed (Only Phase 2)

This implementation covers Phase 2 only:

1. Embedding service extraction (`embed.ts`).
2. Auto-embed pipeline for `UserProject` and `KnowledgeItem` create/update with stale vector cleanup.
3. GitHub import refactor to create `UserProject`, deduplicate by `githubUrl`, and auto-embed.
4. Re-embed utilities at item level for projects and knowledge items.

## What Was Implemented

### 1) Embedding Service

Added:

- `src/actions/embed.ts`

Capabilities:

- `generateEmbedding(text)`
- `upsertToQdrant(...)`
- `deleteFromQdrant(pointId)`
- `ensureKnowledgeBaseCollection()`
- Type-specific helpers:
  - `upsertProjectEmbedding(...)`
  - `upsertKnowledgeItemEmbedding(...)`
- Search helper:
  - `searchQdrantByUser(...)` (always filtered by `userId`, optional `type`)

Payload strategy now includes:

- `userId`
- `type`
- `sourceId`
- `title`
- `content`
- `createdAt`

### 2) Auto-Embed Pipeline

Updated:

- `src/actions/projects.ts`
- `src/actions/kb.ts`

Behavior:

- On `UserProject` create/update:
  - Save Postgres record first.
  - Embed and upsert into Qdrant.
  - Store `qdrantPointId`, set `embedded=true`.
  - On update, stale vector is deleted before inserting replacement.
- On `KnowledgeItem` create/update:
  - Postgres becomes source of truth.
  - Qdrant is derived index.
  - Same stale-delete and replacement strategy.
- On delete (project/knowledge item):
  - Best-effort vector deletion from Qdrant.

### 3) Knowledge Base Refactor

`src/actions/kb.ts` was refactored from direct vector-only storage to Postgres-backed storage:

- `saveToKnowledgeBase(...)` now writes `KnowledgeItem` + auto-embeds.
- `searchKnowledgeBase(...)` now searches Qdrant vectors filtered by current `userId`.
- Added CRUD utility actions:
  - `listKnowledgeItems`
  - `createKnowledgeItem`
  - `updateKnowledgeItem`
  - `deleteKnowledgeItem`

### 4) GitHub Import Refactor

Updated:

- `src/actions/github.ts`
- `src/components/editor/GitHubImport.tsx`
- `src/components/editor/ProjectsEditor.tsx`

New server action:

- `importGitHubRepoToLibrary(...)`

Flow:

1. Validate authenticated user.
2. Validate username against linked profile GitHub handle (`UserProfile.github`).
3. Deduplicate by `(userId, githubUrl)`.
4. Fetch README/languages/topics.
5. Create `UserProject` (`source='github'`) and auto-embed via project action.
6. Return dedup/created status and warnings.

UI updates:

- Both GitHub import surfaces now use the refactored import flow.
- Added user-facing note that imported summaries rely on README content when available.

### 5) Re-Embed Utility

Added granular re-embed actions (project/item-level):

- `reEmbedUserProject(projectId)` in `src/actions/projects.ts`
- `reEmbedKnowledgeItem(id)` in `src/actions/kb.ts`

## Validation Run

1. Typecheck: `bunx tsc --noEmit` (pass)
2. Lint: `bun run lint` (pass with pre-existing warnings only)

## Important Runtime Prerequisites

Phase 2 requires these env vars to be set:

- `OPENAI_API_KEY`
- `QDRANT_URL`
- optional: `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_SIZE`

## Notes For Future Phases

- Experience/Education remain non-embedded by design (Phase 2 requirement).
- Qdrant queries are user-isolated with mandatory `userId` filter.
- Broader bulk re-index orchestration can be added later; current utilities are intentionally granular to control token cost.
