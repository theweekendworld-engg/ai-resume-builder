# Session handoff — model cost, gateway, and a generation bug

**Date:** 9 Aug 2026. Written because the session ran out of context mid-investigation.
Everything below is *evidenced* unless marked otherwise. Three of my earlier
conclusions this session were wrong; the retractions are recorded so nobody
re-derives them.

---

## 1. What shipped (committed, gate-green)

| Commit | What |
|---|---|
| `Close the gap→Work Log loop…` | Gap report rows became capturable Wins; clarification questions became skippable |
| `Default to a low-cost model…` | All task defaults → `gpt-5.6-luna`; `baseURL` seam; price table + `modelPricing.test.ts` |
| `Give OpenRouter its own key…` | `OPENROUTER_API_KEY`, pure `resolveModelGateway`, `.env.example` |
| `Ask for resume defaults at first run…` | `/welcome` preferences step; `preferenceConflicts.ts` |
| `Show what a user's defaults cost…` | Conflicts surfaced in `JobMatchPanel` |
| `Add a regenerate action…` | `regenerateResume` |

Gate at last run: **2120 tests, 0 fail · lint 0 errors · build green · clean-checkout tsc 0 errors.**

**Uncommitted:** the emptiness guard in `regenerateResume.ts` (refuses to write a
rebuild with 0 roles over a resume that had roles). Tested, passing, worth keeping.

---

## 2. Cost baseline (measured from `ApiUsageLog`)

One tailored resume = **8,710 input / 14,298 output tokens**.
**Output is ~93% of spend** — reasoning bills as output.

Consequences that are easy to get backwards:
- Prompt caching is near-worthless here (it discounts the 7%).
- Input price in any vendor table is noise. Compare output price only.

Per resume: gpt-5 ≈ **$0.154** · luna ≈ **$0.019** · GLM 5.2 ≈ **$0.004**.
The 10-free-resume tier costs **$1.54/signup** on gpt-5, **$0.19** on luna.

**Deadline: 11 Dec 2026** — `gpt-5*-2025-08-07` snapshots shut down. OpenAI's named
replacements cost *more* (`terra` $2/$12 vs `gpt-5-mini` $0.25/$2). `luna` is both
cheaper than the old default and past the date.

---

## 3. The open bug: luna produces 0 roles

**Symptom.** Full pipeline on a real account (4 experiences) with
`OPENAI_MODEL_GENERAL=openai/gpt-5.6-luna` → `roles=0`, `skills=7`,
`personalInfo` intact. Everything that does *not* route through bullet
writing survives.

**What is ruled OUT — do not re-investigate:**

1. **Not OpenRouter.** Reproduces identically on OpenAI-direct (Responses API,
   no gateway).
2. **Not the model call.** Direct `generateObject` against
   `openai/gpt-5.6-luna` via OpenRouter returns `finishReason: stop`,
   valid schema first try, 21–46 reasoning tokens, and a correct faithful
   bullet. `reasoningEffort` is honoured (scales when changed).
3. **Not a truncated output budget.** `finishReason` is `stop`, never `length`.
4. **Not missing `fallbackResumeData`.** The pipeline loads experiences itself
   (`generateResume.ts:670`), `sourceExperiences` maps off DB rows (`:722`), and
   `selectedExperiences` only sorts and slices (`:740`) — it cannot return zero
   from a non-empty input.

**Therefore:** the loss is in *our pipeline*, downstream of a successful model
call, somewhere between `bulletSelect`/`bulletWrite` returning content and the
resume having roles. A role with zero surviving bullets gets dropped.

**Leading hypothesis (unverified):** luna's bullets stay very close to the source
wording, and some downstream novelty/derivation/guard check discards them.
gpt-5 rewrites more aggressively and so survives that filter.

---

## 4. The more urgent bug: gpt-5 fabricates

Source row for 2Sigma School is **one line**:

> "Worked on secure in-browser Python execution and cost-optimized remote
> execution infrastructure."

gpt-5 produced **three bullets** adding *GCP Cloud Run*, *autoscaling*,
*stateless containers*, *Pyodide (WebAssembly)*, and
**"reducing infrastructure costs by 70%"**.

