# 08: Memory — ask once, remember for months

Status: built (2026-11-08), branch `memory`. Migration `20261108035732_user_memory`.

## 1. The question this exists for

During tailoring the bot asked the owner: "Do you have hands-on experience with
Claude? Share one concrete project, impact, or metric we can safely include."
His record already says his agent at Plivo runs on Anthropic models. Two
things were wrong:

1. **The record was not read properly.** Gap detection was a substring test
   for the skill's own name. The record never says "claude", so it asked.
   Confirmed Wins were not read at all.
2. **Nothing was kept.** An answer went into one session's JSON and was gone.
   The next posting that asked about Claude asked again.

Owner, verbatim: questions should be auto-handled from his profile and past
experience, be unique, and once answered be saved to long-context memory for
later days; a weekly cron should consolidate memory with minimal wording; work
like Claude Code's long and session memories.

## 2. Two memories

| | Session memory | Long-term memory |
|---|---|---|
| What | The conversation and the task in progress | What the user told us about themselves |
| Where | `ChatConversation` turns + `focus` (`src/lib/chat/focus.ts`) | `UserMemory` (`src/services/memory.ts`) |
| Lifetime | Hours (focus TTL 2h; router sees the last 12 turns) | Months, until edited or deleted |
| Shape | Turns, and one focused task by id | One short line per topic key |
| Written by | Every message | Answers: resume questions, Scout questions; Settings edits; the weekly consolidation |
| Read by | The router, in-task routing | Gap detection (ask only the unknown), the chat router, outreach drafts |

The split is Claude Code's: the session is the working context and is thrown
away; long-term memory is a small file of durable facts that every new
session starts from, edited by the user, kept short on purpose.

## 3. The store

`UserMemory` (additive migration; one new table, nothing existing changed):

| Column | Meaning |
|---|---|
| `key` | Normalised topic, derived **in code**: `skill:claude`, `skill:kubernetes`, `pref:work_mode`, `fact:work_auth` |
| `label` | How the topic reads to a person ("Claude"). Display only |
| `text` | One short line in the user's words |
| `source` | `clarification_answer` · `chat` · `scout_answer` · `consolidation` · `user_edit` |
| `sourceRef` | The session/question it came from (`generation:<session>:<q>`, `scout:<run>:<q>`, `edit:<id>`, `consolidate:<week>`) |
| `sensitivity` | `shareable` (default) · `private` |
| `status` | `active` · `superseded` · `deleted` |
| `supersededById` | The row that replaced this one |
| `useCount`, `lastUsedAt` | How often it answered a question; orders the prompt index |

Rules held by the database, not only the code:

- **One active row per (userId, key)**: partial unique index
  `UserMemory_userId_key_active_key … WHERE status = 'active'`, created in raw
  SQL because Prisma 6 cannot express it. Any migration Prisma generates later
  that tries to drop it must keep it.
- CHECK constraints on `source`, `sensitivity`, `status`.

A new answer for a topic **supersedes** the old row (history stays, the chain
is `supersededById`); the same line said again only touches the row. Two
writers racing on one topic meet the index; the loser retries and supersedes
the winner. Counting a use is raw SQL so `updatedAt` keeps meaning "the line
changed".

### Keys (`src/lib/memory/topics.ts`)

`skillKey('Claude API') === 'skill:claude'`, `skillKey('K8s') ===
'skill:kubernetes'`, `skillKey('PostgreSQL') === 'skill:postgres'`. A short,
directional alias table also says which record words **evidence** a skill:
"Anthropic" evidences Claude, "EKS" evidences Kubernetes, a named model
evidences "LLMs". Aliases match on word boundaries ("go" is never found in
"google"); the skill's own name keeps the old substring test.

## 4. Capture

| Where | What is written |
|---|---|
| Resume clarification answered, web or Telegram (`continueSession` in `src/services/channelGenerate.ts`, the one path both use) | `skill:<gap>` ← the answer, cleaned (`memoryTextFromAnswer`: whitespace, a leading "yes," dropped, capped at 280 chars) |
| Scout preference answered (`applyAnswerToProfile`, `src/lib/scout/preferences.ts`) | `pref:location`, `pref:relocate`, `pref:work_mode`, `pref:target_roles`, `pref:min_comp` (private), `fact:work_auth` (private); only when the answer was understood, the same bar as the profile write |

"skip", "skip all", "no", "not yet", "no, never used it" write nothing
(`isDeclineAnswer`): remembering "no" as the answer about X is how a later
resume ends up claiming X. A bare "yes" writes nothing either: there is no
fact in it. Capture never throws; the answer is already on the session.

## 5. Ask only what is unknown

Before a clarification question is asked (`startNewSession`):

1. **The record.** `detectGaps` reads experiences, projects, knowledge items,
   the resume being tailored, and confirmed **shareable** Wins
   (`externalRetrievalFilter`, the lines a resume may use). A skill the record
   evidences, directly or by alias, is not a gap. Two spellings of one skill
   are one gap.
2. **Long-term memory.** `recallForSkills` finds, per remaining gap, a memory
   filed under the skill or an alias of it, or failing that one whose text
   names it. A preference is never the answer to a requirement.
3. **Only the rest is asked**, and the existing cap (`maxQuestions`, default 3)
   counts only questions actually asked.

A memory used this way is stored on the session (`clarifications.remembered`)
and joins the model's context **exactly like an answer typed today**: the same
`Candidate clarifications (verified user input)` block, appended to the posting,
under the same numeric guard. It is never evidence and never a confirmed Win;
rule 5 is untouched. With nothing left to ask, the block is appended at
session creation and generation starts.

Every surface says what was used, with the date the user said it:

> Used what you told me on Nov 8 (Claude): Voice agent on Claude Sonnet at Plivo
> Wrong or out of date? Change it in Settings → Memory.

