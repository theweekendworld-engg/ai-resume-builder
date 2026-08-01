# PRD 07 — Backfill (the retargeted Context Interview)

> **Status:** `Draft for build` · **Release:** R2 · **Persona:** P1 Maya, P2 Dev, and the only path that makes new-grads/returners viable
> **Depends on:** 01 (Win), existing `resumeAgent` tool-calling pattern (`src/agents/`), `ImpactMetric`, `Evidence`, SSE streaming
> **Retargets:** v2's "Context Interview." Same engine, different job.

---

## 1. The retarget, and why it matters

v2 positioned the Context Interview as the onboarding wedge — a 5-minute conversation that fills the profile. That's the wrong job for it, for two reasons:

1. **It's a tax at the worst moment.** A new user who wants a resume does not want a 20-question interview first. Conversion drops.
2. **It competes with auto-capture.** GitHub connect (02) fills the log in 90 seconds with zero user effort. That is strictly better onboarding.

But the interview solves a real problem that auto-capture cannot: **auto-capture only sees forward.** A user with 8 years of experience arrives with 8 years of undocumented, unrecoverable work, and connectors will never see any of it. The resume they generate on day one is only as good as that history.

So the interview's job is **backfill**: reconstructing the record that existed before Patronus. Run once, per employer, on demand — not as an onboarding gate.

**Value line:** *"You have eight years of work and a two-page resume. Let's get the other 90% back."*

---

## 2. When it runs

| Entry point | Framing |
|---|---|
| After the first resume import or GitHub backfill | *"We found 4 jobs and 12 projects. Want to spend 10 minutes filling in what actually happened at Acme?"* |
| Log surface, per employer, whenever the log is thin for a period | *"Your log starts in June. Want to reconstruct 2024–2025?"* |
| Packet generation with <8 wins (03 §3.1) | Direct link |
| Mission M6 (return after a break) | A required step |
| The gap report finds an absent competency | *"You may have done this and not logged it — 5 minutes?"* |

**Never** in the first-run onboarding flow. It's offered *after* the user has seen value, never before.

---

## 3. Session design

### 3.1 Scope

One session covers **one subject**: an employer (`UserExperience`), a project (`UserProject`), or a competency gap. Bounded scope is what makes it finishable — "tell me about your career" is unanswerable; "tell me about your two years at Acme" is a conversation.

**Length target: 8–12 questions, 6–10 minutes.** Hard cap at 20 questions; the agent must wind down before that or it feels like an interrogation. Show progress honestly: *"Question 4 · about 5 minutes left."*

### 3.2 Question strategy

The agent picks the highest-value question each turn from the current state of the graph. Priority order:

1. **Anchor** — "What were the two or three things you're most known for at Acme?" (opens the space, gets the user's own framing)
2. **Quantify** — for any anchor without a number: "Roughly how much did that reduce support tickets?" **Never invents an estimate; accepts "I don't know."**
3. **Scope** — "Was that just your team, or wider?" (this is what separates Senior from Staff evidence, and users never volunteer it)
4. **Rarity** — probe the categories the log lacks: `influenced`, `grew`, `saved`. "Who else's work changed because of that?" / "Did you mentor anyone?"
5. **Evidence** — "Is there a doc, dashboard, or ticket you could point at?" (optional; a `no` is fine)
6. **Sweep** — "Anything from that period you'd be annoyed to leave off your resume?"

**One question at a time. Always.** A multi-part question gets a partial answer and loses the rest.

### 3.3 Conversation rules

These are the difference between "a thoughtful colleague" and "a chatbot survey," which is the stated risk in the master plan §10.

1. **Acknowledge before advancing.** Reflect the specific thing they said, then ask. Never "Great! Next question."
2. **Show the capture immediately.** After each substantive answer, render the structured Win inline — the user watches their record being built. This is the entire perceived-value mechanism; a text-only chat feels like a form.
3. **Accept "I don't remember."** Move on, mark it, never re-ask in the same session.
4. **Never lead the number.** Banned: "Would you say around 30%?" Required: "Any sense of the size?" A led number is a fabricated number that the user will unknowingly put on a resume.
5. **Never flatter.** No "that's impressive!" It's transparently synthetic and it erodes the trust the truthfulness brand depends on.
6. **Let them leave.** Exit at any time; the session is resumable for 30 days with full context. Everything captured so far is already saved as drafts.

### 3.4 The interface

Chat, reusing the existing SSE streaming path. Split view:

```
┌─────────────────────────────┬──────────────────────────┐
│  Acme · 2023–2025           │  CAPTURED SO FAR      6  │
│  Question 4 · ~5 min left   │                          │
│                             │  ✓ Cut checkout p95      │
│  ─────────────────────────  │    800ms → 180ms         │
│  You said the migration     │    ⚡ quantified          │
│  unblocked the payments     │                          │
│  team. How many people      │  ✓ Led the payments      │
│  were waiting on it?        │    migration             │
│                             │    ⚠ needs a number      │
│  [                       ]  │                          │
│  [ I don't remember ]       │  ✓ Mentored 2 engineers  │
└─────────────────────────────┴──────────────────────────┘
```

The right rail is the product. Watching it fill is what makes someone finish.

**Voice input** (R3): the same session with speech-to-text. People recall more when speaking than typing, and this is the single highest-upside enhancement to the feature — but chat must be excellent first.

---

## 4. Output

Every session produces:
- **Win drafts** (`source = backfill`, `status = draft`) — never auto-confirmed, per principle 4 in 00 §4. The user reviews them in one screen at the end.
- **`Evidence(kind = interview_assertion)`** for each, with the user's verbatim answer as the excerpt. Their own words are the evidence.
- **`ImpactMetric`** rows where a number was given.
- **Updates to `UserExperience.highlights`** where the user's framing is better than what's stored — proposed as a diff, never applied silently.

**The closing screen** — this is the payoff and must be strong:
```
  You just recovered 9 wins from 2023–2025.
  6 have hard numbers. 3 are cross-team.

  Before this, your Acme record was 3 resume bullets.

  [ Review and confirm all ]   [ Do another period ]
```

---

## 5. Agent architecture

Follow the existing `resumeAgent` pattern (`src/agents/resumeAgent.ts` + `src/agents/tools/`). Do not build bespoke glue.

### 5.1 Tools
| Tool | Purpose |
|---|---|
| `getSubjectContext` | The employer/project + existing Wins, highlights, projects in that period |
| `getGraphGaps` | Missing categories, unquantified claims, thin competencies for this subject |
| `writeWinDraft` | Persist a Win draft mid-conversation (so a dropped session loses nothing) |
| `writeImpactMetric` | Attach a metric to a Win |
| `linkEvidence` | Create `Evidence(interview_assertion)` + `ClaimLink` |
| `endSession` | Wind down and produce the summary |

### 5.2 Session state

```prisma
enum InterviewStatus  { active paused completed abandoned }
enum InterviewSubject { employer project competency period }

model InterviewSession {
  id           String           @id @default(cuid())
  userId       String
  subjectType  InterviewSubject
  subjectId    String?
  subjectLabel String
  status       InterviewStatus  @default(active)
  transcript   Json             @default("[]")   // [{role, content, at}]
  askedTopics  Json             @default("[]")   // prevents repeats across resumed sessions
  winIds       Json             @default("[]")
  questionCount Int             @default(0)
  costUsd      Float            @default(0)
  startedAt    DateTime         @default(now())
  lastActiveAt DateTime         @updatedAt
  completedAt  DateTime?
  expiresAt    DateTime                          // startedAt + 30d

  @@index([userId, status, lastActiveAt])
}
```

Mirror `GenerationSession`'s state-machine + workflow discipline for resilience. A dropped connection must never lose captured Wins — they're written as drafts on capture, not at session end.

### 5.3 Model & cost
- **Conversational turns:** strongest available conversational model. This is the one surface where model quality is directly perceptible, and a cheap model here reads as a chatbot. Per master plan §6.1, the model comes from the per-task map in `src/lib/config.ts` — never hard-coded.
- **Structured extraction** (answer → Win draft): fast/cheap model with the `WinDraftSchema` from 01 §8.1, run in parallel with the next question's generation so it never adds latency.
- **Budget:** <$0.60 per completed session. Track with `ApiUsageLog` feature tag `backfill_interview`.
- **Latency:** first token <1.5s. A conversation that pauses feels broken in a way a generation spinner doesn't.

### 5.4 Transcript privacy
Interview transcripts are the most sensitive data in the product — people disclose conflicts, failures, and confidential work. Treat as `confidential` by default: user-scoped, excluded from any embedding used for external output, deletable independently of the Wins they produced, and included in export. Never used for training or eval without explicit, separate opt-in.

---

## 6. Entitlements

| | Free | Career | Search |
|---|---|---|---|
| `backfill_session` | 1 lifetime | 4/period | Unlimited |

One free session is deliberate: it's the best demo the product has, and a user who reconstructs one job will want to do the other three. Reuse the existing `context_interview` metered action rather than adding a new one — it already exists in `MeteredAction` and this is what it was for.

---

## 7. Telemetry

| Event | Payload |
|---|---|
| `backfill_started` | `{subjectType, entryPoint, existingWinCount}` |
| `backfill_question_answered` | `{index, topicType, answerChars, saidDontRemember}` |
| `backfill_win_captured` | `{index, quantified, category}` |
| `backfill_abandoned` | `{atQuestion, capturedSoFar, secondsElapsed}` |
| `backfill_completed` | `{questions, winsCaptured, quantifiedCount, durationSec, costUsd}` |
| `backfill_wins_confirmed` | `{confirmed, dismissed, edited}` |
| `backfill_resumed` | `{daysSincePause}` |

**The two that matter:** completion rate (target **>60%**; below 45% the conversation is too long or too dull) and **abandon-at-question distribution** — a spike at question 5 tells you exactly which question is bad. Instrument the question index precisely; this is how the feature gets tuned.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| User gives a vague non-answer twice in a row | Change topic rather than pressing. Two vague answers means the thread is dry. |
| User volunteers a number that contradicts an existing `ImpactMetric` | Surface both, ask which is right, update. Never silently overwrite. |
| User describes something confidential | Detect keywords, set `sensitivity = confidential`, and say so inline: *"I've marked this internal-only — it'll help your review but won't go on a resume."* Naming the protection out loud is what makes people willing to keep talking. |
| Answer contains several distinct wins | Split into multiple drafts; confirm the split with the user in the rail |
| Session resumed after 3 weeks | Re-anchor briefly ("we were talking about your time at Acme — you'd mentioned the migration"), never restart |
| Subject has zero prior context | Start with the anchor question; the agent has nothing to reference and must not pretend it does |
| User types a whole paragraph dump | Extract everything, acknowledge specifically, and **skip ahead** — don't ask about things they just covered |
| User asks the agent a question | Answer briefly, return to the interview. It's a conversation, not a kiosk. |
| Model produces a leading question in QA | Automated check on the eval transcripts for banned patterns (`would you say`, `around \d+`, `roughly \d+%`) — hard launch gate |

---

## 9. Acceptance criteria

- [ ] Session completes in 8–12 questions for a typical 2-year employer subject
- [ ] Right-rail capture updates within 2s of each answer
- [ ] Every captured Win is persisted as a draft **at capture time** — killing the browser mid-session loses nothing
- [ ] No question in a 20-session eval set leads a number (automated pattern check)
- [ ] Zero `ImpactMetric` rows contain a figure the user did not state (automated check against transcripts; hard gate)
- [ ] "I don't remember" advances without a re-ask, in the same session and on resume
- [ ] Resumed session does not repeat a topic in `askedTopics`
- [ ] Confidential detection sets sensitivity and tells the user inline
- [ ] Closing screen states real counts and the before/after comparison
- [ ] Transcript is exportable and independently deletable
- [ ] Completion rate ≥60% in a 20-user internal test before launch
- [ ] First token <1.5s p95

---

## 10. Out of scope

Voice input (R3) · interviewing about a job the user hasn't held (aspirational) · multi-session narrative continuity across subjects · manager/peer interviews about the user · importing a transcript from another tool.
