# Agentic resume generation — design

**Status:** built and passing its eval, 9 Aug 2026. Flag ON.

### Eval result — 5 postings, one real account

| posting | roles | projects | time |
|---|---|---|---|
| payments | 4 | 3 | 22s |
| ai-platform | 3 | 3 | 18s |
| infra | 3 | 3 | 18s |
| fullstack | 3 | 3 | 20s |
| search | 2 | 2 | 18s |

**5/5 accepted · 0 fabrication · 0 empty · median 18s.** The pipeline took 177s
for one, and produced zero roles on the same model.

It retitled itself per posting — "ML Platform Engineer | RAG Systems", "Software
Engineer | Kubernetes & Cloud Automation", "Search Engineer | Elasticsearch,
Hybrid Retrieval" — from one unchanged record. Selection adapting to the reader
is the thing a fixed step order cannot do.

Caveat kept honest: run-to-run the document varies (3-4 roles, 2-3 projects on
the same posting family). Repeatability is the price paid for judgement.
Replaces the fixed pipeline in `src/lib/resume/` for resume generation only.

---

## Why

Not because the model call is wrong. It is not — a raw curl to
`openai/gpt-5.6-luna` with `response_format: json_schema` returns faithful,
schema-valid bullets first try, inventing nothing, for $0.000055. That was
verified directly.

The problem is the **fixed assembly around the calls**. The pipeline hard-codes
one order — read posting, select bullets, write bullets, summarise, group
skills, score coverage — and every step passes a fixed slice of context to the
next. When a step returns something the next step does not expect, content is
dropped silently and the resume comes out thin with no error anywhere. That is
the open 0-roles bug, and it is a class of bug, not an instance.

An assembling model can ask for what it needs, notice a role has no usable
lines, and go get more. The pipeline cannot.

---

## The shape

```
                  ┌─────────────────────────────┐
   posting  ──►   │   assembling model (loop)   │  ──►  ResumeDraft (JSON)
                  └──────────┬──────────────────┘            │
                             │ tool calls                     │ validated
                  ┌──────────▼──────────────────┐            ▼
                  │ read_posting                │      numeric guard
                  │ list_roles                  │      coverage report
                  │ get_role_evidence           │      persist
                  │ search_evidence (semantic)  │
                  │ list_projects               │
                  │ get_skills_with_evidence    │
                  └─────────────────────────────┘
```

The model orchestrates. It never writes to the database, never sees anything a
tool did not return, and its final message is a single JSON document we parse
and validate.

---

## Tool contracts

Every tool is a **plain async function** in `src/lib/resume/tools/`, unit-testable
without a model. The loop wires them; the functions know nothing about it.

| Tool | Returns | Notes |
|---|---|---|
| `read_posting(text)` | requirements[], role, company, seniority | the existing `readPosting` |
| `list_roles()` | id, company, role, dates — no bullet text | cheap index so the model can plan |
| `get_role_evidence(roleId)` | every source line for one role | description + highlights, **already deduped** |
| `search_evidence(query, k)` | semantic hits across the whole record | Qdrant; how a gap gets filled |
| `list_projects()` | id, name, tech | |
| `get_skills_with_evidence()` | skill → the line that evidences it | never the posting's wishlist |

### Non-negotiable: visibility lives in the tool

Every tool that returns evidence filters `sensitivity = 'shareable'` **in its own
SQL**, via `src/lib/graph/visibility.ts`. The model is never given a visibility
parameter and never told to "skip confidential items". CLAUDE.md rule 3, and the
reason it exists: a prompt-level rule is not enforcement. Tests assert the query,
not the output.

---

## Loop constraints

- **Bounded.** Hard cap on steps (start at 12) and on total tool calls. A loop
  with no ceiling is an unbounded bill; output tokens are ~93% of spend.
- **One model, one task key.** `resumeAssemble` in `src/lib/config.ts`. No model
  id at a call site (rule 1); the loop runs inside `src/lib/ai/` (rule 2).
- **Read-only tools.** No tool mutates. The only write is ours, after validation.
- **Every tool call logged** to `ApiUsageLog` with the step index, so a bad run is
  diagnosable after the fact — the thing the current pipeline cannot do.

---

## Output handling

The model's final message is a `ResumeDraft` JSON. Before it becomes a resume:

1. **Schema parse** — zod. Reject and retry once on failure.
2. **Numeric guard** — every bullet checked against the concatenated text of the
   evidence the tools actually returned in this run. This is stronger than today:
   the guard source becomes exactly what the model was shown, rather than a
   separately-assembled string.
3. **Emptiness check** — a draft with zero roles when roles exist is a failed
   run, not a result. (The 0-roles bug shipped silently for want of this.)
4. **Coverage report** — unchanged, computed from the posting and the draft.

---

## What is NOT changing

- `src/lib/resume/coverage.ts`, `length.ts`, `skillGroups.ts`, `contact.ts`,
  `preferenceConflicts.ts` — pure functions, already tested, reused as-is.
- Preferences, entitlements, quota, persistence, the editor.
- The v1 path stays as the fallback until the loop beats it on the eval corpus.

---

## Order of work

1. `tools/` — the six functions, with tests. No model involved. **Start here:**
   they are useful immediately and they are where rule 3 is enforced.
2. The loop in `src/lib/ai/`, behind `FEATURE_AGENTIC_RESUME`, default off.
3. Run the Resume v2 eval corpus: loop vs pipeline, on fabrication rate,
   empty-output rate, coverage score, latency, cost.
4. Flip the flag only if it wins on fabrication AND empty-output rate. Cost and
   latency will be worse — the question is whether quality pays for it.

---

## Known risk, stated up front

A tool loop costs materially more than the pipeline: more output tokens, more
round trips, higher latency on a step already taking 30–180s. The pipeline's
0-roles bug is one specific findable defect; replacing the architecture is a
larger bet than fixing it. That trade was made deliberately — recorded here so
step 3 is judged on data rather than on the enthusiasm of step 1.
