# Scout — the link-in, answer-out agent

> Share any LinkedIn link (or post text) from the dashboard, Telegram or
> WhatsApp. Patronus works out what it is, and answers the questions a
> candidate would otherwise spend forty minutes and six tabs on.

Status: **phases 1–3 built**, 2026-09-23. Flag: `scout` (seeded off). See §7
for what shipped, what was verified live, and what was not.

---

## 1. What the user gets

| Input | Patronus returns |
|---|---|
| A LinkedIn **job** (`/jobs/view/…`, `?currentJobId=`) or any ATS link | Structured JD · fit against skills (current + past) and preferences · plain "why you're not a fit" when true · company size, funding, revenue band · SDE comp from public sources · remote/location · interview-experience links (Reddit, LeetCode, YouTube, GfG, Glassdoor) · who to network with · on request, a referral message / cold email |
| A **hiring post** ("we're hiring backend engineers, DM me") | Same as a job, with the poster as the first networking target |
| A **company-signal post** (funding, launch, expansion) | The companies named · open roles on their boards that match preferences · "add to Radar" |
| A **knowledge post** | Takeaways, saved to a reading shelf — **never** to the Work Log evidence graph |
| Anything else | An honest "this isn't something I can act on", no charge |

When the agent needs a fact only the user has (e.g. JD is onsite in Pune, the
user's location is unset and relocation is unknown), the run **pauses and asks**
on the channel it came from, then resumes.

---

## 2. Design principles

These are the reliability rules. Each one is enforced in code, not in a prompt.

1. **Code owns the plan; the model owns extraction and language.** Same rule as
   `src/agents/backfillAgent.ts`. The input kind selects a fixed set of
   sections; each section is `fetch → extract (generateStructured) → verify (code)`.
   No open-ended tool loop in v1. A loop is less predictable, harder to test and
   costs more (output tokens are ~93% of spend). Revisit behind a flag once the
   eval corpus exists.
2. **Every external fact carries a source that the run actually fetched.** The run
   keeps a `SourceSet` (URL → fetched text). Code drops any claim whose URL is
   not in the set. Numbers go through the numeric guard (`src/lib/ai/guard.ts`)
   against *that source's* text. This covers links as well: the model can only
   pick interview-experience URLs from search results and cannot write them.
3. **Sections fail independently.** A timeout in comp research marks that
   section `unavailable` with a reason; the run ends `partial`, not `failed`.
   Fail closed on truth: "unknown" is always a legal answer.
4. **Everything is a step, and every step is recorded.** `AgentRun` + `AgentStep`
   rows: status, attempt, latency, cost, sources, error. Model calls pass
   `sessionId = runId`, so `ApiUsageLog` joins to runs. The user sees the same
   timeline the operator does.
5. **Idempotent by construction.** `AgentRun(userId, inputKey)` is unique. The
   same link shared twice returns the existing run; "refresh" is explicit.
6. **Public research is shared, personal analysis is not.** Company facts, comp
   figures and interview links are cached per company/role-family (not per
   user). Fit, questions and drafts are per user. This is the efficiency lever:
   the tenth user to share an Amazon SDE-II link pays for fit only.
7. **Budgets are hard.** A per-run step cap and USD cap, checked between steps.
   Metered action `link_analysis`. Drafts are generated only when asked for.
8. **Rule 3 still holds.** Drafts are external artifacts; the evidence they read
   is `sensitivity = 'shareable'` in the query.

---

## 3. Architecture

```
 dashboard ─┐                       ┌────────── AgentRun ───────────┐
 telegram  ─┼─► ingest(link|text) ─►│ classify ─► plan(kind)         │
 whatsapp  ─┤   dedupe on inputKey  │   │                            │
 extension ─┘                       │   ├─ jd        (job)           │
                                    │   ├─ fit       (job)  ◄─ ask?  │  workflow SDK
                                    │   ├─ company   (job, signal)   │  one 'use step'
                                    │   ├─ comp      (job)           │  per section
                                    │   ├─ interviews(job)           │
                                    │   ├─ network   (job)           │
                                    │   ├─ digest    (knowledge)     │
                                    │   └─ openings  (signal)        │
                                    └──── AgentStep × n ─────────────┘
                                              │
                           channel notifier (edit-in-place progress)
```

### Modules

| Path | Owns |
|---|---|
| `src/lib/agent/` | Harness: `AgentRun` lifecycle, `runStep()`, budgets, `SourceSet`, citation verifier. Domain-agnostic, so the next agent reuses it. |
| `src/lib/scout/ingest/` | URL classification, LinkedIn guest-job fetch, public post fetch, ATS reuse (`radar/boards.ts`), HTML→text. |
| `src/lib/scout/sections/` | One file per section; each a pure `(ctx) → SectionResult`. |
| `src/lib/research/` | Web search provider interface + adapter (same shape as `src/lib/enrichment/providers`). No key means research sections say `not_configured`. |
| `src/workflows/scoutRun.ts` | Durable run; dev falls back to inline (packets pattern). |
| `src/services/scout.ts` | Start / answer / refresh / draft. Called by actions and channels. |
| `src/actions/scout.ts` | Server actions (conventions: auth → flag → zod → gate → work → track → Result). |
| `src/lib/channels/` | `ChannelAdapter` (send / edit / buttons) for Telegram and WhatsApp, so Scout replies are channel-agnostic. |
| `src/app/(app)/scout/` | Inbox of runs + run detail with live step timeline. |

### Schema (new)

- `AgentRun`: id, userId, agent (`scout`), inputKey (unique with userId), input
  Json, kind, status (`queued|running|awaiting_input|succeeded|partial|failed`),
  channel, workflowRunId, pendingQuestion Json, result Json, costUsd, stepCount,
  startedAt, finishedAt, error.
- `AgentStep`: runId, name, status, attempt, startedAt, finishedAt, latencyMs,
  costUsd, sources Json (url, title, fetchedAt), output Json, error. Unique
  (runId, name, attempt).
- `ResearchCache`: key (unique), kind, payload, sources, expiresAt. Shared, not
  per user.
- `Contact` (phase 3): userId, fullName, profileUrl, company, normalizedCompany,
  position, connectedOn, source (`linkedin_export|extension|manual`).
- `SavedInsight`: userId, runId, url, author, takeaways, tags. Kept deliberately
  separate from `KnowledgeItem`, which feeds resumes. Someone else's post is not
  the user's evidence.
- `UserProfile.preferences` gains `targetRoles`, `targetLocations`,
  `minCompensationText`, `companySizePreference`, `noticePeriod` (exists).

### Model tasks (all via `generateStructured`)

`scoutClassify` · `scoutPostingRead` (the resume path's posting prompt, on
Scout's model) · `scoutFitMatch` · `scoutFitExplain` · `scoutResearchExtract` ·
`scoutDigest` · `outreachDraft`.

All seven default to **`gpt-6-luna`** (launched 2026-09-23, $0.10 in / $0.50 out
per 1M tokens, which is half of gpt-5.6-luna's input price and ~42% of its
output price), overridable with `OPENAI_MODEL_SCOUT`. Existing tasks stay on
`gpt-5.6-luna` until the Resume v2 eval corpus is re-run: a day-one model does
not get to move the resume path on a press release. Two things to know about
gpt-6-luna:
- Reasoning efforts are `none|low|medium|high|xhigh|max`; there is no
  `minimal`. Scout tasks use `low` (valid on both families).
- Chat Completions only allows function calling when effort is `none`. This
  does not affect us: Scout uses structured output, not tools, and on OpenAI
  itself the provider already uses the Responses API.

---

## 4. The hard parts, stated honestly

- **LinkedIn access.** Job pages are readable through the public guest endpoint
  (verified 2026-09-23: full JD, company, location, applicant count). Public
  posts often render logged-out, but not reliably. The fallbacks, in order: the
  extension's "Send to Patronus" (reads the page in the user's own logged-in
  tab), then "paste the post text". We will **not** run server-side sessions
  with a user's LinkedIn cookies: it breaks LinkedIn's terms and gets the
  user's account restricted.
- **"Connect LinkedIn" does not give connections.** Sign In with LinkedIn
  returns name, email and photo only; the connections API is partner-only. The
  real source is the user's own **LinkedIn data export** (`Connections.csv`:
  name, profile URL, company, position, connected-on), which takes one upload
  and a monthly refresh nudge. Alumni and "people at company" beyond first-degree
  come from web search results, labelled as such.
