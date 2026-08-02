# Implementation 03 — Parallel Build Orchestration

> **Status:** `Active` · **Owner:** the orchestrator (main session) · **Started:** 2026-08-01
> **Live progress:** the session task list + [`BUILD-LOG.md`](BUILD-LOG.md)

---

## 1. Why this document exists

The instinct to "run five feature agents in parallel" is right about the goal and wrong about the unit of parallelism. Two things break naive parallelism on this repo:

**Dependency reality.** Phase 0 is a hard gate — the job runner, the AI helper, and the design patterns are imported by every feature phase. Five agents building features simultaneously would each invent their own job runner. Phase 1 (the `Win` model) is a second gate: capture, ritual, packet, and backfill all import it.

**File contention.** Every phase wants to edit `prisma/schema.prisma`, `src/lib/config.ts`, `src/app/globals.css`, and `package.json`. Concurrent agents produce merge conflicts in exactly the files where a bad merge is silently destructive.

So parallelism happens **within a wave**, on **disjoint file sets**, with the orchestrator owning every shared file.

---

## 2. The rule set

1. **Shared files have exactly one owner: the orchestrator.**
   `prisma/schema.prisma` · `package.json` / `bun.lock` · `docs/**`
   No agent edits these. Ever. If an agent needs a model or a dependency, it stops and reports; the orchestrator lands it.
2. **Each agent owns a disjoint directory subtree** and touches nothing outside it. The subtree is stated in the brief and is enforced at review.
3. **Schema lands before the wave starts.** The orchestrator writes every model the wave needs, runs `prisma generate`, and agents code against generated types.
4. **Agents write tests for their own unit.** Integration tests that need a live DB are stubbed with a `describe.skip` and a `// TODO(db)` marker, listed in the agent's report.
5. **Every agent reports in a fixed format** (§6) so integration is mechanical.
6. **The orchestrator integrates.** Agents never merge each other's work.
7. **Nothing is "done" until the orchestrator has read the diff.** Agent self-reports are claims, not verification.

---

## 3. Dependency graph

```
                        ┌──────────────────────────────┐
   WAVE A (parallel×5)  │ A1 jobs  A2 ai  A3 theme      │
                        │ A4 components  A5 email       │
                        └───────────────┬──────────────┘
                                        │  + A6 embeddings (needs DB)
                                        ▼
   WAVE B (parallel×2)  ┌──────────────────────────────┐
                        │ B1 Win graph+actions          │   ← the second gate
                        │ B2 Log UI (on fixtures)       │
                        └───────────────┬──────────────┘
                                        ▼
   WAVE C (parallel×4)  ┌──────────────────────────────────────────────┐
                        │ C1 GitHub capture   C2 Review packet          │
                        │ C3 Backfill agent   C4 Packaging/paywalls     │
                        └───────────────┬──────────────────────────────┘
                                        ▼
   WAVE D (parallel×2)  ┌──────────────────────────────┐
                        │ D1 Weekly ritual  D2 MiR      │   (D1 needs C1 for content)
                        └──────────────────────────────┘
```

**Wave C is where the parallelism actually pays.** Four independent features, ~28 engineer-days of work, on four disjoint subtrees. That's the compression that matters; Wave A is a smaller win but it de-risks everything downstream.

---

## 4. Wave A — briefs

Schema landed by the orchestrator before spawn: `Job`, `EmailSend`, `EmailPreference`, `FeatureFlag`, `Win`, `WeeklyDigest` + enums.

| Agent | Owns (exclusive) | Deliverable | Spec |
|---|---|---|---|
| **A1 · jobs** | `src/lib/jobs/**`, `src/app/api/cron/**`, `vercel.json` | Job runner: enqueue/claim/drain/backoff/recovery, cron tick with bounded drain + self-retrigger | impl/00 §ADR-1,2,P-1,P-2 · impl/01 P0.2 |
| **A2 · ai** | `src/lib/ai/**`, `src/lib/config.ts` | `generateStructured()` + the numeric guard + task/feature keys + the table-driven guard suite | impl/00 §ADR-6 · impl/01 P0.4 |
| **A3 · theme** | `src/app/globals.css`, `src/app/layout.tsx`, `next.config.*` | Light mode, `.surface-work`, `next/font`, density + semantic tokens, light-mode audit report | design/00 §1,3,4,5,6,11 |
| **A4 · components** | `src/components/patterns/**`, `src/app/dev/patterns/**` | 6 patterns + 5 atoms + `/dev/patterns` in both themes | design/01 (entire) |
| **A5 · email** | `src/lib/email/**`, `src/app/api/email/**`, `src/app/e/**` | `sendEmail()`, layout shell, transactional template, unsubscribe, webhook | impl/00 §ADR-4 · impl/01 P0.3 |

**A3 / A4 boundary:** A3 owns tokens and global CSS; A4 owns components and consumes tokens. A4 must not add a token; if one is missing it reports.

