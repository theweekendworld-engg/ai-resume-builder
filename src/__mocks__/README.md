# The mock layer — and what it does not prove

Seven doubles, one per external boundary, each typed against the real SDK so a
version bump that changes a signature breaks the build rather than producing a
mock that quietly describes an API the provider no longer has.

This file exists because `resend.ts` pointed at a "COVERAGE BOUNDARY in the
mocks README" that had never been written. A dangling reference to the document
listing what the tests cannot see is worse than no reference at all: it reads
like the question was answered.

---

## Install

```ts
installMocks({ only: ['email'] });
```

**Always pass `only`.** Bun runs every test file in one process, and these seams
are module-level bindings — installing the Qdrant mock you do not need has
pointed a *different* suite's real Qdrant at an in-memory store. Naming what you
need keeps the blast radius inside your own file.

`installMocks` clears the recorder and any scripted responses on every call.
That is not tidiness: J1 asserted a model-call count and failed about one run in
four, because the capture and backfill suites read the same GitHub fixture
corpus and their calls were still in the recorder when J1 measured.

---

## COVERAGE BOUNDARY

What each double implements, and — the useful half — what it does not. A green
suite says nothing about anything in the right-hand column.

| Boundary | Implemented | Deliberately absent |
|---|---|---|
| **Resend** (`resend.ts`) | `emails.send` | Everything else on `Emails` (`get`, `update`, `cancel`), plus `batch`, `domains`, `apiKeys`, `audiences`, `contacts`, `broadcasts`. **Webhooks are not simulated at all** — delivery, bounce, complaint and open events reach `EmailSend` only in production. |
| **Qdrant** (`qdrant.ts`) | `getCollections`, `createCollection`, `getCollection`, `createPayloadIndex`, `scroll`, `delete`, `upsert`, `search` | Snapshots, aliases, sharding, `recommend`, `discover`, quantization. Filters are matched by an in-memory reimplementation, so **a filter that behaves differently in real Qdrant will pass here** — the closest thing to a blind spot in the layer. |
| **OpenAI** (`openai.ts`) | `embeddings.create`, `chat.completions.create`, plus the `generateStructured` object runner seam | Streaming, tool calling, files, assistants, moderation, images. Embeddings are deterministic hashes: they are stable and comparable, and they **carry no semantic meaning**, so no test here can show that retrieval ranks sensibly. |
| **Stripe** (`stripe.ts`) | `customers.create`, `checkout.sessions.create`/`retrieve`, `billingPortal.sessions.create`, `subscriptions.retrieve`/`update`/`cancel`, `invoices.list`, webhook signature construction | Proration arithmetic, tax, coupons, trials, payment methods, disputes, `invoices.pay`. Webhook *payloads* are hand-built fixtures: they prove our handler's logic, **not that Stripe sends that shape**. |
| **Telegram** (`telegram.ts`) | `sendMessage` over an injected `fetch` | Every other Bot API method, and all inbound update handling. |
| **LaTeX build** (`lib/latexClient.ts`) | The `fetch` transport, injectable | Nothing is parsed or validated — the double returns bytes. That the service accepts our LaTeX, and that the PDF renders, is unproven here. |
| **GitHub** (`github.ts`) | The whole `GithubApi` interface — no `Pick<>`, no cast | Nothing on our own interface. But that interface is a narrow slice of GitHub: **the `repo`-scoped OAuth token exchange has never returned a real token**, and rate limiting, secondary limits and pagination edges are not modelled. |
| **Clerk** (`clerk.ts`) | `auth()`, `currentUser()` via `mock.module` | Organizations, sessions, JWT verification, webhooks, the middleware. Sign-in is a set variable, so **nothing here tests that a real request is actually authenticated**. |

---

## Known gaps worth naming separately

These are not "unimplemented methods" — they are properties of the whole
approach, and each is a thing a passing suite could mislead you about.

**Engine divergence.** Tests run on Bun/JavaScriptCore, the app on Node/V8.
A regex that is valid in one and a `SyntaxError` in the other passed 1,278
tests and threw on every real request. `src/lib/ai/guard.node.test.ts` bundles
the guard and runs it in a real `node` subprocess for exactly this reason;
nothing else in the codebase has that protection.

**Model quality is unmeasured.** The OpenAI double returns whatever the test
scripted. Rubric-parse accuracy, theme grouping, backfill question quality and
draft phrasing are validated against fixtures, not against a model. The
eval-corpus suites narrow this; they do not close it.

**No email has been seen in a real client.** Templates are asserted for
structure — 600px, no web fonts, dark-mode block, unsubscribe in both parts —
which is not the same as looking correct in Outlook.

**Nothing proves a cron fires.** `schedule.test.ts` proves the right jobs are
enqueued when called with a given clock. That Vercel actually calls the tick
hourly is a deployment fact no test in this repo can establish.

---

## Adding a boundary

1. Type the double against the real SDK — `implements Pick<Real, 'a' | 'b'>`.
   Never `as unknown as`. The cast is the whole thing you are giving up.
2. Record every call on the shared `Recorder` so tests assert on shape.
3. Make it deterministic. No clock, no `Math.random()` — content-addressed ids
   instead, so two identical sends produce the same id, which is what an
   idempotency key means.
4. Add a row to the table above, and be specific in the right-hand column.