Same pattern at Swachh.io: one source line → three bullets adding *Shopify*,
*Google APIs*, *Flutter*.

luna, given the identical source line, returned **one bullet: the source,
restated. Nothing added.**

### CONFIRMED FABRICATION — the guard did not fire

Searched all 13 source records for this user (4 `UserExperience`, 6
`UserProject`, 3 `KnowledgeItem`). Result:

```
ABSENT  70%        ABSENT  Pyodide     ABSENT  GCP      ABSENT  Cloud Run
ABSENT  Shopify    ABSENT  Flutter     ABSENT  autoscal
```

**Every one of those specifics was invented.** Not sourced from a wider record —
they exist nowhere in the user's data. That includes the quantity
"reducing infrastructure costs by 70%", which the numeric guard in
`src/lib/ai/guard.ts` exists specifically to block, on the live generation path,
and which it passed.

This is a P0 against the product's stated invariant — *"No generated artifact may
contain a number, scope, or outcome absent from its source. Zero fabrications is
the pass condition — not 'low rate'."* It outranks every other item in this
document.

Next step is not a fix, it is a diagnosis: determine whether `bulletWrite` calls
`generateStructured` with a `guard` argument at all, and if so what `source` it
passes. A guard given the wrong source text is indistinguishable from no guard.

---

## 5. Retractions

Recorded so they are not re-derived:

- ❌ "luna is not safe on the generation path" — at the call layer it is the
  *more* faithful model. The 0-roles failure is ours.
- ❌ "`fallbackResumeData` is the bug" — the pipeline never needed it.
- ❌ "The position field is empty / P1 defect" — the schema field is `role` and
  it is populated. My test script read `e.position`, which does not exist.
- ❌ "Reasoning tokens ate the output budget" — `finishReason: stop`, 21–46
  reasoning tokens.

Pattern worth naming: three of four came from trusting a throwaway test harness
over the code. Instrument the actual step before theorising from output shape.

---

## 6. Plan, in priority order

**P0 — DONE, and the answer is bad.** All terms absent from all 13 source
records; see §4. The numeric guard passed a fabricated `70%` on the live path.
The follow-up is to find out why: does `bulletWrite` pass a `guard` to
`generateStructured`, and is its `source` the actual candidate text?

**P1 — Instrument the pipeline for the 0-roles bug.**
Log what `bulletSelect` and `bulletWrite` actually return inside one luna run,
plus what drops a role to zero bullets. ~10 lines, one 3-minute run. This is the
only remaining unknown for luna.

**P2 — Cap bullets-per-role by available source material.**
One source line must not become three bullets. Fixes padding *and* the apparent
duplication at the same place, upstream of both. Supersedes the "dedupe bullets"
task, which was treating a symptom — there was nothing to dedupe, only padding.

**P3 — Commit the emptiness guard** in `regenerateResume.ts`.

**P4 — Wire the regenerate UI.** The action exists; no button calls it.
`targetLength` override is also not threaded through `generateSmartResume`
(only `maxProjects` is) — see the comment in the action.

**P5 — Run the Resume v2 eval corpus** against luna and gpt-5 to settle quality
with data instead of two anecdotes.

---

## 7. Environment

`.env` and `.env.local` currently:
```
OPENROUTER_API_KEY=sk-or-…          # set → chat routes to OpenRouter
OPENAI_API_KEY=sk-proj-…            # untouched, still serves embeddings
OPENAI_MODEL=openai/gpt-5.6-luna
OPENAI_MODEL_GENERAL=openai/gpt-5.6-luna
```

**Model ids must match the provider.** With the router key set, ids need the
`openai/` prefix; without it, they must not have it. A mismatch is a
`400 invalid model ID` and it bit twice this session.

**Until P1 is fixed, `OPENAI_MODEL_GENERAL` on luna produces zero roles.** Either
revert it to `gpt-5` (which generates, but fabricates — see §4) or fix P1 first.
`OPENAI_MODEL` on luna for extraction tested clean four times and can stay.

**Never use `:free` OpenRouter model ids** — they train on prompts, and the
landing page promises "Never sold, never used to train anything".
