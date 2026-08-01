# PRD 09 — The Value Model

> **Status:** `Draft for build` · **Applies to:** the whole product
> **Why this doc exists:** the other eight specify *what we build*. This one specifies *what the user actually gets*, how much it's worth, when it arrives, and how they come to feel it. It produces four roadmap decisions (§9) that the feature specs cannot.

---

## 1. The distinction that matters

Three different things get confused in product discussions:

| | Definition | Failure mode |
|---|---|---|
| **Value created** | The economic or emotional benefit the user receives | Building things nobody needed |
| **Value perceived** | How much of it they notice | Real value, invisible → churn |
| **Value proven** | What we can credibly claim to a stranger | Great product, no growth |

This product has an unusual profile: **high value created, poorly-timed and hard to perceive, and currently unprovable.** Almost all of the design work below is closing gaps 2 and 3, not gap 1.

---

## 2. Value inventory

Quantified where honest, with a confidence label. Figures given for a mid-senior engineer at ~$150k (US) / ~₹40L (India); scale proportionally.

### 2.1 Large, real, defensible

| Job | Mechanism | Value | Confidence |
|---|---|---|---|
| **Negotiate an offer better** | Band data + evidence-backed ask, drafted (M4) | A 5% improvement on base = **$7,500 / ₹2L per year, recurring**. Most people don't negotiate at all; moving someone from "accept" to "counter once" is the single largest financial event the product can cause. | **High** — the mechanism is direct and the counterfactual is clean |
| **Close a promo gap in time to matter** | T-90 readiness report (03 §4.4) | A promotion is typically a 15–25% bump. We can't claim to cause it. We can claim to surface the gap while there's still time to close it — which mostly converts to *earlier*, not *additional*. Six months earlier ≈ **$12k / ₹3L one-time plus compounding**. | **Medium-high** — this is the only feature that changes what the user does *at work* |
| **Shorten a job search** | Better-targeted, higher-quality applications from a real record | Median search runs ~5 months. Two weeks shorter = **$5,700 / ₹1.5L**. This dwarfs the time saved doing the applications. | **Medium** — plausible, currently unproven; §8 is how we find out |
| **Be job-ready the day you're laid off** | The log already exists | Someone with a full log is applying in 24 hours; someone without spends 2–3 weeks reconstructing. In a market with routine layoffs this is **insurance**, and it's the honest justification for an annual price. | **High** — the counterfactual is obvious to anyone who's been through it |

### 2.2 Real but modest

| Job | Value | Note |
|---|---|---|
| **Write the review without the weekend** | 4–8 hours × 2/year → ~45 min each. **~10 hours/year** (~$720 / ₹18k) plus the dread, which people would pay to avoid on its own | Reliable, recurring, easy to feel |
| **Tailor 40 applications** | ~60 min each manually → ~10 min. **~33 hours** (~$2,400 / ₹60k of time) | Real, but during a hunt time is cheap and outcomes are dear — lead with §2.1 row 3 |
| **Remember what to raise in a 1:1** | Small per instance, compounds into manager perception | Low economic value, high habit value — that's a legitimate reason to build it, but don't oversell it |

### 2.3 The work log itself

**Standalone value: near zero. Enabling value: everything.**

This is the most important line in the document. The log produces nothing on its own — it makes every downstream artifact possible and better. Two consequences:

1. **Never sell the log.** Sell the packet, the negotiation, the readiness report. The log is the price of admission, not the product.
2. **Never justify the log's cost with the log's benefit.** "Keep a record" is a chore. "Walk into your review with a case" is a product.

---

## 3. The value curve, and the month-6 problem

```
  value
  felt
   ▲
   │                                                      ╭─── promo / offer
   │                                          ╭───────────╯      (month 12+)
   │                              ╭───────────╯ gap report drives action (m9)
   │                  ╭───────────╯ FIRST REVIEW PACKET  (month 6)  ◀── first large payoff
   │      ╭───────────╯ "I couldn't have reconstructed this" (month 3)
   │  ╭───╯ Month in Review (week 3)
   │──╯
   └────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────▶ time
       w1    w3    m2    m3    m4    m6    m9    m12
       ▲
       └── DANGER ZONE: pure cost, no return. Every churn happens here.
```

