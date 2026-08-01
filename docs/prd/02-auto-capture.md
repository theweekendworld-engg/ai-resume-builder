# PRD 02 — Auto-Capture (connectors)

> **Status:** `Draft for build` · **Release:** R1.2 (GitHub), R2 (calendar, Linear/Jira) · **Persona:** P1 Maya
> **Depends on:** 01 (Win object), existing GitHub integration (`src/actions/github.ts` — Octokit, OAuth + manual username, `getGitHubIntegrationStatus`)
> **Principle it serves:** "Confirm, never compose" (00 §4.1)

---

## 1. Why this is the load-bearing feature

The weekly ritual only works if the digest arrives **pre-filled**. A digest that says "tell us what you did this week" is a homework assignment and will be ignored by week three. A digest that says "we think you did these three things — right?" is a 20-second confirmation.

So auto-capture isn't a convenience feature layered on the log. **It is the reason the log gets filled.** If we ship the log without connectors, log-fill rate will not clear 15% and the entire v3 thesis fails on its first metric.

**Design consequence:** we optimize for *recall over precision at draft time, precision over recall at confirm time.* Drafting a mediocre Win the user dismisses costs one tap. Missing a real Win costs the record. But we cap volume hard (§6.5) because a digest of 12 mediocre drafts is worse than 3 good ones.

---

## 2. Connector framework

All sources share one pipeline. Build the framework with GitHub as the first implementation; adding calendar in R2 should be one adapter file, not a new subsystem.

```
  ┌────────────┐   sync    ┌──────────────┐  filter  ┌──────────────┐  draft  ┌───────┐
  │ Connector  │ ────────▶ │CaptureSignal │ ───────▶ │  candidates  │ ──────▶ │  Win  │
  │  adapter   │  cursor   │  (raw, 1:1   │  noise   │  (grouped,   │   AI    │ draft │
  └────────────┘           │   w/ source) │  rules   │   ranked)    │         └───────┘
        │                  └──────────────┘          └──────────────┘
        │  writes CaptureRun (observability, errors, item counts)
        ▼
  CaptureSource  ← consent record, config, cursor, health
```

### 2.1 Adapter contract

```ts
interface CaptureAdapter {
  kind: CaptureSourceKind;
  /** OAuth or token setup; returns the external account identity. */
  connect(userId: string, params: unknown): Promise<{ externalAccountId: string; scopes: string[] }>;
  /** Pull items since the cursor. MUST be incremental and MUST be idempotent. */
  pull(source: CaptureSource, since: Date | null): Promise<{
    signals: RawSignal[];
    nextCursor: string | null;
    partial: boolean;          // true if rate-limited mid-pull; safe to resume
  }>;
  /** Source-specific noise rules applied before AI cost is incurred. */
  isNoise(signal: RawSignal, config: SourceConfig): boolean;
  /** Group related signals (e.g. 6 commits in one PR) into one candidate. */
  group(signals: RawSignal[]): SignalGroup[];
  /** Render the "From: …" attribution line shown in the digest. */
  attribution(signal: RawSignal): { label: string; url: string | null };
}
```

`RawSignal` = `{ externalId, kind, occurredAt, title, body, url, metadata }`.

---

## 3. GitHub connector (R1.2)

### 3.1 What we pull

| Signal kind | Source | Why |
|---|---|---|
| `pr_merged` | PRs authored by the user, merged in the window | The single highest-signal artifact a developer produces |
| `pr_reviewed` | PRs where the user left a **substantive** review (see noise rules) | Captures `influenced` — the category people always forget and reviews always want |
| `issue_closed` | Issues closed by the user with a linked commit/PR | Catches ops/bugfix work |
| `release_published` | Releases the user authored | High-value `shipped` signal |
| `repo_created` | New repos with ≥3 commits and a README | Side projects, prototypes |

**Not pulled in R1:** individual commits (too noisy, PRs subsume them), stars, forks, follows, discussions.

### 3.2 Auth & scopes

Reuse the existing OAuth path in `src/actions/github.ts`. Two modes, both already supported:

| Mode | Scopes | What we can see |
|---|---|---|
| **Public only** (manual username, no OAuth) | none | Public repos only. Works, but misses most work-work. Offered as the zero-friction start. |
| **Full** (OAuth) | `read:user`, `repo` (read) | Private org repos. Required for real value for employed users. |

