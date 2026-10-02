# PRD 10 — Chat: the front door

**Status:** Phase 1 and 1b built (2026-10-02). Flag `chat`, seeded off.
**Owner surfaces:** `/chat`, then Telegram and WhatsApp through the same router.

## 1. Why

Users already know how to talk to an assistant. They do not know our IA:
Work Log, Inbox, Radar, Packets, the builder. Every one of those is a page the
user has to find. Chat makes the product reachable in one place, in their words:
"log that I shipped the retry queue", "is this Eltropy role a fit", "tailor my
resume for it", "tell me about Razorpay".

The risk is building ChatGPT with a career prompt. ChatGPT already exists, is
free, and is better at open conversation than we will be. Chat only wins if it
is the **front door to what Patronus knows and can do**:

| | ChatGPT | Patronus chat |
|---|---|---|
| Knows you | what you paste | your confirmed Wins, projects, experience and preferences |
| Acts | writes text | creates the Win draft, runs Scout, tailors the resume, moves the tracker |
| Honest | invents metrics | no figure that is not in your record; company facts cite a URL |
| Remembers | per chat | one continuous thread; every job and note lands in the inbox |
| Follows up | never | (Phase 3) nudges and the digest arrive in the thread |

Reference point: Jack & Jill (London, $60M raised, ~350k candidates) proves
candidates will hold a long conversation with an agent about their career. Their
agent learns "motivations, trade-offs and ambitions that fit awkwardly into a
resume" to feed a two-sided marketplace. We take the intake idea, not the
marketplace: our moat is the user's own evidence record, which compounds even
when they are not searching.

## 2. Principles (each is a rule the code enforces)

1. **Code owns the actions; the model routes.** One structured call
   (`generateStructured`, task `chatRoute`) picks one action from a closed list
   and fills its arguments. It never writes an id: it picks a job by its index
   in a list the code showed it, as Scout picks sources by index.
2. **Writes need a tap.** The router may *draft* a Win. Only the Confirm button
   on its card writes Evidence + ClaimLink (rule 5). No action the router picks
   can confirm, send or delete anything.
3. **Replies are cards plus one short line.** A card is a typed object (job, Win
   draft, Scout run, resume generation, outreach draft, list of record items)
   that renders with buttons and links to the full page. Prose is the exception.
4. **No fabricated quantities.** Free-text answers run the numeric guard with the
   user's message and the context the router saw as the only source. A figure
   the guard cannot find is stripped, and the reply says it will not guess.
5. **Meter actions, not messages.** Talking is free (rate-limited). A Scout run,
   a tailored resume and an outreach draft charge exactly as they do on their
   own pages, because they ARE those code paths.
6. **One brain, every channel.** The router is channel-neutral. Telegram and
   WhatsApp move onto it in Phase 1b, replacing the length-and-URL heuristic in
   `src/lib/channels/inbound.ts`.

## 3. Phase 1 — the front door (this build)

### Actions

| Action | Arguments | Runs | Card |
|---|---|---|---|
| `analyze_job` | url or pasted text | `startScoutRun` | Scout run (polls to done) |
| `research_company` | company name | `startScoutRun` with `intent: company_research` → `company_signal` plan | Scout run |
| `log_work` | the note | `createWinDraftForUser` (source `chat`) | Win draft: Confirm / Dismiss |
| `tailor_resume` | job index | `tailorResumeForRun` | Resume generation |
| `draft_outreach` | job index, target, format, steer | `draftScoutOutreach` | Draft with copy |
| `update_job` | job index, status | `setJobStatus` | Job |
| `show_jobs` | column filter | `listJobBoard` | Job list |
| `find_jobs` | keywords, location, remote | `JobPosting` search over ingested boards | Posting list, each with Analyze |
| `ask_record` | query | Win search (vector, then text fallback) | Record items |
| `build_resume` | — | link to `/build` | Link |
| `answer` | — | the router's own reply, guarded | — |
| `clarify` | question | — | — |

### What the router sees

The last 12 messages (text only), and a context block built in code: the user's
recent tracked jobs as a numbered list (index, company, role, status, verdict),
whether a Scout question is open, the count of unconfirmed Win drafts, and
whether a base resume exists. Nothing from another user, ever; nothing marked
confidential.

### Data

`ChatConversation(id, userId, channel, createdAt, lastMessageAt)`, unique on
`(userId, channel)`: one continuous thread per channel. A career is one long
conversation, not a list of sessions.

`ChatMessage(id, conversationId, userId, role, text, cards Json, action,
clientId, createdAt)`. `(conversationId, clientId)` is unique, so a
double-submitted message is one message (idempotency is a DB constraint).

### Limits

Message ≤ 4,000 chars. 30 messages / minute / user (the existing AI limiter).
A router failure replies "I could not work that out. Try rephrasing." and
records the message; it never drops what the user typed.

### UI

`/chat`: a full-height thread, composer at the bottom, starter chips chosen
from the user's state ("3 drafts to confirm", "Tailor for <last job>"). Cards
inline. Nav gets **Chat** first when the flag is on, and the logo goes there.

### Done when

- Each action works end to end on the local stack, with a test per action.
- A Win drafted in chat is not in the record until Confirm is tapped (test).
- A guarded answer with an invented figure loses the figure (test).
- The same `clientId` twice writes one message (test).
- Lint 0 errors; full suite green except the known `designTokenParity` failure.

## 4. Phase 1b — channels

Telegram and WhatsApp free text routes through the same router
(`routeChannelText` in `src/services/chat.ts`). Links still short-circuit to
Scout without a model call, and a pending Scout question still takes the reply
first. `log_work`, `analyze_job` and `research_company` keep the channel's own
Scout flow (live progress message, Confirm buttons); every other action
replies as text (`src/lib/chat/renderText.ts`). Chat off, or a routing error,
means the old behaviour: a note is never lost to the router.

Not yet: channel turns are not stored in a `ChatConversation`, so the router
sees no channel history. That is the next step for "one memory".

### Measured (2026-10-02, gpt-6-luna, 14 realistic messages)

14 of 14 routed correctly, including job-by-index ("tailor my resume for the
eltropy role" → job 1), an ambiguous "tailor it" → clarify, and "what salary
should I ask Razorpay for?" → an answer that declines to guess a figure.
About $0.00015 and 2–3 s per message.

## 5. Phase 2 — knowing you

- **Intake interview** (the Jack idea): a short guided conversation that fills
  the job-search preferences in `UserProfile.preferences` (roles, locations, remote, pay floor, stage, deal
  breakers), editable on `/settings/job-search`. Fit scoring already reads it.
- **`ask_record` with an answer**, not just a list: a guarded summary over the
  retrieved Wins.
- **Job discovery breadth.** Today `find_jobs` searches Greenhouse/Ashby boards
  we ingest, which is thin for India. Options: more providers (Lever,
  Workable), Tavily search with verification, a jobs API. Decide on coverage
  data, not taste.
- **Comp check**: Radar bands in chat, with `n`, window and geography.

## 6. Phase 3 — proactive

The weekly digest and mission nudges post into the thread (inside the
notification budget), application follow-ups ("Eltropy closes Friday; you have
not applied"), voice input.

## 7. Not doing

An employer side, auto-apply, open-ended web browsing by the model, and any
action that sends a message on the user's behalf.
