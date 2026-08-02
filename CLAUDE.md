# Patronus — Career OS

The private, evidence-backed record of a user's working life. The job search is the highest-monetization event inside a relationship that never ends.

**Stack:** Next.js 16 (App Router) · React 19 · Bun · Prisma 6 / Postgres (Supabase) · Qdrant · Clerk · Stripe · Vercel Blob · Upstash · `workflow` SDK · AI SDK 6 + OpenAI · Tailwind 4 + Radix.

---

## Commands

```bash
bun run dev            # dev server — do not run this from an agent
bun run build          # prisma generate && next build
bun run lint
bunx tsc --noEmit
bun test               # full suite
bun test src/lib/ai    # a directory
bunx prisma generate   # works offline
bunx prisma validate
bunx prisma migrate status
bun run ext:build      # chrome extension
```

---

## The five rules

These get violated by default. They are enforced by grep gates at every integration (`docs/impl/03-orchestration.md` §7).

**1. No model IDs at call sites.** Every model resolves from the per-task map in `src/lib/config.ts`. `generateStructured({task: 'winDraft'})`, never `model: 'gpt-5'`.

**2. No direct model calls outside `src/lib/ai/`.** Every model call goes through `generateStructured()` so that validation, retry, cost logging, and the numeric guard happen once, consistently.

That means **all** of these, not just the obvious one: `import OpenAI from 'openai'`, `generateObject`, `streamObject`, `generateText`, `streamText`, and calling `aiOpenAI(...)` at a call site. The ESLint rule covers the first three; the gate below covers the rest.

```bash
grep -rnE "from 'openai'|generateObject|streamObject|generateText|streamText|aiOpenAI\(" src \
  --include="*.ts" --include="*.tsx" | grep -v "^src/lib/ai/" | grep -v "^src/lib/aiProvider.ts" \
  | grep -vE ":[0-9]+:import type "
```

**Known violations, all pre-dating the rule — do not copy these patterns:**
- `src/agents/resumeAgent.ts` — uses `generateText` + `aiOpenAI(config.openai.models.general)`. **No numeric guard, no per-feature cost tag, no retry policy.** Any new agent must follow `src/agents/tools/backfill.ts` instead, which keeps the module shape but routes generation through `generateStructured`.
- `src/lib/usageTracker.ts`, `src/lib/anonScore.ts` — grandfathered `openai` imports.

**3. Sensitivity is a query concern, never a prompt concern.** Any retrieval feeding an external artifact (resume, cover letter, apply answer) filters `sensitivity = 'shareable'` **in the database query**. Never instruct a model to skip confidential content — use `src/lib/graph/visibility.ts`. Tests assert the filter, not the output.

**4. No raw `Tier` enum in the UI.** Plan names, prices, and limits come from `src/lib/plans.ts` (`PLAN_CATALOG`). `Tier.always_on` displays as "Career", `Tier.pro` as "Search".

**5. Confirming a Win writes `Evidence(confirmedByUser=true)` + `ClaimLink(grounded)`.** That single transaction is simultaneously the retention loop and the moat. Any refactor that decouples them breaks the product thesis. Un-confirming must fully reverse it, including the Qdrant point.

---

## Before you commit

**Type-check a clean checkout, not the working tree.** They are different questions, and only one of them is what a clone gets.

```bash
TMP=$(mktemp -d); git archive HEAD | tar -x -C "$TMP"
ln -s "$PWD/node_modules" "$TMP/node_modules"
(cd "$TMP" && bunx tsc --noEmit | grep -v "^extension/")
```

Four waves shipped with the tree unbuildable because `groundState.ts` and `claimGrounding.ts` were imported by committed code and never added. `bunx tsc --noEmit` passed every time — it was reading files that existed locally and nowhere else.

## Invariants

- **Fail closed on truth.** A claim that cannot be positively grounded resolves to `needs_confirmation`, never `grounded`. Errors and timeouts resolve *down*.
- **No fabricated quantities.** No generated artifact may contain a number, scope, or outcome absent from its source. Enforced by the numeric guard in `src/lib/ai/guard.ts` plus per-feature eval corpora. Zero fabrications is the pass condition — not "low rate."
- **Handlers fan out, never loop.** A background handler that would process N users enqueues N child jobs and returns. Vercel's function timeout makes this mandatory, not stylistic.
- **Idempotency is a DB constraint.** `Job.dedupeKey`, `Win.signalId`, `WeeklyDigest(userId, weekStart)`, `CaptureSignal(sourceId, externalId)` are unique. Double-fired crons must be no-ops.
- **Never delete user records on downgrade.** Free-tier history is hidden, never removed. Copy must say so.

---

## Conventions

- **Server actions** (`src/actions/`): Clerk `auth()` → zod parse → `gateMeteredAction` once at entry → work → `FunnelEvent` → discriminated result from `src/lib/result.ts`. Never throw for expected failures.
- **Concurrency:** conditional `updateMany` (see `src/lib/entitlements.ts:226`). Don't introduce a second pattern.
- **Background work:** scheduled fan-out → `src/lib/jobs` (Postgres queue, one hourly cron). User-watched long runs → the `workflow` SDK (`src/workflows/`).
- **Design:** compose `src/components/ui/` primitives; higher-order patterns live in `src/components/patterns/`. Categories get icons, not colors. No `backdrop-blur` on scrolling lists.
- **Tests:** depth over coverage. The three thesis tests (evidence round-trip, sensitivity filter, no-fabrication) run in CI on every commit.

---

## Documentation map

| Path | What |
|---|---|
| `docs/career-os-v3.md` | Strategy — the thesis and why |
| `docs/prd/00-09` | Product specs. 00 is the index; 09 is the value model |
| `docs/impl/00` | Architecture decisions (ADRs) and shared primitives |
| `docs/impl/01` | Phase 0 foundation |
| `docs/impl/02` | Phased build plan for R1 |
| `docs/impl/03` | Parallel build orchestration and file ownership |
| `docs/impl/BUILD-LOG.md` | What actually landed, per wave |
| `docs/design/00-02` | Foundations, components, screens |

---

## Current state (2026-08-02)

**R1 is code-complete.** Waves A–D shipped: platform foundation, the Work Log, capture/packets/backfill/packaging, and the weekly ritual + Month in Review. Everything is behind feature flags, all seeded off.

- **Database:** local Docker Postgres (`resume_builder`), fully migrated. `.env` still points at a paused Supabase and the Prisma CLI reads `.env`, so CLI commands need an inline `DATABASE_URL`/`DIRECT_URL` override. `bun test` reads `.env.test` and is pinned to local.
- **Tests:** ~1225 pass, 0 fail. `bun run build` succeeds.
- **Mocks:** `src/__mocks__/` doubles every external boundary, each typed against the real SDK. Install via `installMocks({ only: [...] })`; the `only` list matters, since seams are module bindings shared across the whole Bun process.

**What is not proven, and cannot be from a sandbox** — see `docs/impl/04-test-strategy.md` §5 and the pre-launch checklist:
- No email has been seen in a real client.
- Rubric-parse accuracy, theme-grouping quality and backfill question quality are all validated against mocks, not live models.
- The GitHub `repo`-scoped OAuth token path has never returned a real token.

`prisma/schema.prisma`, `package.json`, and `docs/**` are orchestrator-owned during parallel builds. Feature agents must not edit them.
