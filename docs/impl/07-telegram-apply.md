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

## 5. Share and go (2026-11-08)

The owner: "in place of typing a post, what if I just shared a post … based
on the post and what I want, it should figure out what to do and complete
the work without me handholding every step." Sharing used to end at the
analysis and six buttons; every next step was a tap. Now the share says
what it is for, and code runs the steps.

### The goal, decided narrowly (`src/lib/scout/goal.ts`)

1. **Split the post from the note.** Text around a link is the note
   (share-sheet boilerplate like "Check out this job at …" is dropped, and a
   short hiring post with an address or "we're hiring" is the post, not a
   note). On a paste, only a short first or last line that speaks to us
   (first person, or a short question) is the note: "apply for me" on top
   comes off, a post's own "Apply now!" never does. A file's caption is the
   note and its text the post (`telegramAgent` passes them apart). Scout gets
   the post without the note, so the same post with and without "apply for
   me" is one run.
2. **Code first.** `goalByCode` reads keywords into `apply | evaluate |
   people | save`, evaluate first ("should I apply?" is a fit question).
3. **One small call when code cannot tell.** Task `shareGoal` (config map,
   chat's cheap model, effort `low`), a closed enum, the note only. Any
   failure is `evaluate`. No note at all is `evaluate`: today's behaviour,
   plus a **🚀 Apply for me** button (`sc:g:<runId>`) after the status row,
   inside Telegram's six. It is hidden once the job is applied to, while a
   chain works, and on WhatsApp.

The goal is stored on the run (`AgentRun.input.goal`, not part of the dedupe
key). `people` lists up to three people by name under the analysis and
leads with the outreach button; `save` says it is saved.

### The apply chain (`src/services/applyChain.ts`)

State lives on the run (`input.apply`: `pending → eligibility_hold |
tailoring → drafting → drafted → applied`, or `declined` / `stopped` with a
reason and code). Every transition is a conditional write keyed on the row's
`updatedAt`, so a retried workflow step or a double tap moves it once. No
request is held open: each step runs in the function that finished the
previous one. No schema change.

| Step | Hook | What code does |
|---|---|---|
| a. Scout finished | `finishScoutRun` → `advanceApplyChain`, before the final message | Paused on a blocking question: wait (the answer re-runs the analysis and comes back here). A fit `eligibility` check in `conflict`: `eligibility_hold`, and the final message ends "You may not be eligible: … Apply anyway?" with Yes / No (`sc:g:<runId>:y|n`). Not a job, a failed run, WhatsApp: `stopped`, said in the final message. |
| b. Tailor | same call | `tailorResumeForRun(…, { auto: true })`: the session is tied to the run (`GenerationSession.clarifications.chain = { runId }`, preserved by `readClarificationPayload`), and every question goes through the existing "skip all" path (`skipAllGenerationQuestions`: charged once, claimed once, nothing unanswered is claimed). The skipped questions' skills are kept (`input.apply.skipped`). The final message says "🚀 Tailoring your resume for <role> at <company> now." |
| c. Generation done | `notifyTelegramGenerationSession` → `settleApplyChainSession` | Claims `tailoring → drafting`, writes the draft (`createDraftForRun`, format null: an email to the posting's address, else a LinkedIn message to the recruiter or poster), focuses it, and sends one result: the PDF (named from the record, "One page, tailored for …", Open resume · Regenerate), then the draft rendered by `renderDraftForTelegram` with "Attach the PDF above and send.", the skills not claimed ("I didn't claim MCP or Claude experience. Reply with details to add them to the email."), and how to finish. Without an address it leads with **Open the application** (the posting's apply link). The plain "resume ready" message is not sent for a chain session. |
| d. "sent it" | `routeAgainstFocus` (`done`) → `markApplicationSent` | For an application draft (an email to the apply address, or the chain's own), the job moves to Applied (`setJobStatus`, never backwards) and the reply is "Marked Applied. I'll remind you to follow up in a week." `journey_daily` finds applied jobs quiet for 7 days. |
| e. Apply for me | `sc:g:<runId>` → `requestApply` | Sets the goal and starts at step a; a chain already working is left alone and reported. Re-sharing a run that exists with "apply for me" does the same. |

A reply goes to the draft, not to an open Scout question, when the draft was
focused after the question was asked (`draftFocusedSince`): "sent it" must not
become the answer to the pay-floor question asked minutes earlier.

### Web chat

A link or paste whose note code reads as `apply` (`applyShareRoute`) is
analysed with the apply goal without a router call; an unclear note on an
`analyze_job` share goes through `decideShareGoal`. The chat thread gets a
live `apply_chain` card (reading → tailoring → drafting; "Yes, apply anyway"
/ "No, skip it" on an eligibility hold; the reason and a next step when it
stops). When the chain settles on the `web` channel, one assistant message is
appended (`src/lib/chat/applyResult.ts`): a completed `generation` card and a
`message_draft` card (To / Subject / Body, Open in Gmail and Mail app, or
Open the application for a LinkedIn message, Copy, Mark as applied). The job
page panel shows LinkedIn-message drafts too. On the web, "Mark as applied"
is the button; typing "sent it" is a Telegram/WhatsApp focus feature.

### Fixes from the same live test

- The PDF is named `Jai_Shankar_Resume_iServeWorld.pdf` (`resumeFileName`),
  on Telegram, on `/api/pdfs/[id]`, `/api/v1/pdfs/[id]` and the editor export.
- One completion message, not two, and it does not lead with an ATS estimate.
- "Tailor resume" says "3 quick questions…" and "Question 1 of 3", in the
  `/generate` wording (`questionsIntro`).
- A revision keeps the sign-off as its own paragraph (`keepSignOffParagraph`
  in `src/lib/drafts/revise.ts`), and `enforceLimits` trims above the
  sign-off instead of cutting it off.

### Proven live (2026-11-08, production Telegram)

"apply for me" + a pasted post ran the whole chain on patronus.cv: analysis,
"🚀 Tailoring…", the PDF (named from the record), the email draft with the
not-claimed skills, and "sent it" → "Marked Applied." Starting the
generation workflow from inside the Scout finish step works on Vercel.
