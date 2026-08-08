# Patronus — customer audit, 8 Aug 2026

**Method — and its limit, stated first.** I did **not** sign in and click through the
product. No browser session, no rendered page, no Clerk account. Everything below comes
from four evidence sources, and §0 grades every finding by which one it rests on:

- **Live model runs.** Three end-to-end generations through the rebuilt v2 pipeline with
  real `gpt-5` calls, plus two live runs of the free `/score` checker — none of them a
  senior backend engineer, because that is the one profession the 7 Aug audit tested and
  the one the code was tuned against.
- **The live database.** The `FeatureFlag` table, read directly.
- **HTTP probes of the production deployment** at `aicv.theweekendworld.com`.
- **Source.** Every customer-reachable surface, the entitlement and billing paths, the
  extension manifest.

What this cannot tell you: how anything renders, whether a real Clerk sign-up completes,
whether the extension attaches to a live ATS page, or how any of it feels. Those need a
browser and a login, and are not claimed here.

Baseline health first, so it is not mistaken for the story: `bunx tsc --noEmit` is clean,
`bun test` is **1897 pass / 0 fail** in 13s, `bun run lint` is at zero. The engineering is
not the problem. What a customer can actually reach is.

**Verdict.** The 7 Aug audit found a broken resume behind a finished product. Six commits
later the resume is genuinely better and the finished product turns out to be
unreachable. Every feature the pricing page sells — the work log, GitHub capture, the
weekly digest, review packets, Month in Review, backfill, Radar, Missions — is switched
off in the database, two of them have no flag row at all, there is no admin surface that
can switch them on, and five of them have no navigation entry point even if you did.
Nothing can be purchased, because no Stripe price exists. The product a paying customer
would receive today is: a resume builder, an editor, a free score, and a Chrome
extension.

And inside that product, the pipeline still drops the customer's best evidence and then
tells them they lack it — the exact failure of 7 Aug, reproduced on the first
non-engineering persona, through a different mechanism.

---

## Part 0 — Two corrections to the framing above

### F0 — Production is running a build from before the repositioning 🔴

Everything in Parts 1–3 describes the code in `main` + `browser-extension`. It describes
almost nothing a real customer can reach, because **none of it is deployed.**

`aicv.theweekendworld.com`, probed 8 Aug:

```
/            200   headline: "Resumes that get you interviews"
                   pricing on page: $0 / $9        ← not $5 / $2
/score       404   ← the free checker, the hero's second CTA
/welcome     404   ← the onboarding rebuild from yesterday
/dashboard   404
/build       404
/editor      404
/packets     404   /radar 404   /home 404
/sign-in     200   /privacy 200   /terms 200
```

The live headline is the pre-v3 one. `Hero.tsx` in the repo says
*"Your company owns your work history. This one is yours."* with CTAs "Start your work
log" and "Check a resume — free". None of that string appears in the served HTML. The
live pricing is `$9`; `plans.ts` says `$5` and `$2`.

So the Career OS repositioning, the 7 Aug resume rebuild, the Job Match panel, the honest
free score, the onboarding flow — six commits, two days — are **not in front of anyone**.
And every authenticated route returns 404, which means the deployed build predates the
`(app)` route group entirely.

This reorders the whole plan below. Fixing the flag table (F1) and shipping navigation
(F2) change nothing for a customer until a current build is deployed. **Deploy is item
zero.** It is also the cheapest possible way to find out how much of Parts 1–3 is real,
because most of those findings become directly observable the moment a real build is up.

### F0b — Evidence grade, per finding

I mixed hard evidence with inference in the first draft. Corrected:

| Grade | Findings | What backs them |
|---|---|---|
| **Observed** — ran it, or read the row | F0 (HTTP probes), F1 (DB query), F5–F13 (live model output + verified code paths) | reproducible without a browser |
| **Code-certain** — a fact about the source, not a rendering | F2 (no nav exists), F3 (`notFound()` calls), F4 (Clerk `forceRedirectUrl`), F14 (no Career prerequisite), F15 (unfiltered table), F16 (no `gateMeteredAction` call) | true unless I misread; each cites file:line |
| **Inferred UX** — how it *feels*, not tested | the emotional read of the gap report; whether a 404 reads as broken; whether the extension permission prompt deters installs | needs a browser and a login |
| **Market analysis** — external, not about your code | F17, Part 4 | cited sources |

No finding in this document rests on having used the product as a signed-in human,
because I did not.

I traced the real path: sign up → `/welcome` → upload resume → history imported →
`/build` → paste a posting → wait → editor.

That path works, and the onboarding rebuild (af01038) is a genuine improvement — the
`/score` handoff is collected, the resume is not asked for twice, and the Clerk
`forceRedirectUrl` leak is closed. Everything else is a wall.

| Surface | Sold on the pricing page | State for a real customer |
|---|---|---|
| Build + editor + PDF | yes | **works** |
| Free ATS score | yes (Free) | **works**, with defects — §2.6 |
| Chrome extension | yes (all tiers) | **works**, inherits every resume defect |
| Work log / Wins | yes (Free) | **404** — `work_log` flag off |
| GitHub auto-drafting | yes (Free) | **404** — no `github_capture` row exists |
| Weekly digest | yes (Free, all tiers) | **dead** — no `weekly_digest` row exists |
| Review packets / brag doc | yes (Free: 1 lifetime) | **404** — `review_packet` off |
| Level readiness vs rubric | yes (Career) | **404** |
| Month in Review | yes (Career) | **404** |
| Backfill ("reconstruct the years before Patronus") | yes (Career) | **404** |
| Career Radar | yes (Career) | **404** |
| Missions / Home | — | **off** (`enabled=false`, rollout 100) |
| Buy anything | yes | **impossible** — no `STRIPE_*` env vars set |

### F1 — Every sold feature is off, and two cannot be turned on 🔴

`FeatureFlag` in the live database holds six rows. `FEATURE_FLAGS` declares eight.
`github_capture` and `weekly_digest` have **no row**, and `decideFlag(undefined, …)`
returns false (`src/lib/flags.ts:106`) — so they are off for everyone including the
admin allow-list, permanently.

