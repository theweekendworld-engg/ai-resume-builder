# Implementation: Phase 7 Admin Dashboard and Usage Tracking

## Scope Completed (Only Phase 7)

This implementation covers Phase 7 only:

1. Admin-only dashboard with Next.js + Clerk authentication guardrails.
2. API usage logging for OpenAI/embeddings/semantic search/LaTeX compile.
3. Per-user usage limits and billing-ready monthly usage summaries.

## What Was Implemented

### 1) Prisma Data Model for Usage and Billing

Added to Prisma schema and migration:

- `ApiUsageLog`
- `UserUsageSummary`

These capture per-call telemetry (`operation`, `provider`, `model`, tokens, cost, latency, status, metadata) and monthly per-user rollups for billing (`totalTokens`, `totalCostUsd`, `totalGenerations`, `totalPdfs`, `breakdown`).

Files:

- `prisma/schema.prisma`
- `prisma/migrations/20260228220000_phase7_admin_usage_tracking/migration.sql`

### 2) Central Usage Tracker Wrapper

Added:

- `src/lib/usageTracker.ts`

Capabilities:

1. `trackedChatCompletion(...)` for OpenAI chat completions with automatic usage logging.
2. `trackedEmbeddingCreate(...)` for embedding calls with automatic usage logging.
3. Cost calculation (`calculateOpenAiCostUsd`) with model pricing map.
4. Per-user monthly guardrails (`enforceUsageLimit`) using env-configured token/cost limits.
5. Log utility (`logUsageEvent`) for non-token operations.
6. Billing summary aggregation:
   - `upsertUserUsageSummary(...)`
   - `upsertAllUserUsageSummaries(...)`

### 3) Refactor Existing AI/Embedding Call Sites to Be Tracked

Updated AI, copilot, and generation pipelines to use tracked wrappers so usage is captured consistently:

- `src/actions/ai.ts`
- `src/actions/copilot.ts`
- `src/actions/generateResume.ts`
- `src/actions/embed.ts`

Coverage now includes:

- JD parsing
- ATS scoring
- resume assembly / tailoring
- paraphrasing
- keyword extraction
- section/latex transformations
- embedding generation
- semantic vector search (Qdrant latency/result count)
- LaTeX compile latency/success/failure

Session propagation was also added where available in multi-step generation flows.

### 4) Admin Access Control (Route + Server)

Added admin auth helpers:

- `src/lib/adminAuth.ts`

Updated middleware route guard:

- `src/proxy.ts`

Behavior:

1. `/admin` and `/admin/*` require signed-in user.
2. Access is restricted to user IDs listed in `ADMIN_USER_IDS`.
3. Server actions/pages also validate admin permissions (defense-in-depth).

### 5) Admin Dashboard and Per-User Drilldown

Added admin actions:

- `src/actions/admin.ts`

Added pages:

- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/admin/[userId]/page.tsx`

Features delivered:

- Aggregated usage (today/week/month)
- Operation-level cost/token/latency breakdown
- Generation success/failure metrics
- Top users by monthly usage cost
- Per-user details: summary, limits utilization, operation breakdown, daily trend, recent logs
- Manual summary refresh action for current billing period

Dashboard discoverability:

- `src/app/(app)/dashboard/page.tsx` now shows Admin link for admin users.

### 6) Config / Environment Updates

Updated:

- `env.example`

Added vars:

- `ADMIN_USER_IDS`
- `USAGE_MAX_MONTHLY_TOKENS_PER_USER`
- `USAGE_MAX_MONTHLY_COST_USD_PER_USER`
- `OPENAI_EMBEDDING_SIZE`

### 7) Plan Status Update

Updated:

- `plan.md`

All three Phase 7 checklist items are marked complete.

## Validation Performed

1. `bun run lint` (passes; only existing unrelated warnings remain).
2. `bunx tsc --noEmit` (passes).

## Files Added/Changed

Added:

- `src/lib/usageTracker.ts`
- `src/lib/adminAuth.ts`
- `src/actions/admin.ts`
- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/admin/[userId]/page.tsx`
- `prisma/migrations/20260228220000_phase7_admin_usage_tracking/migration.sql`
- `implementation_phase_7_admin_dashboard_usage_tracking.md`

Changed:

- `prisma/schema.prisma`
- `src/actions/ai.ts`
- `src/actions/copilot.ts`
- `src/actions/generateResume.ts`
- `src/actions/embed.ts`
- `src/actions/channelGenerate.ts`
- `src/actions/clarify.ts`
- `src/app/(app)/dashboard/page.tsx`
- `src/proxy.ts`
- `env.example`
- `plan.md`

## Notes

- This work intentionally stays in Phase 7 scope.
- Phase 8 checkpoint persistence, blob PDF storage, and resume reuse logic were not implemented here.