**Deferred to a DB-live moment:** A6 (embedding dimension cutover, P0.6) — the eval script needs Qdrant and Postgres. Scripted now, run later.

---

## 4b. Wave B — briefs (prepared; fires after the Wave A gate)

Two agents, and they have a genuine dependency: B2 renders what B1 returns. The trick that makes them parallel:

> **The orchestrator writes the contract first.** Before spawning, I land `src/actions/wins.types.ts` — every action signature, input type, return type, filter shape, and cursor-page envelope, with no implementation. B1 implements against it. B2 renders against it with a fixture factory. Neither waits for the other, and integration is a type-check.

This pattern generalizes: **whenever a data layer and its UI can be specified before either is written, they parallelize.** Where the contract is genuinely unknowable in advance, sequence instead — don't guess.

| Agent | Owns (exclusive) | Deliverable | Spec |
|---|---|---|---|
| **B1 · win-graph** | `src/services/winGraph.ts`, `src/services/winDrafting.ts`, `src/actions/wins.ts`, `src/lib/graph/visibility.ts`, `src/lib/jobs/handlers/embedWin.ts` | Confirm/un-confirm transaction, `structureWin`, the eight server actions, sensitivity filters, employer resolution | PRD 01 §7, §8.1, §9.1 · impl/02 Phase 1 tasks 1.1–1.4 |
| **B2 · log-ui** | `src/app/(app)/log/**`, `src/components/log/**` | Log surface, review-queue block, filters, rail, Win drawer, quick capture | design/02 §B, C, D · PRD 01 §6 |

**B1 writes the three thesis tests first**, before the implementation they protect. They are the phase gate.
**B2 builds entirely on a fixture factory** — no live data, no DB. It must run correctly at `/dev/patterns`-style fidelity before B1 lands.

## 4c. Wave C — briefs (prepared; needs schema landed first)

Four genuinely independent features on four disjoint subtrees. **This is where the parallelism pays** — roughly 28 engineer-days compressed into one wave.

Orchestrator lands before spawn: `CaptureSource` / `CaptureSignal` / `CaptureRun`, `CompetencyFramework` / `ReviewPacket`, `InterviewSession` + their enums, and the `wins.types.ts`-style contracts each agent consumes.

| Agent | Owns (exclusive) | Deliverable | Spec |
|---|---|---|---|
| **C1 · capture** | `src/lib/capture/**`, `src/lib/jobs/handlers/capture*.ts`, `src/app/(app)/settings/sources/**`, onboarding steps | Adapter framework + GitHub connector + drafting + consent/repo-picker + the 200-PR fixture eval | PRD 02 (entire) · design/02 §A, J1 |
| **C2 · packet** | `src/workflows/reviewPacket.ts`, `src/services/reviewPacket.ts`, `src/services/competency.ts`, `src/app/(app)/packets/**` | Packet workflow, rubric ingestion, editor, export, readiness report | PRD 03 (entire) · design/02 §F, G, H |
| **C3 · backfill** | `src/agents/backfillAgent.ts`, `src/agents/tools/backfill.ts`, `src/app/(app)/log/backfill/**` | Interview agent, six tools, split-view chat, close screen | PRD 07 (entire) · design/02 §I |
| **C4 · packaging** | `src/lib/plans.ts`, `src/components/paywall/**`, `src/app/(app)/settings/plan/**`, entitlements extension | Plan catalog, `hasFeature`, `refundMeteredAction`, Stripe wiring, PW1–PW7 | PRD 06 (entire) · design/02 §J3 |

**Contention watch:** C1 and C2 both add job handlers; C4 extends `src/lib/entitlements.ts` while C1/C2/C3 *call* it. Rule: **C4 owns `entitlements.ts`; the others import it and report any gate they need.** Handler files are one-per-feature and namespaced, so `src/lib/jobs/handlers/` stays conflict-free as long as nobody edits `registry.ts` — the orchestrator wires registration.

## 5. Agent brief template

Every spawn uses this shape. Ambiguity here is what produces rework.

```
ROLE      Senior engineer on the Patronus Career OS build.
CONTEXT   Read docs/impl/00-architecture-decisions.md first. Then <your spec>.
SCOPE     You own exactly: <paths>. Do not create or modify any file outside it.
FORBIDDEN prisma/schema.prisma, package.json, bun.lock, docs/**, and any path
          owned by another agent. If you need a schema change or a dependency,
          STOP and report it — do not work around it.
DB        The database is unreachable in this environment. Do not run prisma
          migrate or any command that connects. `bunx prisma generate` works and
          the client types are current — code against them.
BUILD     `bun run lint` and `bunx tsc --noEmit` must pass. `bun test <your dir>`
          must pass. Do not run the dev server.
TESTS     Unit-test your own logic. Integration tests needing a live DB: write
          them as `describe.skip` with a `// TODO(db):` comment and list them.
DONE      Report in the §6 format. Do not commit. Do not touch git.
```

---

## 6. Agent report format

```
## <agent id> — <status: complete | blocked | partial>