The cause: `ensureFlagsSeeded()` (`src/lib/flags.ts:136`) is described as "idempotent,
safe to run on every deploy" and **has no caller anywhere in the codebase**. A code
comment in `src/services/competency.ts:333` already noticed this and nothing was done.

Worse, there is no write path at all: `grep featureFlag src/actions/admin.ts` returns
nothing. Flags can only be changed by hand-written SQL against production. There is an
`/admin` route, and it cannot do the one operation that gates the entire product.

**Customer impact:** a person who pays $5 for Career receives, today, zero of the five
things Career lists.

### F2 — There is no navigation 🔴 — ⚠️ **PARTLY RETRACTED, see §6.1**

`src/app/(app)/layout.tsx` is nine lines: a `div` and a generation banner. There is no
header, no sidebar, no tab bar. Grepping every component for links to the product's own
surfaces finds **nothing anywhere links to `/packets`, `/radar` or `/home`**. The only
cross-links in the whole app are `/log` and `/dashboard`, from inside two features.

So even with the flags on, five built features are reachable only by typing the URL.
The 7 Aug audit filed this as "IA / navigation — deferred". It is not an IA refinement
that was deferred; there is no navigation to refine.

### F3 — Gated surfaces 404 instead of selling 🟠 — ❌ **WRONG, RETRACTED, see §6.2**

`/log`, `/packets`, `/radar`, `/log/readiness`, `/log/backfill` and `/settings/sources`
all call `notFound()` when their flag is off (`src/app/(app)/log/page.tsx:31` and
siblings). The landing page's **primary CTA is "Start your work log" pointing at
`/sign-up?redirect_url=/log`** — the one button the hero is built around leads to a page
that returns 404.

A 404 is the correct choice for hiding an unreleased feature from a stranger. It is the
wrong choice for a customer who was sold the feature thirty seconds ago on the pricing
page. Those are different audiences and they currently get the same response.

`/home` and `/radar` also `notFound()` when the *data load* fails — so an infrastructure
error is indistinguishable from a feature that does not exist.

### F4 — Purchase intent is dropped at sign-up 🟠

`Pricing.tsx:79` sends "Get Career" to `/sign-up?redirect_url=/settings/plan`. The
sign-up page sets `forceRedirectUrl="/welcome"` (`src/app/sign-up/[[...sign-up]]/page.tsx:31`),
which in Clerk overrides the query parameter, and `finishOnboarding()`
(`src/actions/onboarding.ts:170`) then routes to `/build` or `/home`. The customer never
reaches the checkout they clicked.

This is the *same bug*, on the same line of code, that af01038 was written to fix for the
`/score` handoff. The fix carried the score stash through and left the pricing CTA
behind. The highest-intent click in the funnel is the one still leaking.

---

## Part 2 — The resume, tested as three customers who are not engineers

I ran the full v2 pipeline live for a product designer, a growth marketer, and a career
switcher into data analysis. Full inputs and outputs are reproducible from the harness.

| Persona | Coverage score | Skills shipped | Wall clock |
|---|---|---|---|
| Product Designer → Senior PD, fintech | 73 | 5 | **200 s** |
| Marketing Manager → Growth Lead | 66 | 7 | **231 s** |
| Ops Coordinator → Junior Data Analyst | 61 | 6 | **138 s** |

The rebuild's core claims hold: no fabricated skills, no invented numbers, no mangled
title, and the dropped-line report is real and restorable in the editor. Those were the
7 Aug defects and they are fixed. What follows is what the rebuild did not reach.

### F5 — The posting's "What you'll do" section is parsed and thrown away 🔴

`readPosting` extracts `responsibilities` into the brief (`src/lib/resume/posting.ts:264`).
**Nothing consumes it.** Not `scoreBullets`, not `selectBullets`, not `computeCoverage`,
not the editor's Job Match panel. Grep confirms the field appears only in its own parser
and in test fixtures.

For the designer posting that meant seven day-to-day expectations were read and
discarded, including verbatim:

> *"Raise the bar on craft across the design team, and mentor designers earlier in their career"*
> *"Contribute to and evolve our design system"*

And the bullet the pipeline dropped, for reason `cap`:

> *"Facilitated quarterly design critiques and mentored one junior designer through her first solo feature."*

That is the 7 Aug failure, verbatim, on the first try. The rebuild's cover-pass saves any
bullet answering a stated **requirement**; it has no idea a responsibility was ever
stated. Most modern postings put the real signal in "What you'll do" and reserve
"Requirements" for years-of-experience boilerplate — which means the half of the posting
that matters most is the half being discarded.

### F6 — The system drops the evidence, then reports it as missing 🔴

The marketer's resume has a hard must — *"at least 2 years owning a paid budget over $1M"*
and *"Experience managing and developing marketers"*. Her history contains the answer:

> *"Manage a team of three and a £1.2M annual budget."*

The four-bullet cap dropped it (`reason: cap`), and the gap report then told her:

> *"Nothing on your resume answers: 'Experience managing and developing marketers'"*

This is the single most damaging thing the product can do. It is not a missed
optimisation — it manufactures a false negative about the customer's own career and
presents it as analysis. The same run also dropped *"Ran the go-to-market for two product
launches"*, which answers the launch/GTM thread of the posting.

The mechanism: selection caps at four bullets per role (`src/lib/resume/tailor.ts:82`)
**before** coverage is computed, and coverage only ever sees `selection.kept`. A bullet
that was cut for space is indistinguishable, downstream, from a bullet that never existed.

Minimum fix: compute coverage over *all* scored bullets, and where a requirement is
answered only by a cut line, say so — *"you have this, it did not fit; swap it in"* — which
is both true and the most useful sentence the product could produce.

### F7 — Coverage never reads the education or skills sections 🔴

`computeCoverage(requirements, keptBullets, tenureYears)` (`src/lib/resume/coverage.ts:76`)
takes three inputs. The resume's own education and skills arrays are not among them.

The career switcher, who holds a BS from Texas State, was told:

> *"Nothing on your resume answers: 'Bachelor's degree in any field'"*
> *"Nothing on your resume answers: 'Working knowledge of SQL'"*

SQL is in the skills section of the very document being scored, and in both of her
project entries. The product contradicts itself inside one screen. For a career switcher
— the customer with the least confidence and the most to gain — the entire advice block
is five lines of "nothing answers / not covered", every one of them either wrong or
unactionable.

