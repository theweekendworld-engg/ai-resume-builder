# 07: Telegram that remembers, and apply-by-email from the phone

Status: building (2026-11-07). Phases 1–2 of the gap plan.

## 1. The flow this exists for

The owner pastes a recruiter post into Telegram ("Forward Deployed AI Engineer
| Claude … send resumes to jobs@x.com"), gets the fit, taps **Tailor resume**
and gets a PDF, taps **Draft email**, then says "make it shorter", "add IIT
Delhi", "make me sound stronger", and finally taps **Open in Gmail** with the
address, subject and body filled in. He attaches the PDF and sends it
himself. Every step happens in Telegram; nothing needs the laptop.

Owner decisions (2026-11-07):
- **Patronus never sends email.** There is no Gmail send scope. "Send" means a
  compose link (Gmail web compose URL, and a `mailto:` fallback) that the user
  opens and sends. PRD 10 §7 stands.
- LinkedIn is never crawled or automated.

## 2. The harness: state in code, one small decision per turn

A Haiku/luna-class model is reliable when code holds the state and the model
makes one narrow choice at a time. So:

- **Focus** (`src/lib/chat/focus.ts`): the one task the user is in the middle
  of on a channel, stored on `ChatConversation.focus` with a 2-hour TTL. Kinds:
  `draft` (a `MessageDraft` being revised) and `job` (a run just shared).
- **In-task routing**: when the focus is a draft, a short free-text message is
  first read against it by a narrow call with three choices: `revise` (the
  instruction applies to the draft), `done`, or `other` (a new request, which
  goes to the normal router). The model is shown the draft it would change.
- **Memory**: Telegram turns are stored in `ChatConversation(channel=telegram)`
  and the router gets the last 12 turns, the same as the web.
- **Facts are code-owned**: email addresses come from the posting text by
  regex, never from a model. Names, ids and links are picked by index.
- **Writes are buttons**: opening the compose link is a button the user taps.

## 3. MessageDraft

One row per version (`prisma/schema.prisma`). A revision is a new row with
`parentId` = the previous version and `version + 1`; the focus always points
at the latest. Revisions go through `generateStructured` with the numeric
guard over (previous body + evidence + instruction); they are not metered as
a new `cover_letter` (the first draft is), but are rate-limited by the chat
limiter.

## 4. File ownership for the parallel build

| Area | Owner | Files |
|---|---|---|
| Webhook reliability, files, rendering | agent W | `src/app/api/telegram/**`, `src/lib/telegram.ts`, `TelegramUpdateSchema` and the top-level error handling in `src/services/telegramAgent.ts`, `src/lib/chat/renderText.ts`, new `src/lib/channels/telegramFiles.ts` |
| Drafts, apply email, compose links | agent D | new `src/services/drafts.ts`, new `src/lib/drafts/**`, new `src/app/api/compose/**`, `src/lib/scout/outreach.ts`, `src/lib/scout/sections/ingest.ts`, `JdData` in `src/lib/scout/types.ts`, `src/lib/channels/scoutActions.ts`, `src/lib/channels/scoutRender.ts` |
| Focus, memory, in-task routing | orchestrator | `src/lib/chat/focus.ts`, `src/lib/chat/router.ts`, `src/lib/chat/types.ts`, `src/services/chat.ts`, `src/lib/channels/telegramInbound.ts`, `prisma/**`, `docs/**` |

Agents do not edit files outside their row, do not commit, and do not touch
`prisma/schema.prisma`, `package.json` or `docs/**`.
