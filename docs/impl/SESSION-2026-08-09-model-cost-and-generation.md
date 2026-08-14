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

## 4. RETRACTED — there was no fabrication

**This section previously claimed a confirmed P0 fabrication. That was wrong,
and it was committed to the repo before being verified. Correcting it here.**

The claim was that gpt-5 invented "reducing infrastructure costs by 70%",
Pyodide, GCP Cloud Run, autoscaling, Shopify and Flutter, because a search of
the user's records found none of them.

**That search was defective.** It read `UserExperience.description` and never
read `UserExperience.highlights`, a `Json` column. Every flagged term is in
`highlights`, verbatim:

> "Hosted remote execution services on GCP Cloud Run, leveraging autoscaling and
> stateless containers to reduce infrastructure costs by 70%."

> "Integrated Pyodide (WebAssembly-based Python runtime) to enable secure,
> in-browser Python execution..."

> "Developed a cross-platform affiliate marketing app in Flutter, integrated
> with Shopify..."

So: **the numeric guard worked. gpt-5 was faithful. Nothing was invented.**
"One source line became three bullets" was actually three source lines — one
description plus two highlights — becoming three bullets, which is correct.

Also disproved along the way: v2 does NOT fall back to v1 on this path. An
instrumented run never hit the `[resume] v2 failed` branch at
`generateResume.ts:927`. The guarded v2 path is what ran.

### The one real defect, and it was never a model problem

`buildExperienceDescription` (`generateResume.ts:326`) concatenated
`description` + `highlights` into the bullet source. Those two fields are not
peers: `description` is the role summary, `highlights` are the specifics under
it. Feeding both to selection made the summary compete as a bullet against the
lines it summarises, so a role showed the same claim twice — once vague, once
precise — burning two of fourteen scarce lines.

Fixed: when highlights exist they are the bullets, and the description is not
one. The redundancy was manufactured in our code before any model saw the text.

## 5. Retractions

Recorded so they are not re-derived:

- ❌ "luna is not safe on the generation path" — at the call layer it is the
  *more* faithful model. The 0-roles failure is ours.
- ❌ "`fallbackResumeData` is the bug" — the pipeline never needed it.
- ❌ "The position field is empty / P1 defect" — the schema field is `role` and
  it is populated. My test script read `e.position`, which does not exist.
- ❌ "Reasoning tokens ate the output budget" — `finishReason: stop`, 21–46
  reasoning tokens.
- ❌ "CONFIRMED FABRICATION / the numeric guard has a hole" — the worst of them,
  because it was committed before being checked. The search read `description`
  and skipped the `highlights` Json column where every flagged term actually
  lives. The guard is fine.
- ❌ "v2 silently falls back to the unguarded v1 path" — an instrumented run
  never reached that branch.

Pattern worth naming: nearly all of these came from trusting a throwaway script
over the data model — reading one column and concluding from its absence,
reading `e.position` when the field is `role`. The rule that would have caught
every one: before claiming something is missing, dump the whole record and look
at it. Absence of evidence in a partial query is not evidence of absence.

---

## 6. Plan, in priority order

**P0 — CLOSED, not a bug.** See §4. No fabrication; the guard works; `bulletWrite`
passes `guard: { sourceText, fields: ['bullets.N.text'] }` correctly. The real
defect was `buildExperienceDescription` merging summary with specifics, now
fixed.

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