### F8 — The years regex fabricates *qualification* 🔴

`yearsAskedFor` (`src/lib/resume/coverage.ts:69`) matches `/(\d+)\s*\+?\s*years/` anywhere
in a requirement and credits it from the date range alone. Live output from the free
score, for a resume with no budget figure anywhere:

```json
{ "text": "2+ years owning a paid budget over $1M", "kind": "must", "byDates": true }
```

The product told a stranger they meet a $1M budget-ownership requirement on the strength
of having been employed. This is the mirror image of the fabrication invariant: the
guard stops the resume inventing numbers, and nothing stops the *scorer* inventing
qualifications. It should require the requirement to be about tenure ("5+ years
designing digital products"), not merely to contain a number and the word "years".

### F9 — The skills taxonomy only knows engineering 🟠

`extractSkills` over the designer's entire career yields exactly three slugs:
`accessibility`, `figma`, `swift`. `MAX_SKILLS` is 20; she shipped 5. Verified directly:

```
false  | slug=null           | Design systems      ← plural loses to singular
true   | slug=null           | Design system
false  | slug=null           | Usability testing
false  | slug=null           | User research
false  | slug=null           | Wireframing
false  | slug=null           | Interaction design
false  | slug=null           | Information architecture
false  | slug=null           | Journey mapping
false  | slug=null           | Stakeholder management
true   | slug=swift          | SwiftUI             ← becomes "Swift" on the resume
```

Three consequences, all live:

1. **"Design systems" was dropped over one letter.** The posting names it as a must, her
   history plainly evidences it ("Built and maintained the design system in Figma — 90
   components"), and the word-boundary fallback (`src/lib/resume/skills.ts:91`) failed on
   the plural. No stemming, no normalisation.
2. **A product designer's resume shipped "Swift"** — a programming language she does not
   write — because `SwiftUI` normalises to the `swift` slug. Technically evidenced,
   materially a misrepresentation, and the one entry a hiring manager would probe.
3. **The design vocabulary does not exist in the taxonomy at all**, so the third pass that
   is supposed to backfill the section from the candidate's own text has nothing to
   backfill with. The comment at `skills.ts:157` says a two-item skills list "reads as a
   broken tool" — a five-item list missing the three most relevant entries reads the same
   way.

The marketer's list, meanwhile, shipped **"Search"** and **"Social"** as skills — fragments
split out of the posting's phrase "paid acquisition across search, social and
programmatic". `posting.ts` cleaned the obvious sentence-shaped entries; single words
that are not skills still pass. Her gap list claims she lacks "Marketing automation"
while the resume above it describes her HubSpot lifecycle programme, and claims the
switcher lacks "R" while her project bullet says she analysed 5.8M rides *in R*.

### F10 — Every summary is addressed to the employer 🟠

All three, unprompted, produced the same construction in sentence two:

> "**Fit for Northbeam's** Senior Product Designer, Payments role through leading initiatives…"
> "**Well-suited to Palvo's** Growth Marketing Lead role by focusing on…"
> "…**well-suited to the Data Analyst role at Verrick Logistics.**"

No human writes this. It reads as mail-merge, it is the first line a recruiter sees, and
it is the tell that gets a document binned as AI-generated. The designer's summary also
opens "Product Designer focused on…" while the title line directly above it — which the
pipeline correctly upgraded — says "Senior Product Designer".

### F11 — Two to four minutes of waiting, described as 60–90 seconds 🟠

Measured wall clock: 200s, 231s, 138s. `src/lib/generationProgress.ts:3` documents the
wait as "60-90 second". The stage labels were rewritten in 3025d53 to stop lying about
the work; the duration they were written for is off by 2–3×.

`getGenerationDetailLines` also still renders **"Current ATS estimate: N%"**
(`generationProgress.ts:86`) for a number that is no longer an ATS estimate — the one
term the rebuild's own documentation says it abandoned.

### F12 — Resume reuse is dead, and will match the worst resumes 🟠

`Resume.atsScore` now stores the coverage score (`generateResume.ts:878`). The reuse
fast-path still requires `atsScore >= 80` (`config.ts:78`, applied at
`generationPipeline.ts:234`) — a threshold calibrated when the old keyword score
reliably returned 95. My three live runs scored 73, 66 and 61.

So reuse will essentially never fire again: every generation pays the full ~$0.06 and the
full four-minute wait. And because pre-rebuild resumes still carry inflated ~95 scores in
the same column, the only rows that *can* match are the old ones — the reuse path is now
biased toward serving the exact documents the rebuild was written to replace.

### F13 — The free score is generous, unstable, and near the timeout 🟠

The free checker is the top of the funnel and the surface strangers judge the product by.
I ran a deliberately mediocre real-world resume — "Hard-working marketing professional…
Passionate about brands… Team player with excellent communication skills", not a single
number anywhere, five bullets beginning "Responsible for" / "Helped" / "Assisted".

- **Scored 64/100, band "good"** (`deriveBand`, `anonScoreSchema.ts:113`, ≥60 = good). That
  resume is not good. Grade inflation here is not only dishonest, it is
  *counter-conversional*: if the free tool says my resume is already good, the paid
  product has nothing to sell me.
- **Not reproducible.** Two runs of the identical input returned job-match 38 and 33, with
  different requirements in the answered set. A customer who refreshes gets a different
  verdict from a product whose entire thesis is trustworthy measurement.
- **53 seconds** against `maxDuration = 60` on the route (`src/app/api/score/route.ts:8`).
  A slightly longer resume or posting times out, and the stranger's first impression of
  Patronus is a 504.
- One suggestion coached the user to write *"increasing marketing-sourced pipeline by
  [X]%"* — handing a blank percentage to fill in, from the product that exists to stop
  people inventing numbers.

---

## Part 3 — The money

### F14 — Search at $2 strictly dominates Career at $5 🔴

`PLAN_FEATURES.pro` is a superset of `PLAN_FEATURES.always_on` (`src/lib/plans.ts:323`),
effective tier is `maxTier` over active subscriptions (`src/lib/entitlements.ts:154`), and
`startCheckout` (`src/actions/billing.ts:115`) has **no requirement that Career be active
before Search is bought**. The pricing page's own copy says Search is "Everything in
Career" and the note says it "sits on top of Career" — but nothing enforces that.

A rational customer buys Search alone for **$2/month** and receives every Career
capability plus unlimited tailored generations, instead of $7 for both or $5 for less.
The upsell ladder inverts: the cheapest paid plan is the best one.

### F15 — The in-app upgrade page sells four features that do not exist 🟠

`Pricing.tsx:16` carries an explicit, correct comment: `PLAN_COMPARISON` "currently
includes rows for capabilities that are not built yet; listing them to a logged-out
visitor deciding whether to trust us would be exactly the kind of unearned claim this
product refuses to put in a resume."

The marketing page therefore filters them out — and `PlanScreen.tsx:424` renders the
unfiltered table to the **authenticated customer at the moment they choose a plan**. Multi-step
apply orchestration, interview prep, negotiation mission and ATS auto-fix are all listed
as included in Search. None exist. The judgement was made and then applied to the
audience that matters least.

### F16 — Four metered actions have limits and no enforcement 🟠

`METERED_ACTIONS` declares ten. Six are gated. **`month_in_review`, `cover_letter`,
`radar_refresh` and `tier2_grounding` are never passed to `gateMeteredAction` anywhere.**
`month_in_review` is `period(0)` on Free — it is the flagship Career differentiator in the
comparison table — and the moment its flag turns on, every free user has it, unmetered.

### F17 — $2/month is the industry's scam price 🟠

Market context, because this one is not visible from inside the code. The resume-tool
category has trained buyers to distrust a specific pattern: sign up for a ~$2 trial,
discover a ~$25 charge two weeks later. That is the documented dark pattern of the
segment Patronus is positioning against.

Patronus's honest, cancel-any-time Search plan is priced at **exactly that number**. The
product whose entire brand is "we do not lie to you" has adopted the price point buyers
have been conditioned to read as bait. It also barely survives contact with payments:
Stripe takes ~$0.36 of a $2 charge — 18% of revenue — before a single model call.

---

## Part 4 — Product analysis

### The thesis is right and the packaging is fighting it

Career OS is a genuinely differentiated bet: the record is permanent, the job search is
the monetisation event, and `Evidence(confirmedByUser) + ClaimLink(grounded)` is a moat
no resume builder has. That is the correct strategy and the code honours it.

But the category has moved while this was being built. The brag-doc space now has
dedicated products — BragBook, bragdocument.io, BragDoc.ai — and at least one does
precisely Patronus's `github_capture`: commits and calendar in, brag document out. The
uncontested-category assumption in the strategy doc is no longer safe. Patronus's
advantage over them is the evidence chain and the fact that the log feeds a resume; that
advantage is worth nothing while the log 404s.

### Pricing is 5–10× below the market, in the wrong direction

Teal is $29/month, Rezi $29/month, Kickresume $19/month, Jobscan comparable. These are
commodity tailoring tools. Patronus is $5 + $2.

Underpricing is not humility here, it is a positioning error with three costs. It signals
"cheap tool" to the exact buyer who spent $500 on their last job search. It leaves the
company unable to fund a support promise it already prints ("Email, 1 business day" for
$2/month). And it makes the free tier — unlimited wins forever, GitHub capture, weekly
digest, a brag doc, an ATS score — so generous that Career's remaining differentiation is thin.

The structural insight the pricing has not absorbed: **the log is the retention asset and
the search is the willingness-to-pay event.** The current split prices them backwards.
Career (permanent, low churn, low marginal cost) is the expensive one at $5; Search (the
moment someone will pay almost anything, and will churn in eight weeks regardless) is
$2. Invert it. Something like Career $8–12/month annual-billed and Search $25–29/month —
priced at market, cancellable in one click, with the no-deletion promise doing the
retention work — collects revenue where the urgency is and keeps the record as the reason
to stay subscribed between searches.

### The value gap, stated plainly

The product's promise is *"we will not tell you anything we cannot evidence."* It keeps
that promise in one direction — nothing false goes onto the page — and breaks it in the
other: it routinely tells customers they lack things they demonstrably have (F6, F7, F9),
and once told a stranger they had something they did not (F8). A candidate can survive a
resume that omits a bullet. They cannot survive a tool that tells them they are
unqualified for a job they are qualified for, and neither can the tool's retention.

Every gap report I generated was 100% negative — five lines of "nothing answers", "not
covered", "left off", with no positive summary and no next action. For the career
switcher this is actively harmful. The same data supports a far better artifact:
*"you answer 7 of 9 musts; two of them only via a line we had to cut — put it back;
one real gap: SQL."* Same computation, opposite emotional outcome, and it is the version
that gets shared.

### What I would add, ranked by value per unit of work

1. **Make the gap report the product.** It is already the most defensible thing here and
   it is currently a rejection letter. Turn it into: covered / covered-but-cut (one-click
   restore, already built) / genuinely missing / *how to close it* — with the closable
   ones linking straight into the Work Log to capture the evidence. That single change
   connects the resume to the log, which is the strategy the whole company is built on
   and is not connected anywhere today.
2. **Ship one navigation bar.** Five built features are invisible. This is a day of work
   standing between the customer and roughly 60% of what has been built.
3. **A "before/after" moment in the first session.** The free score's job is not to grade,
   it is to show the delta. Score the uploaded resume, then show the same resume against
   the same posting *after* tailoring, side by side, requirement by requirement. Nothing
   in the funnel currently demonstrates the product's value; it only asserts it.
4. **Per-posting evidence prompts.** When a requirement is genuinely unanswered, ask one
   question — "have you ever owned a paid budget over $1M?" — and write the answer into
   the log as evidence. That is backfill, pointed at the moment of highest motivation
   instead of at a cold "reconstruct your career" screen.
5. **Non-engineering profession packs.** The taxonomy, the strength rubric and the
   "prioritise engineering signals" heritage all assume one profession. Design, marketing,
   data, ops, finance, healthcare — each needs a vocabulary, and this is a data problem,
   not a modelling one.
6. **A generation eval corpus.** The 7 Aug audit asked for this, it was not built, and
   every finding in Part 2 is something a ten-pair corpus across three professions would
   have caught before I did. Assertions: no unevidenced skill; no dropped bullet that
   answers a stated must *or responsibility*; no requirement reported unanswered when the
   resume, education or skills answer it; no requirement auto-answered by tenure unless
   it is a tenure requirement.

---

## Part 5 — What I would do, in order

**This week — nothing launches without these**

| # | Fix | Why | Size |
|---|---|---|---|
| 0 | **Deploy a current build.** Nothing below reaches a customer until this happens | F0 — production predates the repositioning | unknown until you look at why it is stale |
| 0b | `import type { MissionType }` in `missions/catalog.ts` + string-literal keys | §6.3 — `/home` is a blank white page | 10 minutes |
| 1 | Call `ensureFlagsSeeded()` on boot; add flag write to `/admin`; decide which flags go on | F1 — the product is invisible | hours |
| 2 | Ship a global nav in `(app)/layout.tsx` | F2 — five features are unreachable | 1 day |
| 3 | Feed `brief.responsibilities` into scoring, selection and coverage | F5 — the 7 Aug bug, reproduced | 1 day |
| 4 | Compute coverage over all scored bullets; mark "answered by a line we cut" | F6 — the worst behaviour in the product | 1 day |
| 5 | Require a Career subscription before Search checkout, or reprice | F14 — $2 dominates $5 | hours |
| 6 | Filter `PLAN_COMPARISON` to built features on `PlanScreen` | F15 — selling vapour to buyers | 1 hour |

**Next — before anyone pays**

| # | Fix | Size |
|---|---|---|
| 7 | Coverage reads education + skills (F7); tenure credit only for tenure requirements (F8) | 1 day |
| 8 | Skills: stemming/plural normalisation, block sub-token slug matches like SwiftUI→Swift, non-engineering vocabulary (F9) | 2–3 days |
| 9 | Rewrite the summary prompt — ban naming the employer, match the chosen title (F10) | hours |
| 10 | Honest wait copy + progress; rename "ATS estimate"; recalibrate `minAtsScore` for the coverage scale and re-baseline stored scores (F11, F12) | 1 day |
| 11 | Free score: recalibrate bands, pin determinism, raise `maxDuration` above the real p95 (F13) | 1 day |
| 12 | Gate `month_in_review`, `cover_letter`, `radar_refresh`, `tier2_grounding` (F16) | hours |
| 13 | Carry `redirect_url` through onboarding so pricing CTAs reach checkout (F4) | hours |
| 14 | Serve gated surfaces an upgrade/coming-soon state to signed-in users; 404 only strangers (F3) | 1 day |
| 15 | Create the Stripe Prices, revisit the ladder (F17) | blocked on a pricing decision |
| 16 | ~~Narrow the extension from `<all_urls>`~~ — **done**, see §7 | ✅ |
| 16b | The extension fix list in §7 ("Extension fix order"). E-1 and E-2 belong in the this-week table above | see §7 |
| 17 | Build the generation eval corpus | 3 days |

---

## Part 6 — The browser pass, and what it overturned

Added after the audit above was written. Signed in as the real account on
`localhost:3000` and walked the product. Two findings did not survive contact with the
screen; one new one appeared. **Caveat, stated up front:** the dev server had been running
since before the last `prisma generate`, so some of what I saw is environment staleness
rather than product state — flagged individually below.

### 6.1 — F2 partly retracted: there are *two* navigations, and neither has the product in it

I claimed there is no navigation. Wrong — `(app)/layout.tsx` has none, but the screens
supply their own, and there are two that do not agree:

- **`/dashboard`** renders its own sidebar: *Overview · Applications · My Resumes ·
  Copilot · Profile · Telegram · PDF History.* That is the legacy resume-builder IA.
- **`/log`, `/packets`, `/radar`, `/settings/plan`** render a different, minimal global
  header: *Patronus · Resumes · [Tailor a resume].*

So the corrected finding is sharper than the wrong one: **neither navigation contains a
single Career OS surface.** No Work Log, no Packets, no Radar, no Home, no Month in
Review, no Backfill. The legacy sidebar advertises a product the strategy replaced; the
new header advertises one item. The discovery problem in F2 is real and my explanation of
it was not.

### 6.2 — F3 fully retracted: the gated surfaces are handled well

I read `notFound()` in the page source and concluded customers get a bare 404. They do
not. There is a route-segment not-found view, and it is one of the better things in the
product:

> **The Work Log is not switched on yet**
> The running record of what you have actually done — the thing every resume, packet and
> review here is built from. It is built and it is coming.
> *Nothing you have recorded is affected, and you will not be charged for it until you can use it.*
> `[Back to your resumes]` `[Tailor a resume]`

Feature-specific copy, honest about state, explicit that nothing is lost and nothing is
billed, two escape routes. `/packets` and `/radar` render the same pattern with their own
wording. **This finding was wrong and I should have checked before filing it** — reading a
`notFound()` call is not the same as seeing what a customer sees, which is the whole
reason the browser pass mattered.

### 6.3 — NEW: `/home` renders a blank white page 🔴

Not an empty state — a blank document. The server throws at module evaluation:

```
TypeError: Cannot read properties of undefined (reading 'get_promoted')
  at module evaluation (.next/dev/server/chunks/ssr/src_d6e7feba._.js)
```

Mechanism, and it is code-certain regardless of the stale server:

- `src/components/missions/HomeScreen.tsx` is a `'use client'` component
- it imports `@/lib/missions/catalog`
- `src/lib/missions/catalog.ts:26` does a **value** import: `import { MissionStepKind, MissionType } from '@prisma/client'`, and uses `MissionType.*` as a runtime value **23 times** (first at `catalog.ts:94`)
- in the client/SSR bundle `@prisma/client` has no runtime enum object, so `MissionType` is `undefined` and the module throws before React renders

`src/lib/plans.ts:3-9` documents this exact hazard and avoids it with a type-only import:

> *"`Tier` is imported as a TYPE only… a value import of `@prisma/client` would drag the
> Prisma runtime into the browser bundle."*

`catalog.ts` did the thing `plans.ts` was written to warn against. Fix is a one-liner —
`import type { MissionType }` plus string-literal keys, exactly as `plans.ts` does it.

**Why the test suite cannot see this:** `bun test` resolves `@prisma/client` normally, so
`MissionType` is defined and all 1897 tests pass. This is the second recorded instance of
the same failure mode — a green Bun suite hiding a defect that only exists in the Next
runtime. That pattern is now worth a guard: an ESLint rule banning value imports of
`@prisma/client` from any module reachable by a `'use client'` component would have caught
it at write time.

### 6.4 — NEW: the dashboard reports infrastructure metrics to the customer 🟠

`/dashboard` greets "Welcome back, JAI SHANKAR" (name rendered in raw caps as stored) over
nine stat tiles, including **"Tokens used — 3,414"** and **"Cost (USD) — $0.01"**.

A job seeker does not know or care what a token is. Showing them the vendor bill is a
developer's debug panel promoted to the customer's home screen, and it quietly undercuts
the pricing story — a customer who sees their monthly usage cost $0.01 has been handed the
argument against paying $5. The other tiles are all zeros with no guidance about what to
do next.

### 6.5 — Environment staleness, not a product defect

`/settings/plan` failed with "Your plan didn't load". The cause is
`PrismaClientValidationError: Unknown field 'slot' … on model 'Subscription'` — but
`schema.prisma` has `slot`, the generated client has `slot`, and the database column
exists. Running the identical query in a fresh process succeeds. **This is the dev server
holding a Prisma client generated before the `Subscription.slot` refactor, not a bug in
your code.** Restart it and the page should load.

Worth recording what the failure *did* show, because it is genuinely good:

> **Your plan didn't load.** Your subscription and your record are untouched — this is the
> page failing to read them, nothing more. No charge was made and nothing was cancelled.
> `[Try again]` · Reference 3322056048

That is how a billing error should read, with a reference code to quote at support. Same
for the not-found states in §6.2. The error and empty states are consistently the most
finished part of this product.

### 6.6 — What the browser pass changes about the plan

Nothing in Part 5 moves. F3 comes off the list entirely, F2 stays but its fix is "put the
Career OS surfaces into whichever navigation survives, and retire the other one" rather
than "build a nav from nothing". §6.3 is a new one-line fix that should go in the
this-week table, above everything except the deploy.

---

## Part 7 — The Chrome extension, tested on live job postings

Method: built it (`bun run ext:build` — clean, 1729 modules, 1.06s), type-checked it
(clean), ran its tests (8 pass), then **bundled the real parser modules and executed them
against live job pages in a real browser**. Not fixtures — the actual production
`classifyPage`, `reduceDom`, `extractJobDescription`, `extractJobMetadata` and
`collectNormalizedFields`, run on:

- **Ashby** — Staff Product Designer @ Ashby (job page *and* its live application form)
- **Greenhouse** — Performance Engineer @ Anthropic (28 real fields, 13 real questions)

**Already fixed since Part 5 was written:** item 16, the `<all_urls>` host permission. The
manifest now scopes to nine job hosts plus `activeTab` and optional host permissions, with
a docstring explaining why. That was the right call and it is done.

### What genuinely works

Platform detection is correct and confident. Ashby job page → `ashby` / `job_detail` /
**0.88 high**; the Ashby form → `application_form`; Greenhouse → `greenhouse`. JD
extraction pulled 11,605 clean characters off the Ashby page with the boilerplate
stripped. `companyName: "Ashby"` and `roleTitle: "Staff Product Designer"` were both
exactly right. On the Greenhouse form the core identity fields are excellent — First Name
0.97, Last Name 0.97, Email 0.93, Phone 0.99 — and the two `Attach` file inputs were
correctly split into `resume_upload` (0.99) and `cover_letter` (0.81) purely from their
`name` attributes, which is a nice piece of work. Both real Ashby essay questions were
found and flagged as custom questions at 0.84/0.93. The API surface is correctly
authenticated: `page/analyze`, `resume/generate`, `questions/suggest` and
`company-insight` all return 401 unauthenticated.

The skeleton is good. The semantic layer on top of it is where the problems are, and one
of them is serious.

### E1 — A visa-sponsorship question is classified as a "project story" 🔴

Reproduced deterministically, and live on the Anthropic form:

| Question (real, from the live form) | `typeHint` returned |
|---|---|
| "Do you require visa sponsorship?*" | **`project_story`** |
| "Will you now or will you in the future require employment sponsorship?" | **`project_story`** |
| "Are you legally authorized to work in the US?" | `eligibility` ✓ |

`extension/src/parsers/fieldDetector.ts:389` tests `/project|build|ship/` **two lines
before** `:391` tests `/authorized|eligible|citizen|sponsorship|visa/`.

`ship` is a substring of "sponsor**ship**". Every sponsorship question in existence matches
the project rule first and never reaches the eligibility rule.

Why this is the most serious defect in the extension: the Answer Library exists to reuse a
saved answer when it recognises a question's type. A question typed `project_story` will
be offered — or auto-filled — with the candidate's saved *project story* in a field asking
about their **work authorisation**. Misstating work authorisation on an application is the
category of error that gets an offer withdrawn or a hire reversed. A one-word substring bug
in a regex is carrying that risk.

Fix is two-fold and both halves are needed: anchor the token (`/\bship(ped|ping|s)?\b/`)
and move the eligibility test above the project test, because eligibility is the
higher-stakes classification and should win ties.

### E2 — EEO and demographic questions are treated as answerable 🔴

On the Anthropic form the detector returned:

| Field | Semantic key | Confidence |
|---|---|---|
| `Are you Hispanic/Latino?` | **`custom_question`** | **0.84** |
| `Gender` | `null` | 0.56 |
| `Veteran Status` | `null` | 0.56 |
| `Disability Status` | `null` | 0.56 |

`Are you Hispanic/Latino?` ends in a question mark, so the `custom_question` heuristic
promoted it into the **answerable question list**, alongside "Why Anthropic?". The other
three are merely *unrecognised* — not blocked. There is no exclusion list for protected
characteristics anywhere in `fieldDetector.ts`.

Race, ethnicity, gender, veteran and disability self-identification are voluntary
disclosures that must be made by the human, every time, and never replayed from a stored
profile. An autofill product that can put a remembered answer into an EEO field has a
compliance problem, not a bug — and for the product whose entire brand is "we do not take
more than we need", it is the worst possible place to be careless.

This needs a hard deny-list checked *before* semantic matching: any field whose label or
`name` matches gender / race / ethnic / hispanic / latino / veteran / disability /
self-identif / sexual orientation / transgender / pronoun is marked
`never_autofill` and excluded from both the fill planner and the answer library. Not
low-confidence — excluded.

### E3 — "Why {Company}?" is unrecognised, which is most of the answer library's value 🟠

```
"Why Anthropic?"                     -> other
"Why do you want to work at Stripe?" -> other
"Why this company?"                  -> why_company   ✓
```

`fieldDetector.ts:386` matches `/why.*(company|here|us|join)/`. The literal word "company"
almost never appears — employers write their own name. So the classifier recognises the
question only in the phrasing no real employer uses.

On the Anthropic form, **11 of 13** detected questions came back `other`, including "Why
Anthropic?", "Are you open to relocation", "When is the earliest you would want to start",
"Have you ever interviewed at Anthropic before?" and "What is the address from which you
plan on working". The taxonomy has nine buckets and no bucket for the two commonest kinds
of real application question — **behavioural/STAR** ("share a time when you deviated from
your standard process") and **logistics** (start date, relocation, prior applications).

The Answer Library's promise is "you answered this before, reuse it". With everything in
`other`, there is no matching signal — it degrades to one flat list the user scrolls.
Fixing the `why` pattern is a one-liner (drop the required noun, or match the detected
company name from the page metadata); the missing buckets are a taxonomy change.

### E4 — A file upload is presented to the user as a question to answer 🟠

`Attach` — the Greenhouse cover-letter **file input** — appears in the question list with
`mode: short_text`. Cause: `buildQuestions` filters on `key === 'custom_question' || key === 'cover_letter'`,
and the cover-letter *file* input legitimately carries `cover_letter`. Nothing checks
`inputType`. The user is asked to type an answer into an upload control.

One-line fix: exclude `inputType === 'file'` from the question list.

### E5 — Compensation extraction reports $220 for a $220K–$240K role 🔴

Live from the Ashby page, which displays three salary bands:

```
page says:      $220K – $240K   (SF/NY)   $200K – $220K   $180K – $200K
extension got:  "$220"
```

`jdExtractor.ts:106`:

```js
/([$€£]\s?\d[\d,]*(?:\s?[-to]{1,3}\s?[$€£]?\d[\d,]*)?(?:\s?\/\s?(?:year|yr|hour|hr))?)/i
```

Two independent bugs:

1. **No `K`/`M` suffix.** Matching stops at `$220`, so a $220,000 salary is recorded as
   **$220** — wrong by a factor of 1000.
2. **`[-to]{1,3}` is a character class, not an alternation.** It matches 1–3 characters
   drawn from the set {`-`, `t`, `o`} — so it can never match the en-dash `–` that Ashby
   (and most boards) actually render. The range half of the regex is dead code.

This lands in the customer's application tracker as a fabricated quantity, in the product
whose first invariant is that no generated artifact contains a number absent from its
source. It is the same class of error the resume pipeline was rebuilt to eliminate, living
in a different module.

### E6 — The structured JobPosting schema is on the page and is almost entirely ignored 🟠

The Ashby page ships a complete `application/ld+json` `JobPosting`. The extension parses
ld+json but uses it only as a weak fallback for company and location. Available and unread:

| Field on the page | Value | Used? |
|---|---|---|
| `datePosted` | **2025-12-11** | no |
| `jobLocationType` | `TELECOMMUTE` | no — remote is guessed from body text |
| `employmentType` | `FULL_TIME` | no |
| `applicantLocationRequirements` | USA, Canada | no |
| `hiringOrganization.name` | Ashby | fallback only |
| `baseSalary` | (absent here; present on many boards) | no |

`datePosted` is the one that stings. That posting is **eight months old**. "This role was
posted 8 months ago" is arguably the single most decision-relevant fact for someone about
to spend twenty minutes on an application, it is sitting in the DOM as a structured date,
and the extension neither reads nor shows it. Greenhouse, Lever, Ashby and Workday all
emit this schema — it is a more reliable source than any DOM heuristic, and the priority
is currently inverted.

### E7 — Autofill misses the most basic fields, and mis-maps one 🟠

From the two live forms:

| Field | Result | Problem |
|---|---|---|
| `Name` (Ashby, required) | `null`, 0.56 | The rules cover "full name", "your name", "legal name", "first name", "last name" — **not a bare `Name`**, which is what Ashby and many boards use. The most important autofill target on the form. |
| `Country*` (Greenhouse, required) | `null`, 0.56 | `current_location` matches `/location\|city\|state\|where are you based\|current address/` — no "country". |
| `Portfolio Password (if applicable)` | **`portfolio_url`, 0.90 high** | "Portfolio" matched first. A **password field mapped to a URL**, at high confidence. Autofill would type the candidate's portfolio URL into a password box. |
| `Publications (e.g. Google Scholar) URL` | `null`, 0.56 | unmapped |
| `AI Policy for Application*` (required) | `null`, 0.56 | unmapped — and pointedly, this is the field asking how AI was used in the application |
| `Start typing...` (Ashby location autocomplete) | `null`, 0.38 low | label recovered from the placeholder only; a field the detector *has* a rule for |
| Ashby's own "Autofill from resume" dropzone | `resume_upload`, 0.89 | competes with the real required Resume field; both carry the identical key with nothing to disambiguate |

Nine of 28 Greenhouse fields and 4 of 10 Ashby fields are unmapped or wrong. The
first-match-wins rule ordering with unanchored substrings is the common cause of the
mis-maps ("Portfolio" in "Portfolio Password", "ship" in "sponsorship"); the misses are
just gaps in a hand-written list.

### E8 — `connect/start` mints unlimited unauthenticated pairing grants 🟡

```
POST /api/extension/connect/start   (no auth, empty body)
-> 200 {"grantId":"...","verifier":"...","connectUrl":"...","expiresAt":"..."}
6 rapid calls -> 6x 200
```

Each call writes a grant row. Only `api/extension/events` has any rate limiting. The
design itself is sound — grantId + verifier is PKCE-shaped, it expires, and it is inert
until a signed-in human approves it at `/extension/connect` — so this is not a data leak.
It is an unauthenticated unbounded DB write, and it is the one extension endpoint reachable
without a token. It wants the same `checkRateLimit` the anon score route already has.

### E9 — Test coverage does not reach the semantic layer 🟠

6,218 lines, **8 tests**, across `pipeline.fixture.test.ts` and `utils.test.ts`. Every
defect above — E1 through E7 — is a pure function over a string or a DOM node, which is to
say every one is trivially unit-testable, and none is tested. E1 and E3 are single-line
table-driven assertions:

```
'Do you require visa sponsorship?'  -> 'eligibility'
'Why Anthropic?'                    -> 'why_company'
'Are you Hispanic/Latino?'          -> never_autofill
'$220K – $240K'                     -> '$220K – $240K'
'Portfolio Password (if applicable)' -> not portfolio_url
```

The fixture test proves the pipeline runs. Nothing proves it is *right*. That is the gap
that let a sponsorship question become a project story.

### Does the extension do what it says?

Its description is *"Developer job application copilot for analysis, autofill, and resume
tailoring."*

| Claim | Verdict |
|---|---|
| **Analysis** | Mostly yes. Platform and page classification are strong; JD capture is clean. Metadata is weak and the salary figure is wrong. |
| **Autofill** | Partly. Name/email/phone/resume work on Greenhouse; `Name`, `Country` and location fail; one field is mis-mapped to a password box. Not something I would let run unattended. |
| **Resume tailoring** | Wired correctly (401s, paywall pass-through, progress polling) but it calls the same backend audited in Part 2 — so it inherits every finding there, including the 200-second wait and the dropped-evidence gap report. |
| **"Developer"** | The description says developer; the manifest and parsers are profession-neutral and I tested it on a *designer* posting. The word narrows the audience for no reason — same profession-bias thread as F9. |

**Quality bar: not yet.** The architecture is better than the average job-search extension
— scoped permissions, confidence bands with stated reasons, a real DOM reducer, PKCE-shaped
pairing. But a product that autofills job applications is judged on whether it can be
trusted unsupervised, and today it can put a project story in a visa field, a URL in a
password box, a remembered answer in an EEO field, and a 1000×-wrong salary in a tracker.
Those are all small fixes. Until they are made, the honest posture is
**suggest-and-confirm, never auto-submit** — which is roughly what the UI does today, and
is the only reason none of this has caused damage yet.

### Extension fix order

| # | Fix | Why | Size |
|---|---|---|---|
| E-1 | Deny-list EEO/demographic fields before semantic matching | E2 — compliance | 1 hour |
| E-2 | Anchor `\bship\b`, move eligibility above project | E1 — visa answers | 10 min |
| E-3 | Exclude `inputType==='file'` from the question list | E4 | 5 min |
| E-4 | Fix the salary regex: `K`/`M` suffixes, real range alternation `(?:–\|-\|to)` | E5 — fabricated number | 30 min |
| E-5 | Read `datePosted`, `jobLocationType`, `employmentType`, `baseSalary` from ld+json first; show posting age | E6 — the highest-value unbuilt feature in the extension | 1 day |
| E-6 | Add `name`, `country`; negative-guard `password`; disambiguate duplicate `resume_upload` by `required` | E7 | half day |
| E-7 | Table-driven tests over the semantic and typeHint classifiers | E9 — the reason E1 shipped | half day |
| E-8 | Rate-limit `connect/start` | E8 | 15 min |
| E-9 | Widen the `typeHint` taxonomy: behavioural, logistics, eligibility; match "Why {company}" via page metadata | E3 — answer reuse | 1 day |

---

## What could not be tested from here

**I never signed in.** No browser, no Clerk account, no rendered page. That means nothing
here is evidence about layout, responsiveness, loading states, error states as *seen*,
keyboard and screen-reader behaviour, dark mode, mobile, or how any of it feels to use.
The gap report's tone is judged from its generated strings, not from the screen it lands
on. The 200-second wait is a measured number, not an experienced one.

Also untested: the Stripe flows (no keys, no prices exist), the Chrome extension against
a live ATS page, and every flag-gated surface end-to-end — the flags are off and there is
no supported way to turn them on.

Unchanged from 7 Aug, and still true: no email has rendered in a real client; the GitHub
`repo` OAuth path has never returned a real token; nothing proves Vercel calls the cron;
Qdrant filters are matched by an in-memory reimplementation.

**To close the gap** I need a running app and a login. `bun run dev` is off-limits to an
agent per CLAUDE.md, so the fastest path is: you start it with `! bun run dev`, give me a
throwaway test account, and I drive Chrome from there — sign-up through first tailored
resume, with the flags flipped on so the Career surfaces are actually reachable. That
would convert the "Inferred UX" row of §0b into observation, and would test the one thing
no amount of code reading can: whether this is pleasant to use.

---

*Produced 8 Aug 2026 by running the product, not by reading it. 3 live tailoring runs and
2 live free-score runs against `gpt-5`; personas and postings are synthetic, everything
else is the real system. Baseline: 1897 tests passing, typecheck clean, lint clean.*

**Sources for the market analysis:**
[Best AI Resume Builders 2026 (Jobscan)](https://www.jobscan.co/blog/best-ai-resume-builders/) ·
[Best AI Resume Builders (Teal)](https://www.tealhq.com/post/best-ai-resume-builders) ·
[AI Resume Tailoring Tools 2026, pricing](https://blog.fastapply.co/best-ai-resume-tailoring-tools-2026) ·
[Best brag document apps 2026 (BragBook)](https://bragbook.io/best-brag-document-apps) ·
[bragdocument.io](https://bragdocument.io/) ·
[BragDoc use cases](https://www.bragdoc.ai/use-cases) ·
[Resume builder subscription traps (PixelResume)](https://www.pixelresume.com/blog/resume-builder-subscription-traps/) ·
[The Price of an Edge: why job seekers pay](https://www.jobboardsecrets.com/2025/12/22/the-price-of-an-edge-why-job-seekers-are-starting-to-pay-and-when-its-worth-it/) ·
[Resume Building Tool Market 2026–2033](https://www.coherentmarketinsights.com/industry-reports/resume-building-tool-market)
