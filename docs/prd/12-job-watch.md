# 12 — The job watch: companies you name, matches you can trust

Status: built 2026-10-11, flag `job_watch` (seeded off).

## 1. What it does

The user names the companies they are aiming for. Every night Patronus
checks those companies' public job boards, plus every board it already
polls when the user has stated target roles. It scores each new opening
against the user's record and sends one morning message, and only about
jobs they match **85 or more**. Each job in the message carries:

- the evidence behind the score: "evidence for 5 of 5 must-haves", plus
  the strongest requirement shown next to the user's own line that answers it;
- the main gap, if one remains;
- who to contact: a 1st-degree connection at the company (recruiters first,
  then people who can refer or hire), or a LinkedIn people search when they
  have nobody there;
- the link to the posting.

On `/watch` each match can be tracked onto the job board or passed on. "Draft
outreach and research" starts a full Scout run, which covers company
research, the people list and outreach drafts. The page also shows what was
**held back**, and why ("Scored 82, below your 85", "Needs your location").
A filter you cannot inspect is one you cannot trust.

## 2. Why company boards, not LinkedIn

LinkedIn job search sits behind a login wall and its terms forbid automated
access, so a crawler would put the user's account at risk. The owner chose
company boards only (2026-10-11). An employer's own ATS is also the source of
truth: a LinkedIn listing is a copy of it. LinkedIn still enters through
the user's own hands: Scout links, the extension, and the Connections.csv
that `findPeople` reads.

## 3. From a name to a board (`src/lib/watch/resolve.ts`)

Supported: Greenhouse, Lever, Ashby, SmartRecruiters. Lever and
SmartRecruiters were added for this feature. A probe on 2026-10-11 found
that CRED, Meesho, Zeta (Lever), Swiggy and Freshworks (SmartRecruiters)
are on neither Greenhouse nor Ashby.

Probing a name only accepts what can be verified:

| Provider | Verified by |
|---|---|
| Greenhouse | the board's own `name` must equal the company's name |
| SmartRecruiters | a posting's `company.name` must match, and the board must list something (it answers 200 with an empty list for ANY name) |
| Ashby, Lever | no name in the response, so only the exact slug of the whole name is tried |

"Equal" ignores case, legal suffixes and a short list of words that never
distinguish companies ("Technologies", "Labs", "Pvt"). It does not ignore
"Global", "Group" or "Capital": "Zeta Global" is not Zeta.

A pasted job link beats all of this (`boardFromUrl`, then one fetch to
confirm). An unresolved company stays on the list as "Not found" with that
instruction. It is never silently dropped.

Not covered: Workable (its endpoint answers 200 for accounts that do not
exist), Darwinbox, Keka, Workday, and in-house career sites. Razorpay,
PhonePe, Postman and Atlassian did not resolve in the 2026-10-11 probe.

## 4. The nightly run (`src/services/jobWatch.ts`, handler `job_watch`)

Daily dispatch fans out one child per user who watches a company or targets
a role, dedupe-keyed to the day. Each child:

1. **Refreshes** its watched boards if they were last read more than 6h ago
   (`ingestOne`, at most 10). Ingest children are staggered, and a user's own
   companies must not lag a day behind them.
2. **Shortlists** open postings from the last 30 days that have no
   `JobMatch` yet for this user. The screening is code only
   (`watch/candidates.ts`):
   - role relevance: word overlap with target roles, or the same role family;
   - level: interns and directors are separate searches;
   - location: unknown locations pass, because the fit check asks rather than
     guessing.

   Watched companies come first. With no target roles, only watched boards
   are read, and the profile headline stands in as the role.
3. **Scores** up to the plan's nightly cap with Scout's own machinery
   (`watch/score.ts`):
   - `readPosting` turns the posting into requirements. The read is stored
     on the `JobPosting`, keyed by its text, and shared by every user.
   - The matcher maps each requirement to a line of the user's record.
   - `evaluateFit` produces the score.

   A job alerted at 88 opens to a Scout card that also says 88.
4. **Gates** the result (§5) and writes a `JobMatch`, unique per
   (user, posting).
5. **Alerts** (§6).

A posting that throws while being scored leaves no row, so it is a candidate
again tomorrow. A posting scored by the keyword fallback (the model failed)
is stored, held, and retried up to 3 times.

Descriptions are stored only while a posting is open: closing it clears
`description`, `parsed` and `parsedKey`. SmartRecruiters lists postings
without descriptions, so its description is fetched only for postings about
to be scored.

## 5. The gate (`src/lib/watch/gate.ts`): fail-closed