**The problem stated plainly: the first large value event is at month 6.** That is an extraordinary amount of faith to ask of someone paying for a product, and no amount of streak counters or nudges substitutes for a payoff.

**Three levers on this, in order of impact:**

1. **Backfill collapses the curve.** A user who spends 10 minutes reconstructing their last job (07) can generate a real review packet in **week one**, not month six. Backfill is not a completeness feature — it is the time-to-value compressor, and it is the single highest-leverage sequencing decision in the plan. → **Decision D-A, §9.**
2. **GitHub's 90-day initial sync does the same thing for free.** Connect on day one, and the log opens with 40 wins from the last quarter rather than an empty page. Already specced (02 §3.3); its importance is *value timing*, not convenience.
3. **The Month in Review is the only scheduled payoff before month 6.** Its copy quality is therefore a launch blocker, not polish. It is carrying the entire first quarter.

---

## 4. Value created vs. value perceived

The core design problem: **the product's cost is continuous (20 seconds a week, forever) and its benefit is lumpy (twice a year).** Users experience a steady drip of effort against a distant, abstract promise. That asymmetry is what kills habit products.

We cannot change when the benefit lands. We can change how visible the accruing value is.

### Five mechanisms

**M1 — Value receipts on every artifact.**
Every generated output states what it drew on and what it replaced. Not a brag; a receipt.
> *"This packet drew on 47 wins across 6 months, 31 with evidence. 12 of them are from more than 90 days ago."*

That last clause is the one that lands, because the reader knows they'd have lost those.

**M2 — The counterfactual moment.**
The single most persuasive message the product can send, and it costs nothing:
> *"You logged this in March. Would you have remembered it?"*

Surface it at packet time on the oldest win in the set. Let them feel the recall failure they avoided. Use sparingly — once per packet, never as a recurring nudge.

**M3 — Standing statement of what the record is worth.**
The log's header should always answer "what do I have?" in outcome terms, never in storage terms:
> *"74 wins · 3 years · 61 with evidence — enough for a promotion packet, a resume, and a negotiation dossier, on demand."*

**M4 — Progress against the thing they said they wanted.**
Missions (05) exist partly for this. A user who set "Staff by March" and sees 62% is receiving perceived value weekly from a benefit that arrives in March.

**M5 — Reflect outcomes back at the moment they happen.**
When a user reports a promotion, an offer, or a raise, that's the moment to close the loop — state what the record contributed, and ask if they'd tell someone. It's also the only honest source of the proof in §8.

---

## 5. Where the value is thin — the honest list

A value model that only finds value is marketing. Three things in this plan are weaker than their prominence suggests.

### 5.1 Career Radar's market band — **fix or demote**

For most users, most months, "you're paid roughly market" is not actionable. It's interesting once and boring by month three. Its strongest justification in 04 is that it converts Career → Search — which is **our** value, not theirs. That's a warning sign, and worth naming.

**The fix is to make it prescriptive rather than descriptive.** Not *"your band is ₹48–72L"* but *"the two skills that separate your band from the one above appear in 71% of those postings; you have logged work in one of them."* Same data, actionable output, and it connects Radar to the log instead of running beside it.

If that version can't be built well, Radar should be a quarterly feature, not monthly. → **Decision D-B.**

### 5.2 Skill drift alerts — real, rarely actionable
"You haven't touched Kafka in 14 months" is true and mildly interesting. It almost never changes behavior. Keep it as a line inside Radar; never build a surface for it.

### 5.3 Missions as a wrapper — uneven
M1's gap-closing loop is genuine value: it's the only thing in the product that changes what someone does at work. M2 is mostly the existing tracker with pacing — useful, not transformative. **Don't let the mission framing imply equal depth across the catalog.** Build M1 and M4 properly; keep M2 light.

---

## 6. The irreplaceability test

> *What would make a user genuinely upset if this disappeared tomorrow?*

Not the resume builder — a dozen tools do that. Not the tracker — a spreadsheet does that. Not the ATS score — it's a commodity.