- **Comp and "elite workplace" data has no API.** Both come from web search
  over public pages (levels.fyi, AmbitionBox, Glassdoor, Blind, Reddit).
  Figures are quoted, never computed or blended: a number is shown only when
  the guard finds it in the cited page, with the source's date. The
  elite-college signal is shown as a cited qualitative note with a confidence
  label, or not at all.
- **WhatsApp needs a Meta Business account** and a verified number (Cloud API).
  The code is testable without one; going live is an ops step only the user
  can do.

---

## 5. Observability

- **User:** `/scout/[runId]` shows each section's status, latency, sources and
  "why unavailable". Telegram/WhatsApp get one message that is edited as
  sections finish, then a summary with buttons (`Draft referral`, `Why not fit`,
  `Open in Patronus`).
- **Operator:** `/admin/runs`: runs per status, p50/p95 latency per section,
  cost per run, top failure reasons, research cache hit rate. Built from
  `AgentStep`, no new pipeline.
- **Tripwire:** `COST_TRIPWIRES_USD.scout` in `src/lib/costBudgets.ts`.

---

## 6. Phases

| Phase | Scope | Needs from you |
|---|---|---|
| **1: Harness + job path** | `AgentRun/AgentStep`, `runStep`, budgets, SourceSet · ingest (LinkedIn guest job, public post, ATS, pasted text) · classify · JD, fit + preference questions, not-fit reasons, company (existing enrichment + hiring signal) · `/scout` pages · Telegram link handling with live progress · on-demand outreach drafts | nothing |
| **2: Research** | Search adapter · comp, interview links, funding/revenue with citations · shared `ResearchCache` · knowledge + company-signal paths | search API key |
| **3: Network + WhatsApp** | `Connections.csv` import → `Contact` · networking targets ranked (1st-degree at company → ex-colleagues → alumni) · WhatsApp adapter + linking · extension "Send to Patronus" | Meta WhatsApp setup |
| **4: Hardening** | Eval corpus (20+ real inputs, zero fabricated numbers/URLs) · `/admin/runs` · elite-workplace signal · tool-loop experiment behind flag | — |