A match qualifies only if **every** one of these holds:

- open, and posted within 21 days;
- matched by the model, or settled entirely by code. A keyword fallback
  never qualifies;
- no open preference question: an unknown that would change the verdict;
- no preference conflict (location, work mode, pay, seniority, sponsorship);
- at least 3 must-haves, so a two-line posting cannot score 100;
- score ≥ 85 and verdict `strong`;
- must-have coverage ≥ 80%;
- no blocking gap.

The first condition that fails is stored as `holdReason` and shown under
"Held back".

## 6. The message

The message is written by code, not by a model. There are at most 3 jobs,
plus a count of the rest. The channel is chosen in this order:

1. Telegram, when linked;
2. WhatsApp, when linked. Meta refuses free-form messages outside its
   24-hour window, so this send can fail and fall through to email;
3. email (template `job_alert`, category `jobAlerts`).

`EmailPreference.jobAlerts` turns job alerts off on every channel. The email
category has a budget ceiling of 2 per week. Chat messages are bounded at
one a day by the per-user daily job.

Sending is claim-then-send: the rows are stamped `alertedAt` with a
conditional update before anything goes out, so a racing run claims nothing.
If every channel fails, the claim is released.

## 7. Limits and cost (`src/lib/plans.ts`)

| | Free | Career | Search |
|---|---|---|---|
| Watched companies | 3 | 10 | 30 |
| Postings scored per night | 5 | 10 | 25 |

These are placeholders until pricing is decided, and are env-overridable.
One scored posting is one matcher call (~$0.0006 on gpt-6-luna), plus a
posting read (~$0.001) shared by every user it is scored for. Quiet nights
cost nothing.

## 8. Data

- `WatchedCompany(userId, companyKey)` is unique; it holds the status and
  the board.
- `JobMatch(userId, postingId)` is unique. It holds:
  - the score, verdict and `matchedVia`;
  - `qualifies` and `holdReason`;
  - `fit`: FitData plus coverage;
  - `people`: NetworkData, computed only for qualifying matches;
  - `status`: new, alerted, tracked or dismissed;
  - `attempts`, `alertedAt` and `workspaceId`.
- `JobPosting` gained `description`, `parsed` and `parsedKey`.
  `JobBoardProvider` gained `smartrecruiters`. `EmailPreference` gained
  `jobAlerts`.

## 9. Added after launch (2026-10-11)

- **Wins in the fit record**, for Scout and the watch. Confirmed, shareable
  Wins only, filtered in the query (`externalRetrievalFilter`, rule 3),
  because a matched line is quoted on the fit card and into outreach drafts.
  The newest 30 are added as "Work log" lines after the roles.
- **Re-checks.** Each `JobMatch` stores `recordKey`, a fingerprint of the
  record and preferences it was scored against. Held matches that scored 60
  or more, and are still open and fresh, are re-scored when it changes. That
  happens when a Win is confirmed or a preference is set. An unchanged record
  re-scores nothing.
- **Telegram buttons.** One row per job: `jw:t` (track), `jw:o` (outreach:
  starts Scout on the posting) and `jw:x` (not for me). Each tap is scoped to
  the user the chat is linked to, and spent buttons are removed from the
  message. WhatsApp stays text plus a link.
- **Recruiters and hiring managers by search** (`src/lib/research/people.ts`).
  - **Searches:** two Tavily searches restricted to public `linkedin.com/in`
    profiles, one for recruiters and one for managers in the role's family
    and team.
  - **No model:** the name and headline come from the result's page title.
    It is accepted only when the title itself names the company exactly, so
    a snippet mentioning a former employer is rejected.
  - **Citation:** each person cites the page and the date it was found, and
    the UI asks the user to check the profile is current.
  - **Cache:** 14 days, shared across users, keyed by public facts only.
  - **Where it shows:** in Scout's people list (tier `found`). Drafts are
    addressed by name only to someone the run actually found, resolved
    server-side by profile URL. In the job watch, it runs for qualifying
    matches only, at most 5 companies per run.

## 10. Not yet

- WhatsApp buttons. Alerts are long, and interactive messages cap the body
  at 1,024 characters.
- More ATSes: Workable with a real existence check, Workday, Darwinbox.
- **Unproven live:**
  - an end-to-end run against a real model;
  - an alert in a real Telegram chat;
  - live Tavily results for people search. Title parsing is tested against
    LinkedIn's title formats, but no key was available to run a real query;
  - a SmartRecruiters board at scale (the adapter caps at 1,000 postings).
