# Patronus — Career OS (Strategy v3)

## Status
- Document state: `Proposed` — an *expansion* of `product-strategy-v2.md`, not a replacement. Nothing already built in Phase A is discarded; this doc argues that the same substrate serves a much larger job-to-be-done.
- Author: PM pass, 2026-08-01.
- The question it answers: *can this become an OS for working life that people never leave?*

---

## 0. The thesis change, in one sentence

**v2:** the system that knows your career better than you do — so it writes a truthful resume and applies for you.

**v3:** **the private, portable, evidence-backed record of your working life** — the job search is the highest-monetization *event* inside a relationship that never ends.

> **LinkedIn is your career's press release. Patronus is your career's private records.**

---

## 1. Why v2, as written, cannot produce "never leave"

Every loop in v2 is triggered by job search: match digest, tracker, nudges, tailoring, apply. A happily-employed person has zero reason to open the app — and **your users are happily employed ~90% of the time.**

The v2 Always-On tier ($8–12 for "warm profile + digest + tracker") is *job search on standby*. People cancel standby. It's a thinner version of the Pro product, sold to someone who doesn't currently have the problem. That's the leaky bucket with extra steps.

To never be left, the product needs a loop that runs **while you are employed and not looking**, with a payoff that has money and emotion attached. That loop exists, it's unserved, and — critically — **it writes to exactly the same schema the moat needs.**

---

## 2. The missing kernel: the Work Log

Every knowledge worker has the same unmet need, and it is not a resume:

> **"I cannot remember what I actually did."**

It hurts at: performance review, promo packet, 1:1s, comp negotiation, manager changes, layoffs — and eventually, job switching. Everyone is told to keep a brag document. Almost nobody does. The ones who do use a Google Doc that rots.

### The atomic unit of the OS is not a resume bullet. It's a **Win**.
A dated, evidence-linked accomplishment: what you did, the metric, the scope, the proof.

### Capture (the hard part — designed around "confirm", never "write")
| Mode | Mechanism |
|---|---|
| **Auto-draft** (primary) | GitHub PRs/commits (already integrated), calendar events, Linear/Jira, docs titles. AI proposes candidate Wins; user taps ✓. |
| **Weekly nudge** (90 seconds) | Existing `Channel` infra (email/Telegram): "3 things we noticed this week — confirm or edit." |
| **Ambient capture** | v2's continuous capture: anything mentioned in a cover letter, interview answer, or tailoring edit gets offered back to the log. |

**Confirming a Win writes `Evidence(confirmedByUser=true)` + `ImpactMetric`** — the exact schema Phase A already migrated. *The retention loop and the moat mechanism are the same database write.* That is the whole architectural argument for this doc.

### Payoffs that have nothing to do with job search (the unlock)
| Payoff | Frequency | Why they'd pay |
|---|---|---|
| **Review / promo packet generator** — 6 or 12 months of wins → manager-ready doc | 2×/yr, high stakes | Directly attached to a raise. Highest WTP moment of employed life. |
| **Competency-rubric mapping** — upload your company's leveling framework; we map wins → levels and name the gaps | Per cycle | "You have 1 instance of cross-team influence in 8 months; Senior needs 3." Nobody does this. |
| **1:1 prep** — "three things worth raising this week" | Weekly | Bridges the gap between review cycles; makes the habit stick. |
| **Comp negotiation dossier** — wins + market data at review time | 1–2×/yr | Money on the table, immediately. |
| **Skill drift alerts** — "you haven't touched Kafka in 14 months but it's on your resume" | Monthly | Truthfulness brand applied to the *self*, not just the doc. |

And then, the compounding kicker: when you *do* search, your resume is assembled from **three years of dated, evidence-linked wins**. Teal, Rezi, Jobscan and every AI resume tool start from a blank page and your memory. That gap is structurally uncatchable by anyone who only shows up at search time.

**TAM effect:** the market moves from "people actively job hunting" (episodic, maybe 5–8% of knowledge workers at any moment) to "knowledge workers who have performance reviews" (permanent, ~all of them).