FILES CREATED     path — one line each
FILES MODIFIED    path — what changed
DEPENDENCIES      any package/schema/token you needed and could not add
DEVIATIONS        anything you did differently from the spec, and why
TESTS             what passes, what is skipped and why
TODO(db)          integration tests awaiting a live database
RISKS             what the orchestrator should look at closely in review
```

---

## 7. Integration protocol (orchestrator, after each wave)

1. `bunx tsc --noEmit` across the whole repo — cross-agent type breaks surface here first.
2. `bun run lint`.
3. `bun test` — full suite, not per-directory.
4. Read every diff. Specifically check: no agent touched a forbidden path (`git status` diffed against the ownership map), no duplicated utility, no second copy of an existing helper, no hardcoded model ID, no direct OpenAI import outside `src/lib/ai/`.
5. Land any dependency or schema change the agents reported.
6. Update `BUILD-LOG.md` and the task list.
7. Only then spawn the next wave.

**The grep gates**, run at every integration. Quote the `--include` globs — zsh eats them unquoted and the gate silently reports nothing:

```bash
# 1 · model ids at call sites
grep -rn "gpt-[0-9]" src --include="*.ts" --include="*.tsx" \
  | grep -v "lib/config.ts\|lib/usageTracker.ts\|lib/ai/tasks.ts\|test"

# 2 · ANY unguarded model call. Widened after C3 found that the original
#     pattern missed generateText + aiOpenAI(), which is how resumeAgent.ts
#     bypasses the numeric guard entirely.
grep -rnE "from 'openai'|generateObject|streamObject|generateText|streamText|aiOpenAI\(" src \
  --include="*.ts" --include="*.tsx" | grep -v "^src/lib/ai/" | grep -v "^src/lib/aiProvider.ts"

# 3 · raw Tier enum in UI
grep -rn "Tier\.\(free\|always_on\|pro\|team\)" src/components src/app | grep -v plans.ts

# 4 · blur on work surfaces
grep -rn "backdrop-blur" src/components/patterns src/components/log

# 5 · ring-based focus on .surface-work (silently erased — a11y failure)
grep -rn "surface-work" src/components | grep -E "ring-2|ring-ring"
```

**Gate 0 — does a clean checkout compile?** Run this *before* the others, because everything below it type-checks the working tree, and a green working tree says nothing about what a clone gets:

```bash
TMP=$(mktemp -d); git archive HEAD | tar -x -C "$TMP"
ln -s "$PWD/node_modules" "$TMP/node_modules"
(cd "$TMP" && bunx tsc --noEmit 2>&1 | grep -E "error TS" | grep -v "^extension/")
```

**This gate was missing for four waves and the tree was unbuildable the whole time.** `src/lib/groundState.ts` was imported by committed code from Wave A onward and never added; `src/services/claimGrounding.ts` the same from Wave C. Every gate passed, every suite was green, and nobody could have cloned the repo and built it. The failure mode is specific to this workflow: agents create files, the orchestrator stages a hand-written path list, and anything omitted stays invisible because it is still sitting in the working tree.

Cheaper partial check when a full extract is overkill — every untracked file that committed code imports:
```bash
git status --short | grep '^??' | awk '{print $2}' | while read -r f; do
  base=$(basename "$f" | sed 's/\.[tj]sx\?$//')
  git grep -l "/$base'" HEAD -- 'src/*' >/dev/null 2>&1 && echo "UNCOMMITTED BUT IMPORTED: $f"
done
```

**Gate 2's history is the lesson:** it passed clean through two full waves while `resumeAgent.ts` sat there calling the model directly. A gate that only checks the pattern you happened to think of is a gate that reports success. When an agent reports a rule violation the gate missed, widen the gate in the same pass.

---

## 8. Current blockers

| # | Blocker | Impact | Needs |
|---|---|---|---|
| **B-1** | **Database unreachable** — `P1001` at `db.ptwjffeclkmfbxtvdlyx.supabase.co:5432`. Supabase free-tier projects pause after ~7 days idle. | Cannot apply migrations, run integration tests, or do the embedding cutover (A6). Does **not** block Wave A coding. | Owner: unpause the Supabase project (or supply a working `DATABASE_URL`). |
| **B-2** | **Dirty tree** — 16 modified files on `browser-attension`, plus the untracked, never-applied migration `20260704120000_v2_context_graph_billing`. | Every later failure becomes ambiguous. Agent diffs get mixed with pre-existing changes. | Owner: land or park the in-flight work; then apply the migration. |

**Working around both:** Wave A is scoped to new files in new directories, so agent diffs stay separable from the 16 modified files, and none of the five tracks needs a live DB to build or unit-test.

---

## 9. Progress ledger

Live status lives in the session task list. [`BUILD-LOG.md`](BUILD-LOG.md) is the durable record: one entry per wave with what landed, what deviated, what's outstanding, and the integration gate results.