### Pass conditions

- Classification correct on the eval corpus; JD fields match fixtures.
- **Zero** numbers or URLs in any output that are absent from the run's
  `SourceSet` or the user's own record.
- Same link shared twice → one run.
- Killing a section mid-run leaves the run `partial` with a stated reason.
- Median job run < 60s, cost per job run < $0.02 on luna with a warm company cache.

---

## 7. What shipped (2026-09-23)

Phases 1–3 landed in one wave: harness, ingest, all eleven sections, the
dashboard, Telegram, WhatsApp, the extension's "Send to Patronus", contact
import and outreach drafts. Phase 4 has partly landed: `/admin/runs` is built,
and the eval corpus and tool-loop experiment are not.

### Verified live (real LinkedIn, real model via OpenRouter, local DB)

`bun scripts/scout-smoke.ts <userId> <url-or-text> [--fresh]` drives one real
run inline and prints the timeline.

| Input | Result | Time | Model cost |
|---|---|---|---|
| LinkedIn job (Amazon SDE II, guest endpoint) | `awaiting_input`: asked about relocation, verdict "possible (56)" | 20.8s | $0.00118 |
| Public LinkedIn hiring post (`/feed/update/…`) | `partial` → hiring_post, JD + fit | 31.9s | $0.00154 |
| Pasted knowledge post | `succeeded`: digest saved to `SavedInsight` | 5.0s | $0.00014 |