---

## 3. The second loop: Career Radar

Passive market intelligence keyed to the graph. The monthly ritual *and* the intent manufacturer.

- **Your market value band** — with sample size and source, never a fabricated number.
- **Roles you'd win** — public Greenhouse/Lever boards scored with the existing fit logic (v2 §4.3, already planned).
- **Skill economics** — which of your skills are appreciating/depreciating in postings for your profile.
- **The trigger:** *"You're tracking ~18% below the median for your profile. 4 companies posted matching roles this month."*

That sentence is a monetizable emotion, generated by the product, for a user who wasn't looking. It's how a Career subscriber becomes a Search subscriber.

**Data discipline:** comp ranges from public sources — mandated pay-transparency postings (CA/NY/CO/WA/EU), public levels data, and (later) your own users' anonymized confirmed offers. The truthfulness guarantee applies to market data too: ranges, sample sizes, sources. Never a made-up number.

---

## 4. The process model: Missions

An OS always has something running. Replace the feature menu with **Missions** — multi-week guided programs that consume the graph and emit back into it:

`Get promoted` · `Land a new role` · `Switch domains` · `Negotiate this offer` · `Move IC → manager` · `Return after a break` · `Land the first job` · `Go independent`

Each mission is a sequence of the engines you already have (or will have), with a defined end state. **When one completes, the OS proposes the next.** The loop has no natural terminus — that's the anti-churn mechanic. It's also the cleanest fix for the 13-item sidebar: users pick a mission, not a tool.

---

## 5. Later optionality: the Proof Ledger as an outward asset

You will be sitting on the only evidence-backed career record in the market. Downstream options — **do not chase these before consumer retention works, just don't foreclose them:**

- A shareable **verified profile**: claims rendered with their evidence.
- **Corroboration**: a former manager confirms an outcome in one click → `Evidence(kind=corroboration)`.
- Employer-side trust: a hiring team that trusts a Patronus record screens faster.

This is a genuinely new asset class and the strongest possible long-term moat, but it's a two-sided market. The current `Evidence`/`ClaimLink` schema already supports it. That's enough for now.

---

## 6. Market read — the gap nobody occupies

| Player | Covers | Owns your record? | Gap we exploit |
|---|---|---|---|
| **LinkedIn** | Public identity, social | Public + performative | It's a press release optimized for their ad load. Not truthful, not private, not a work tool. |
| Teal / Huntr / Careerflow | Search tracking | No | Episodic. Dies when you're hired. |
| Jobscan / Rezi / Kickresume | One feature | No | Single-purpose, no memory of you. |
| Simplify / LazyApply | Mass autofill | No | Spray-and-pray; opposite brand. |
| Final Round / interviewing.io | Interview only | No | Episodic. |
| Levels.fyi / Blind | Comp data | No | No personal state, no action. |
| **Lattice / CultureAmp / 15Five** | **Reviews, goals, feedback** | **Yes — but the employer owns it** | **The brag doc already exists in enterprise HR software. It belongs to your company and vanishes when you leave.** We are the portable, employee-owned version. |
| Gloat / Eightfold / Fuel50 | Internal mobility | Employer-owned | Same ownership problem. |
| Pathrise / Springboard / ADPList | Human coaching | No | Human-limited, unscalable, expensive. |

**Nobody owns the individual's private, portable, evidence-backed career record across employers and across life stages.** That is the OS-shaped hole.

The Lattice row is the most important one on this page. The category-defining insight of v3 is that **performance data is currently a company asset and it should be a personal one.**

---

## 7. Monetization rethink

v2's ladder is fine in shape and wrong in three details.

### 7.1 Annual-first
Career products die on the monthly cancel decision, and the #1 churn event — "I got hired" — arrives on a predictable clock. Sell the durable tier **annually** and frame it as career insurance. Monthly exists but is deliberately unattractive.