**The `repo` scope is a big ask and we must earn it.** Consent copy (this is the spec, use it verbatim):

> **Connect GitHub**
> We read your merged pull requests and code reviews to draft your weekly wins. We do **not** read your source code, we never write anything to GitHub, and you choose which repos we look at.
> Everything we pull is shown to you before it becomes part of your record.
> [ Connect public repos only ] [ Connect with private repos ]

**Repo selection UI is mandatory before the first sync.** Present the user's repos ordered by recent contribution, with checkboxes, pre-checked for repos they've contributed to in the last 90 days. Store in `CaptureSource.config.includedRepos`. A user must be able to answer "what can this thing see?" in one screen.

### 3.3 Sync schedule

| Trigger | Window | Notes |
|---|---|---|
| **Initial backfill on connect** | last 90 days | Runs immediately, produces the "empty log" first fill. Capped at 40 drafts (see §6.5) — this is the wow moment, don't drown it. |
| **Weekly, pre-digest** | since last cursor | Runs 2 hours before the user's digest time |
| **Manual refresh** | since last cursor | Button in settings, rate-limited to 1/hour |

Use the GitHub Search API (`is:pr author:@me merged:>=DATE`) plus per-repo events, respecting `ETag`/conditional requests. Persist `nextCursor` as an ISO timestamp, not a page token (survives API changes).

**Rate limits:** authenticated GitHub allows 5,000 req/hr per user token. Budget ≤60 requests per user per sync. On 403/429, set `partial: true`, persist the cursor at the last fully-processed item, and retry with exponential backoff (max 3 attempts, then mark the run `degraded` and continue with what we have — never fail the digest because a sync was incomplete).

---

## 4. Signal → Win drafting

### 4.1 Grouping

