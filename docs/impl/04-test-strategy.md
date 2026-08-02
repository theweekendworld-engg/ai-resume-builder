# Implementation 04 — Mocks & End-to-End Verification

> **Status:** `Active` · **Date:** 2026-08-02
> **Goal:** prove the internal system is correct with every external dependency mocked, such that swapping in a real client is a configuration change and not a discovery.

---

## 1. The two things this must achieve

**A. The internals are provably correct.** Every loop that spans features — capture → draft → digest → confirm → ground → packet — runs end to end against mocks, on a real database, with no network.

**B. The swap is provable, not hopeful.** A mock that drifts from the real API is worse than no mock: it turns a green suite into false confidence. So every mock is **typed against the real SDK's own interface**. If Resend changes `emails.send`, the mock stops compiling. TypeScript, not vigilance, is what keeps them honest.

---

## 2. Current state, honestly

| Boundary | Seam today | Verdict |
|---|---|---|
| **GitHub** | `GithubApi` interface, `OctokitGithubApi implements GithubApi` | **The model to copy.** Real client is one implementation of an interface the tests also implement. |
| **Stripe** | Explicit `__testing` client swap | Good |
| **OpenAI (structured)** | `__testing.setObjectRunner` | Good |
| **Resend** | none — module-level lazy singleton | Needs a seam |
| **Qdrant** | none — module-level `const` | Needs a seam |
| **OpenAI (embeddings, usageTracker, anonScore)** | none — three separate `new OpenAI` | Needs a seam |
| **Clerk** | `mock.module` in **7 files**, 7 different stub shapes | Fragmented and fragile |
| **Telegram** | fetch-based, mocked once | Needs a seam |

### Two problems that more tests would not fix

**Email is mocked at the wrong layer.** Two suites mock `@/lib/email/send` — the module under test. So its preference checks, suppression rules, plain-text generation and `List-Unsubscribe` headers never run in those tests. **The most breakable logic is the part being stubbed out.** Mocks belong at the *provider* boundary, never at the boundary of the thing you are testing.

**`mock.module` is process-global in Bun.** Seven files replacing `@clerk/nextjs/server` works today only because each registers before its own dynamic imports. That is an ordering accident, not a design. D1 flagged it; the eighth file to do it will break something unrelated.

**No journey is tested.** 1195 tests, all unit or single-feature. The product is the loop between features, and the loop has never run.

---

## 3. Design

### 3.1 One mock per boundary, typed against the real thing

```
src/__mocks__/
  index.ts        installMocks() / resetMocks() / the recorder
  clerk.ts        replaces 7 ad hoc stubs
  resend.ts       MockResend, typed against the Resend SDK
  qdrant.ts       in-memory vector store with real filter semantics
  openai.ts       embeddings + chat, deterministic
  stripe.ts       checkout, subscriptions, webhook event construction
  github.ts       implements GithubApi (the interface already exists)
  telegram.ts     records sends, supports callback simulation
  recorder.ts     every outbound call, assertable
```

**The fidelity rule:** each mock declares itself against the real type.

```ts
// If the SDK's signature moves, this stops compiling. That is the point.
export class MockResend implements Pick<Resend, 'emails'> { ... }
export class MockGithubApi implements GithubApi { ... }
```

A mock that merely *looks* like the API proves nothing. A mock the compiler checks against the API proves the swap.

### 3.2 Seams over `mock.module`

Add `__testing.setClient(...)` where a module owns a client. Reserve `mock.module` for Clerk alone, where auth is genuinely resolved at import time — and do it in **one** place so there is one stub shape, not seven.

### 3.3 Mock at the provider, never at the feature

`sendEmail` must run for real, with a `MockResend` underneath. Same for grounding, drafting, embedding. **The rule: if the module under test is the module being mocked, the test is measuring nothing.**

### 3.4 Deterministic by construction

No `Math.random`, no wall-clock in mocks. Model responses are keyed by prompt fingerprint so the same input always yields the same output, and a test that changes a prompt sees its mocked response change too — surfacing the coupling rather than hiding it.

---

## 4. The journeys

Five loops. Each spans features that no existing test crosses.

| # | Journey | Spans | Why it matters |
|---|---|---|---|
| **J1** | **The core loop.** Connect GitHub → sync → signals → drafts → weekly digest → magic-link confirm → Evidence + ClaimLink → embedded → visible in the log. | C1 → D1 → B1 | This *is* the product. If one link is wrong, the retention thesis does not run. |
| **J2** | **The payoff loop.** 40 confirmed Wins → packet → themes → grounding → readiness → export. | B1 → C2 | The thing an employed user pays for. |
| **J3** | **The backfill loop.** Interview → answers → drafts captured at capture time → confirm → record extends backwards. | C3 → B1 | The time-to-value compressor. |
| **J4** | **The money loop.** Free user hits quota → paywall with real data → checkout → tier changes → limits change → cancel → **data intact**. | C4 → B1 | Cancellation deleting a Win is unrecoverable trust damage. |
| **J5** | **The month loop.** Month rolls over → eligibility → compose → guard → persist → email → web view. | D2 | The only payoff before month six. |

**Each journey asserts the invariants, not just the happy path:**
- No fabricated quantity survives any hop.
- A `confidential` Win never reaches an external artifact, at any stage.
- Every confirm leaves exactly one `Evidence` + one `ClaimLink`.
- Re-running any step is a no-op.

---

## 5. What this does not prove

Stated so the green suite is not over-read:

- **Real API shapes.** A typed mock proves the *call* is right, not that the provider behaves as documented. Live smoke tests against sandbox credentials remain on the pre-launch list.
- **Model quality.** Mocks prove the pipeline holds when the model misbehaves. Whether a real model writes a good question, or an outcome-framed theme title, needs a live eval.
- **Email rendering.** No mock tells you the digest looks right in Outlook.

Those three are exactly the pre-launch checklist. This work makes everything *except* them provable.