### 7.2 Tiers named for jobs-to-be-done, and one tier designed to be switched *off*
| Tier | Price | Job it does | Churn posture |
|---|---|---|---|
| **Free** | $0 | ATS score, 1 master resume, fit-score-on-page, manual tracking, work log (limited history) | Funnel |
| **Career** | **$99–129/yr** (~$9–11/mo), monthly $15 | Work log + auto-capture, review & promo packets, rubric mapping, Career Radar, tracker, full history | **Never churns.** This is the OS. |
| **Search** | **$29/mo, month-to-month, one click on/off** | Unlimited tailoring, apply orchestration, interview prep, negotiation dossier, priority everything | **Designed to be paused.** Episodic by intent. |
| **Teams / B2B** | see §7.3 | outplacement, career centers, internal mobility | Contract |

The counter-intuitive move: **make the expensive tier easy to cancel.** A user who can switch Search off in one click will switch it back on next hunt — and keeps paying for Career forever in between. Fighting the episodic nature of job search loses; monetizing it and letting it recede wins. LTV comes from the tier nobody cancels.

### 7.3 The B2B wedge that isn't a "teams dashboard"
Two budgets already exist, today, for exactly this engine:

1. **Outplacement.** Companies pay LHH / Randstad RiseSmart / INTOO **$2,000–8,000 per laid-off employee** for largely mediocre human coaching. Same product, delivered at $300–600/head with software margins, with better outcomes and real tracking. Layoffs are, unfortunately, a reliable market.
2. **Internal mobility & retention.** Employers pay to keep people by growing them. The work log is a genuinely better input to internal mobility than a skills-inference engine, because it's *self-reported and evidence-linked* rather than guessed.

**Hard firewall, stated publicly and enforced in schema:** an employer sees aggregate skills/growth data only, **never** an individual's job search, applications, radar, or resume activity. If this line is ever fuzzy, the consumer product is dead. Build the data separation before the first B2B deal, not after.

---

## 8. What "enterprise grade" concretely means here

Not a vibe — a checklist. These are the things that make someone trust a system with their entire career history.

1. **Your record is yours.** One-click full export (JSON + Markdown + PDF) of every win, evidence item, and application. Say it loudly on the pricing page — it's a direct attack on Lattice-style employer ownership.
2. **Never trained on.** Explicit, contractual, on the marketing site.
3. **Granular consent per source.** GitHub ≠ calendar ≠ Slack. Revocable individually. Show exactly what was read.
4. **Per-claim audit trail.** Every AI-generated sentence traces to its evidence (the `ClaimLink` layer already does this). Exportable.
5. **Deletion & retention.** Hard delete, cascade, verified. GDPR/CCPA posture from day one; SOC 2 Type II before the first B2B contract.
6. **Reversibility everywhere.** Undo on autofill (done), status flips, graph edits, win confirmations.
7. **Performance budgets, enforced in CI.** Fit score <5s, side-panel paint <200ms, tailored resume <30s with live progress, weekly digest generation <2min/user.
8. **Failure honesty.** Fail-closed truthfulness (already the locked invariant), degraded modes that say so, no silent partial results.
9. **One design system across web + extension + email.** Already a locked decision — finish it.
10. **Cost-per-feature observability.** `ApiUsageLog` tagged by feature so the work log's unit economics are visible before it scales.
11. **Accessibility (WCAG 2.1 AA)** — non-negotiable for university/enterprise buyers.

---

## 9. Revised sequencing

The Phase A/B structure in `architecture-master-plan-v2.md` mostly survives. The one structural change:

> **The evidence layer (A2) currently has no front door.** It's invisible plumbing whose only payoff is inside the resume. Give it a user-facing product — the Work Log — and the identical schema now drives retention, TAM expansion, *and* the moat simultaneously.