Research sections report "Web research is off: add TAVILY_API_KEY" in all
three. That is correct behaviour for a missing key, and it means no research
path has run against live Tavily.

### Found by the live run, fixed

- **Fit contradicted itself**: it gave a "strong (87)" verdict while showing
  evidence for 2 of 12 requirements. Soft traits ("hustle") counted as gaps,
  keyword matching missed obvious evidence, and tenure was accepted as
  architecture experience. Now the model matches requirement to record line
  **by index**, code judges years and computes a score and verdict from
  coverage, and a summary that disagrees with the numbers is replaced.
  Regression suite: `src/lib/scout/fit/amazonRegression.test.ts`.
- **JD read ran on the resume path's model**: 20.7s and 2.1k output tokens.
  It now has its own task key (`scoutPostingRead`) on gpt-6-luna, cutting job
  run cost by 60%.
- **Scout's default model id ignored the gateway.** OpenRouter needs
  `openai/gpt-6-luna`, so the default now follows `resolveModelGateway`.

### Not verified, and cannot be from here

- Tavily research quality and cost (no key in the environment). Cold-cache job
  runs budget ~8 searches ≈ $0.064; `AGENT_SCOUT_MAX_COST_USD` defaults to 0.15.
- No Telegram or WhatsApp message has been seen in a real client. WhatsApp
  needs a Meta Business app, number and webhook (see `.env.example`).
- The extension's LinkedIn selectors are tested against a synthetic feed only.
- Outreach draft quality and the Connections.csv parser have only been tested
  against fixtures, never a real export.
- `after()` extending the WhatsApp webhook on a real Vercel deploy.
- DNS rebinding is not fully closed in `ingest/fetch.ts` (documented there).

### Rules that came with it

- **Supplier cost stays admin-only.** `ScoutRunView` and the step timeline
  carry no cost; `/admin/runs` does (`src/lib/costPrivacy.test.ts`).
- **Someone else's post is never the user's evidence.** Digests write
  `SavedInsight`, never `KnowledgeItem`, and a test asserts it.
- **The model picks, code cites.** Every research section hands the model
  numbered results and maps its indexes back to URLs; the model never writes a
  URL or an evidence line.

---

## 8. Career inbox (2026-09-26)

Everything a user sends is recorded and arranged, not just analysed:

| Sent | Recorded as | Seen in |
|---|---|---|
| Job link / hiring post | `AgentRun` + an `ApplicationWorkspace` row (`track` section; linked by `scoutRunId`, carries `fitVerdict`) | Inbox → Jobs board; dashboard Applications; `/jobs`, `/applied` |
| A note about your own work | `Win` draft, `source = chat` (`capture` section, kind `work_note`) | Inbox → Notes; Work Log; `/notes` |
| Knowledge post | `SavedInsight` | Inbox → Insights; `/insights` |
| Company news | the run, grouped by company | Inbox → Companies |

Rules that came with it:
- **Only text the user typed can be a work note.** A post read from a link is
  someone else's; classify overrules `work_note` for it in code.
- **Capture never confirms.** Confirm (chat button or Work Log) runs the same
  `winGraph.confirmWin` transaction as the dashboard (rule 5). Confirming twice
  is a success with one Evidence row (tested).
- **The tracker never moves backwards.** `track` and "Save" leave applied /
  interview / offer alone. Status words map onto `ApplicationStatus` in
  `src/lib/inbox/types.ts`.
- **A posting's parse is shared** (`ResearchCache` kind `posting`, keyed by a
  hash of the text): same link, same requirements, same score, for everyone.
- **No research search filters by date at the provider.** Tavily's
  `start_date` drops undated pages, which is nearly every forum post: the
  Amazon SDE II write-ups query returned 0 results with it and 10 without.
  There is a test for this.
- **Comp figures need a salary page and a quote.** Glassdoor jobs-listing
  estimates were shipping as role pay; now a figure needs a salary-type page and
  a quoted context naming the role, and any level the label claims.