(`rememberedNote`, `src/lib/memory/format.ts`; Telegram `/generate`, Scout's
"Tailor resume" reply, chat's tailor reply, and a toast on `/build` and the
Scout page.)

The question itself now ends "I will remember your answer, so I won't ask
again."

## 6. Recall in prompts

`memoryIndex(userId)` renders one line per active memory, most used first,
at most ~1,500 characters (a long line is skipped, shorter ones after it still
fit). Small models read short context best.

- **Chat router** (`src/lib/chat/context.ts`, `renderContext`): the index joins
  the context block under "What the user told you on earlier days (their
  words)". The whole block is the reply's numeric-guard source, so a figure the
  user stated may come back and nothing else may. The chat reply is the user's
  own, not an artifact, so private lines are included.
- **Outreach and draft facts** (`loadShareableEvidence`,
  `src/lib/scout/outreach.ts`): up to 12 memory lines, filtered to
  `shareableMemoryWhere` **in the query** (rule 3). A private line never reaches
  the prompt, so the model is never asked to leave one out.

## 7. Weekly consolidation

Job kind `memory_consolidate` (kind in `src/lib/jobs/types.ts`, handler
`src/lib/jobs/handlers/memoryConsolidate.ts`, schedule `src/lib/jobs/schedule.ts`).

- **Schedule**: every tick enqueues the dispatcher with dedupe key
  `memory_consolidate:<Monday yyyy-mm-dd>`; the first tick of the week runs it,
  the rest are no-ops.
- **Dispatcher** (`{}`): one child per user with an active, freshly captured
  line (`clarification_answer` / `chat` / `scout_answer`) created in the last 7
  days. Child dedupe key `memory_consolidate:<userId>:<week>`. Handlers fan
  out, never loop.
- **Child** (`{ userId, week }`, `consolidateMemories` in
  `src/services/memoryConsolidation.ts`):
  1. Group active lines by canonical key. Send a topic only if it holds a
     fresh capture longer than six words (or more than one line). User edits
     and consolidated lines are left alone.
  2. **One** `generateStructured` call (task `memoryConsolidate`, feature
     `memory`), closed schema `{ items: [{ index, text }] }`: the model picks a
     topic by index and returns its line. Guard source = the memories, field
     `items`.
  3. If the guard stripped **anything**, keep every original. No partial trust.
  4. Per topic, in code: every word of the rewrite must already be in that
     topic's lines (connectors aside), and it may not be longer. A rewrite that
     fails keeps its original; a multi-line topic falls back to its lines
     joined, which adds nothing.
  5. Apply each topic in a transaction: supersede the old rows (conditional, so
     a line the user edited meanwhile is left alone), write one `consolidation`
     row carrying the summed `useCount` and the most private sensitivity.
- **Idempotent**: rewritten rows are `consolidation` rows, never sent again on
  their own, so a second run finds nothing and never calls the model.

## 8. Privacy controls

- **Settings → Memory** (`/settings/memory`, linked from `/settings`): every
  active line, grouped (Experience, What you are looking for, Facts), with its
  source, date and use count. Edit (a `user_edit` row superseding the old),
  **Private** switch (in place), Delete (soft: `status = deleted`, gone from
  every prompt at once; the topic may be asked about again). Actions in
  `src/actions/memory.ts`: Clerk `auth()` → zod → service → `FunnelEvent` →
  `Result`. Not flag-gated: a privacy control must always be reachable.
- **`/memory`** on Telegram (and bare `memory` on WhatsApp): the list, most used
  first, 🔒 on private lines, a link to the settings page.
- Private lines answer the user (chat) and never reach an artifact: resume
  clarifications use any memory the user has stated about a skill, the same as
  a typed answer; outreach reads shareable only, in SQL. Scout's pay and work
  authorisation answers are private by default.
- Nothing is hard-deleted by memory itself; account deletion removes the rows
  with the rest of the user's data.

## 9. Tests

| File | Proves |
|---|---|
| `src/lib/memory/memory.test.ts` | keys and aliases (Anthropic → Claude, "go" ∉ "google"), capture cleanup, the note, the index budget, the week |
| `src/services/memory.integration.test.ts` | one active per key (service and DB index), supersede chain, touch, race, CHECKs, edit/forget, ownership, recall by key/query/skill, usage order without `updatedAt` moving, shareable-only outreach |
| `src/services/memoryCapture.integration.test.ts` | capture on answer (web, Telegram), skip/no write nothing, the record answers (Anthropic → Claude, confirmed shareable Win; draft/confidential do not), one question per topic, second tailoring asks nothing and uses the answer, cap counts asked only, forgotten is asked again, auto-generate, Scout capture with private pay |
| `src/services/memoryConsolidation.integration.test.ts` | rewrite, merge (private wins, usage summed), added word kept, guard strip keeps all, prompt/guard source, idempotent with zero model calls, dispatcher fan-out and dedupe keys |
| `src/actions/memory.integration.test.ts` | auth, zod, `Result`, ownership |
| `src/lib/channels/inboxCommands.test.ts`, `src/services/telegramAgent.clarification.integration.test.ts` | `/memory` rendering and the Telegram path end to end |
| `src/lib/chat/router.test.ts` | the index in the router context and as guard source |
| `src/lib/jobs/schedule.test.ts`, `registry.test.ts` | one key per week; the kind has a handler |

## 10. Not done

- No "remember this" from free chat yet (`source = chat` exists for it). The
  router would need a `remember` action with a code-derived key.
- `src/actions/clarify.ts` (`startClarificationSession` /
  `submitClarificationAnswers`) is an older path no UI calls; it was left as is.
- Aliases are a hand-kept list. A miss costs one question, which the answer
  then removes for good.