### NOW (~6–8 weeks) — "the log, and a reason to pay while employed"
| # | Item | Notes |
|---|---|---|
| 1 | **Work Log capture loop** | Weekly nudge via existing `Channel` infra → one-tap confirm → `Evidence` + `ImpactMetric`. Reuses the Phase-A migration. |
| 2 | **GitHub auto-draft of Wins** | Kills the blank-prompt failure mode on day one. Octokit integration already exists. Developers first = lowest consent friction. |
| 3 | **Review / Promo Packet generator** | The first non-job-search payoff. The thing someone employed will actually pay for. |
| 4 | **Repositioned tiers + soft paywall** | Billing rails are built; change the *packaging*, keep the paywall soft. |
| 5 | Truth chips + inbox + status enum | Already built / wiring. Chips double as the win-confirmation surface. |

### NEXT (~8–16 weeks) — "the ritual and the trigger"
6. **Career Radar v1** — public-board matching + market value band + skill trend.
7. **Calendar / Linear / Jira capture sources** — with per-source consent UI.
8. **Missions framing + IA collapse** — the sidebar fix, done properly.
9. **Context Interview, retargeted** — no longer the onboarding wedge; it's the **backfill** that reconstructs your pre-Patronus years, run once.
10. **Rubric mapping + 1:1 prep.**
11. **Monetization launch** (public pricing).

### LATER
12. Negotiation dossier · interview prep from graph · coaching analytics (interviews-per-10) · apply orchestration depth · voice matching.
13. Corroboration & verified profile.
14. **Outplacement B2B** — the first real enterprise motion, once the consumer engine retains.
15. Internal mobility (only with the firewall proven).

---

## 10. What will kill this

| Risk | Why it's fatal | Mitigation |
|---|---|---|
| **Feature sprawl under the word "OS"** | "OS" invites building courses, networking, mentorship, a feed. Twenty mediocre features is how this dies. | An OS is *one primitive + one runtime + a few apps*. Primitive = the evidence-backed Win. Runtime = the graph. Everything else is an integration or a no. |
| **The weekly prompt goes unanswered** | Single point of failure for the entire thesis. Empty log → nothing works. | Auto-draft first, so the ask is "confirm," not "write." <20 seconds. Visible payoff inside 3 weeks ("your month in review"). Measure *log-fill rate* as the #1 activation metric. |
| **Privacy panic** | Reading GitHub/calendar/Slack about your job is a large ask. | Per-source granular consent, show what was read, never-train commitment, start GitHub-only. |
| **Employed users feel no pain between review cycles** | 2 payoffs/year is not a habit. | Monthly Radar + weekly 1:1 prep bridge the gap. The habit is the product. |
| **Becoming an inferior LinkedIn** | The moment you ship a feed you're competing on the wrong axis, against an ad business, and you lose. | No feed. No social graph. Private by construction — that *is* the positioning. |
| **B2B data firewall leaks** | Instantly and permanently kills consumer trust. | Schema-level separation before the first deal. Never a "just this once" exception. |

---

## 11. Metrics that tell us the OS is real

| Layer | North star | Leading indicators |
|---|---|---|
| **Activation** | **Log-fill rate** — % of users with ≥3 confirmed Wins in their first 3 weeks | auto-draft accept rate, weekly nudge open→confirm |
| **Habit** | **Weekly active while employed** (not job hunting) | nudge response rate, radar opens |
| Value (employed) | Review packets generated / user / year | rubric gaps closed, 1:1 prep opens |
| Value (searching) | Tailored resumes per hunt, interviews per 10 applications | — |
| **Moat** | **Evidence-linked wins per user, over time** | grounded-claim ratio, backfill completion |
| Monetization | Career-tier annual retention; Search attach rate per hunt | Career→Search conversion on a radar trigger |
| **The one that proves it** | **% of users still active 6 months after being hired** | — |

That last metric is the whole bet. v2 optimizes not to lose them at "hired." v3 says the product barely notices that event.

---

## 12. The pitch

> **Patronus is the private record of your working life.** It remembers everything you've done, proves it, and turns it into whatever you need next — a promotion case, a raise, a resume, an offer. Your company's HR software owns your performance history and deletes it when you leave. This one is yours, forever.