**The record.** Three years of dated, evidence-linked accomplishments that exist nowhere else and cannot be reconstructed. Everything else in the product is replaceable within a week.

**The operating rule this produces:** evaluate every proposed feature by whether it makes the record *richer* or *more irreplaceable*. A feature that does neither is a distraction regardless of how well it demos.

Applied to the current plan:
| Feature | Enriches the record? | Verdict |
|---|---|---|
| Auto-capture | Directly — it's the filling mechanism | Core |
| Backfill | Directly — adds years that can't otherwise exist | Core |
| Review packet | No, but it's the reason to fill it | Core (the demand driver) |
| Gap report | Yes — it drives capture of missing categories | Core |
| Radar | No | Support |
| Missions | Indirectly, via M1's gap loop | Support |
| Tailoring / apply | No — they consume it | Monetization, not moat |

---

## 7. Value per persona

| | Maya (employed) | Dev (hunting) |
|---|---|---|
| Annual economic value | ~$2,000–3,000 expected (promo timing + review hours + insurance) | ~$8,000+ during a hunt (search shortening + negotiation) |
| Value timing | Lumpy, 2×/year | Dense, over 8 weeks |
| Perceived value risk | **High** — this is the whole problem | Low — the benefit is immediate and obvious |
| What we must get right | §4's five mechanisms | Speed and quality; the value is self-evident |

**The asymmetry is the business.** Dev's value is easy to feel and easy to charge for, and he leaves when he's hired. Maya's value is larger in aggregate, harder to feel, and permanent. Everything hard about this product is about making Maya's value legible.

---

## 8. Measuring value (not engagement)

Engagement metrics tell us if the habit is forming. These tell us if it's worth anything.

| Signal | Instrument | Target |
|---|---|---|
| **Would you be disappointed if this went away?** | In-app survey at month 6 (single question, 3 options) | **≥40% "very disappointed"** — below that, the value isn't landing regardless of usage |
| **Artifact survival** | `packet_exported / packet_completed` — did it survive contact with reality? | >70% |
| **Reported outcomes** | Every mission completion asks (05 §2 rule 4) | Any answer rate >50% |
| **Counterfactual recall** | On packets: "how many of these would you have remembered?" — one tap, three buckets | Establishes the recall-failure baseline, which is the core claim |
| **Reactivation** | Search turned back on for a second hunt (06 §7) | The purest signal that the record had standing value |

**The proof we're building toward.** Today we can claim nothing. After ~500 users × 12 months of outcome reports, we can make defensible claims — *"users who logged weekly reported X"* — and that becomes the marketing, the B2B pitch, and the thing no competitor can replicate without the same time and the same data. Start collecting from day one; the dataset is only useful with history.

---

## 9. Decisions this forces

| # | Decision | Rationale | Recommendation |
|---|---|---|---|
| **D-A** | **Move backfill (07) from R2 into R1.** | It's the only lever that moves first-large-value from month 6 to week 1. Currently the plan's biggest value-timing risk, and the fix is a feature we're already building — just later. | **Do it.** Ship it un-promoted (offered after first value, per 07 §2) but *available* in R1. Cost is ~$0.13/session, so there's no economic reason to hold it back. |
| **D-B** | **Make Radar prescriptive, or make it quarterly.** | A descriptive band is a conversion tool wearing a value costume. | Attempt the prescriptive version in R2; if it can't be built well, demote to quarterly and reallocate. |
| **D-C** | **Treat the Month in Review as a launch blocker, not polish.** | It is the *only* scheduled payoff in the first six months. | Owner reviews the copy personally before R1 ships. |
| **D-D** | **Add value receipts (§4 M1) and the standing record statement (M3) to R1 scope.** | Small build, directly addresses the product's central weakness. | Fold into R1.4. |

---

## 10. The one-sentence test

If a user asks *"what do I get for this?"*, the answer is not "a resume builder with a work log."

> **"Six months from now you'll have something you can't build retroactively: a complete, dated, provable record of what you did — and the two or three moments a year when that's worth thousands of dollars, you'll be ready for."**

If a feature doesn't ladder to that sentence, it's not in the product.