Related signals collapse into one candidate before hitting the model:
- All commits + the PR they belong to → one `pr_merged` candidate.
- A PR and the issue it closes → one candidate (prefer the PR's context, keep both URLs as evidence).
- Multiple PRs to the same repo within 5 days that touch the same top-level directory and share ≥2 title keywords → **one candidate**, framed as a single effort. This is critical: a refactor spread across 6 PRs is one Win, not six.

Grouping happens in code (deterministic), not by AI.

### 4.2 The drafting call

**Model tier:** pick on **accept rate, not price** (08 §4.2). At ~34 candidates/user/month the gap between `gpt-5-mini` and `gpt-5` is ~$0.14/user/month — irrelevant against a $99/yr plan, and accept rate is the metric the whole thesis rests on. Ship the A/B in R1.2 and let the number decide; escalate to `gpt-5` unconditionally for multi-PR groups and contexts >2,000 chars. **Budget:** $0.001–0.006 per candidate, p95 <3s.

**Input** (deliberately narrow — we do not send source code):
```
repo: patronus/api (private)
role: author
title: "Batch pricing lookups in checkout path"
body: <PR description, truncated 1200 chars>
labels: [performance, backend]
merged: 2026-07-14
files_changed: 7    additions: 210    deletions: 340
linked_issue: "Checkout times out during peak" (#1190)
review_comments_by_others: 4
user's role context: "Senior Backend Engineer at Acme"
```

**Output:** the same `WinDraftSchema` from 01 §8.1, plus `shouldDraft: boolean` and `dismissReason?: string`.

**Prompt rules, in addition to 01 §8.1's no-invention rules:**
1. **Only use what's in the PR.** If the description is empty and the title is "fix", `shouldDraft = false`. We will not manufacture significance.
2. **Read the "so what" from the linked issue** when the PR body is thin — that's where the user impact usually lives.
3. **Numbers may only come from the text.** A PR titled "reduce latency" with no measurement produces `quantified: false` and a `clarifyingQuestion` — never an invented percentage. This is the highest-risk fabrication surface in the entire product; it is where a made-up number would reach a real resume.
4. **Reviews (`pr_reviewed`) draft as `influenced`** and must quote the substance of the review comment in the narrative. If the comment was "LGTM", it isn't a Win.
5. **Never name a private repo's business details in `title`** if `suggestedSensitivity` is `confidential` — keep the title generic and put specifics in the narrative.

### 4.3 Confidence scoring

`confidence` is computed, not asked of the model — the model's self-reported confidence is unreliable. Formula:

```
base = 0.4
+0.20  PR body length > 200 chars
+0.15  linked issue present
+0.15  a number appears in title/body/issue
+0.10  ≥3 review comments from others (signals significance)
+0.10  labels include a meaningful tag (feature/performance/security/...)
-0.20  files_changed > 60 (likely a bulk/mechanical change)
-0.15  title matches a low-signal pattern (see §6.4)
```

Clamp [0,1]. Digest shows the top 5 by confidence. Below 0.35 → create the draft but do not surface it in the digest (visible in the log's "Needs review" only). Below 0.20 → don't draft at all.

---

## 5. Data model

```prisma
enum CaptureSourceKind   { github calendar linear jira }
enum CaptureSourceStatus { active paused error revoked }
enum CaptureRunStatus    { running success degraded failed }

model CaptureSource {
  id                String              @id @default(cuid())
  userId            String
  kind              CaptureSourceKind
  status            CaptureSourceStatus @default(active)
  externalAccountId String                       // gh login, google sub, ...
  scopes            Json      @default("[]")
  config            Json      @default("{}")     // includedRepos[], excludedKeywords[], calendars[]
  cursor            String?                      // ISO timestamp of last processed item
  consentGrantedAt  DateTime
  consentCopyVersion String                      // which consent text they agreed to
  lastSyncedAt      DateTime?
  lastSuccessAt     DateTime?
  errorCount        Int       @default(0)
  lastError         String?
  revokedAt         DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  runs    CaptureRun[]
  signals CaptureSignal[]

  @@unique([userId, kind])
  @@index([status, lastSyncedAt])
}

model CaptureSignal {
  id          String   @id @default(cuid())
  userId      String
  sourceId    String
  externalId  String                    // gh PR node id, calendar event id
  kind        String                    // pr_merged | pr_reviewed | issue_closed | ...
  occurredAt  DateTime
  title       String
  body        String   @default("")
  url         String?
  metadata    Json     @default("{}")
  groupKey    String?                   // set when grouped into a multi-signal candidate
  isNoise     Boolean  @default(false)
  noiseRule   String?
  processedAt DateTime?
  winId       String?
  createdAt   DateTime @default(now())

  source CaptureSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, externalId])      // THE idempotency guarantee
  @@index([userId, occurredAt])
  @@index([sourceId, processedAt])
}

model CaptureRun {
  id            String           @id @default(cuid())
  userId        String
  sourceId      String
  status        CaptureRunStatus @default(running)
  trigger       String                       // initial | scheduled | manual
  windowStart   DateTime?
  windowEnd     DateTime?
  itemsScanned  Int      @default(0)
  itemsNoise    Int      @default(0)
  candidates    Int      @default(0)
  winsDrafted   Int      @default(0)
  costUsd       Float    @default(0)
  error         String?
  startedAt     DateTime @default(now())
  finishedAt    DateTime?

  source CaptureSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@index([userId, startedAt])
  @@index([sourceId, startedAt])
}
```

**`CaptureSignal.@@unique([sourceId, externalId])` is the most important constraint in this document.** It is what makes re-syncing safe, makes a duplicated cron harmless, and guarantees we never draft the same PR twice. Every adapter must produce a stable `externalId` (GitHub node ID, not the PR number — numbers are per-repo and reused after transfers).

---

## 6. Noise filtering

Noise handling has four layers, cheapest first. This matters for both cost and trust: one dependabot PR in a digest tells the user we aren't paying attention.

### 6.1 Layer 1 — hard exclusions (free, deterministic)
Drop before storing a signal:
- Author is a bot (`type: Bot`, or login matches `*[bot]`, `dependabot`, `renovate`, `github-actions`)
- PR title matches `/^(chore|ci|build|deps|docs)\(/i` or `/^(bump|update) .* (from|to) v?\d/i`
- Merge commits, revert-of-own-PR, PRs with 0 net line change
- Branch matches `release/*` auto-merges

### 6.2 Layer 2 — user config
`config.excludedRepos[]` and `config.excludedKeywords[]`, editable in settings. Dismissing a Win with reason `noise` offers *"Always ignore PRs like this?"* → appends a rule. **This is how the filter learns without ML.**

### 6.3 Layer 3 — review substance test (for `pr_reviewed`)
Only draft when the user's review has ≥1 comment of ≥120 characters, or the review state is `CHANGES_REQUESTED`. Approvals with no comment are never Wins.

### 6.4 Layer 4 — low-signal title patterns (confidence penalty, not exclusion)
`fix typo`, `wip`, `test`, `revert`, `merge branch`, `cleanup`, `lint`, `formatting`, single-word titles. These get `-0.15` confidence rather than a hard drop — sometimes "cleanup" is a 3,000-line deletion that mattered.

### 6.5 Volume caps
| Window | Cap | Overflow behavior |
|---|---|---|
| Weekly digest | **5 drafts** | Rest land in "Needs review" in the log, no email mention beyond "+7 more in your log" |
| Initial 90-day backfill | **40 drafts** | Ranked by confidence; the rest are stored as signals and drafted lazily if the user asks for more |
| Per sync run | 60 model calls | Hard stop; run marked `degraded`; resumes next cycle |

---

## 7. Connector UX

### 7.1 Onboarding placement
GitHub connection is **step 2 of onboarding**, immediately after profile basics and *before* any resume work. Framing: *"Connect GitHub and we'll build the first 90 days of your work log in about a minute."* The payoff is immediate and visible — this is the best activation moment the product has.

Skippable, with a persistent (dismissible) card in the log until connected.

### 7.2 Settings → Connected sources (`/settings/sources`)

Per source, show:
- Status pill: `Active` / `Paused` / `Needs attention` / `Revoked`
- **Exactly what we can see**: "42 repos · public + private" with an [Edit] opening the repo picker
- Last sync time + last run summary: *"Jul 31, 16:02 — scanned 38 items, drafted 3 wins"*
- Total contribution: *"has drafted 61 of your 74 wins"*
- Actions: [ Sync now ] [ Pause ] [ Edit access ] [ Disconnect ]

**Disconnect dialog** must state the data consequence precisely and non-punitively:
> Disconnecting stops future syncs. **Your 61 logged wins stay yours** — they're already part of your record. We'll delete the raw GitHub data we cached (PR titles and descriptions) within 24 hours.
> [ Disconnect ] [ Disconnect and delete the 61 wins too ]

That second option is unusual and we ship it deliberately: offering it is what makes the first option trustworthy.

### 7.3 Error states

| Condition | User-facing treatment |
|---|---|
| Token expired / revoked at GitHub | Source → `error`; one email after the *second* consecutive failure (not the first — transient failures are common); log shows a reconnect banner |
| Rate limited | Silent. Run marked `degraded`, retried next cycle. Never surface. |
| Zero repos selected | Blocking inline error at setup; cannot save |
| Sync failing 5+ consecutive times | Auto-pause, email the user, stop retrying (protects our egress and their patience) |

`errorCount` resets to 0 on any success.

---

## 8. Future adapters (R2 — specced now so the framework is right)

### 8.1 Google Calendar
- **Pull:** events where the user is organizer or a required attendee, ≥30 min, ≤8 attendees, non-recurring *or* recurring-with-changed-title.
- **Noise:** 1:1s (unless title changed), standups, all-hands, anything with `lunch`/`coffee`/`OOO`/`PTO`, declined events.
- **Signal value:** captures `led` and `influenced` — the categories GitHub is blind to. A "Pricing architecture review — decision" meeting is exactly the kind of Win people forget.
- **Consent sensitivity: high.** Read titles and attendee *counts* only. **Never read attendee identities, descriptions, or attachments.** Say this in the consent copy; it's the difference between creepy and useful.

### 8.2 Linear / Jira
- **Pull:** issues moved to Done where the user is assignee, plus epics completed where the user is lead.
- **Noise:** issues closed as duplicate/won't-do, subtasks whose parent is also captured, issues open <4 hours.
- **High value:** these carry business framing GitHub lacks, and often carry actual metrics in the description.

### 8.3 Explicitly deferred
Slack (00 D5) · Notion/Confluence · email · Figma · Salesforce. Revisit only after calendar proves the framework generalizes.

---

## 9. Entitlements

| | Free | Career | Search |
|---|---|---|---|
| Connected sources | 1 | 3 | 3 |
| Initial backfill window | 30 days | 90 days | 90 days |
| Sync frequency | weekly | weekly | weekly + manual |
| `win_draft` calls | 30/mo (01 §10) | unlimited | unlimited |

Gating *number of sources* rather than the capture itself keeps the graph filling on the free tier while making the upgrade concrete ("connect your calendar too").

---

## 10. Telemetry

| Event | Payload |
|---|---|
| `source_connect_started` / `completed` / `abandoned` | `{kind, mode: 'public'\|'full', step}` |
| `source_repo_selection_saved` | `{kind, selectedCount, availableCount}` |
| `capture_run_finished` | `{kind, trigger, scanned, noise, candidates, drafted, costUsd, durationMs, status}` |
| `source_error` | `{kind, code, consecutiveCount}` |
| `source_disconnected` | `{kind, deletedWins: bool, winsAtDisconnect}` |
| `noise_rule_added` | `{kind, ruleType}` |

**Watch weekly:** `drafted / candidates` (drafting yield) and downstream `confirmed / drafted` (accept rate) segmented by `kind`. Target accept rate **≥60%** for GitHub. Below 50%, the drafting prompt is wrong and should be fixed before adding another source.

---

## 11. Edge cases

| Case | Handling |
|---|---|
| User's GitHub login changes | Match on account ID, not login; refresh the stored login on each sync |
| Repo renamed or transferred | `externalId` (node ID) is stable; update the cached URL |
| Repo deleted | Existing Wins keep their stored excerpt; link renders as unavailable |
| User contributes under two GitHub accounts (work + personal) | R1: one source per kind. Note it in settings copy as a known limit; R2 relaxes `@@unique([userId, kind])` to `@@unique([userId, kind, externalAccountId])` |
| Squash-merge changes commit identity | We key on the PR, not commits — unaffected |
| Long-lived PR merged months after work | `occurredAt` = merge date, but if the PR was open >60 days, prompt: *"This landed in July but you started it in April — which date should we use?"* |
| Company forbids third-party GitHub apps | Public-only mode + manual capture still work; say so in onboarding rather than dead-ending |
| Initial backfill finds 400 PRs | Cap at 40 drafts by confidence; show *"We found 400 contributions and drafted your 40 strongest. Want more? [Draft 40 more]"* |
| Two users in one org connect the same repos | Signals are per-user (`author:@me` scoped); no cross-contamination possible. Verify with a test. |
| A PR contains customer names in the body | `suggestedSensitivity = confidential`; narrative must not echo the name in the title |

---

## 12. Acceptance criteria

- [ ] Connecting GitHub with `repo` scope, selecting 5 repos, produces ≥1 Win draft within **90 seconds**
- [ ] Re-running the initial sync creates **zero** duplicate signals or Wins (unique-constraint integration test)
- [ ] Bot PRs (dependabot, renovate, github-actions) never produce a draft — verified against a fixture of 200 real PRs
- [ ] Draft accept rate ≥60% on a 100-PR labeled evaluation set, measured before launch
- [ ] **Zero** drafted Wins contain a number that does not appear in the PR title, body, or linked issue — automated check on the eval set, and this is a hard launch gate
- [ ] A `pr_reviewed` signal with only "LGTM" produces no draft
- [ ] Six PRs to the same directory within 5 days produce one grouped candidate
- [ ] Rate-limit response leaves a resumable cursor and the next run completes the window
- [ ] Disconnect deletes cached `CaptureSignal` rows within 24h; Wins survive
- [ ] "Disconnect and delete wins" removes Wins, their `Evidence`, `ClaimLink`, and Qdrant points
- [ ] Settings page answers "what can this see?" without leaving the page
- [ ] Repo picker handles a user with 500 repos (virtualized, searchable, <300ms interaction)

---

## 13. Out of scope for R1

Commit-level capture · code content analysis · GitHub org-wide install (per-user OAuth only) · writing anything back to GitHub · GitLab/Bitbucket · self-hosted GitHub Enterprise.
