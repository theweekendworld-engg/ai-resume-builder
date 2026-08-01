# PRD 04 — Career Radar

> **Status:** `Draft for build` · **Release:** R2 · **Persona:** P1 Maya (ritual), converting to P2 Dev (trigger)
> **Depends on:** 01 (a filled log = a real profile), existing fit-score logic (`src/lib/extension/analyze.ts`), Channel infra
> **Two jobs:** (a) give an employed user a reason to open the app monthly, (b) manufacture the switch intent that converts Career → Search.

---

## 1. The problem

Employed people have no idea where they stand. They find out they were underpaid when they leave, and they find out their skills went stale when they start looking. Both discoveries arrive years late and cost real money.

The information exists — public salary ranges are now mandated in California, New York, Colorado, Washington, Illinois, and across the EU under the Pay Transparency Directive; public job boards publish structured requirements; the demand curve for skills is visible in postings. **Nobody assembles it into a personal answer.** Levels.fyi has data but no idea who you are. LinkedIn knows who you are but sells your attention, not your leverage.

We know exactly who the user is — better than anyone, because of the log — so we can answer the question personally: *where do you stand, and is that changing?*

---

## 2. What Radar tells you

Four answers, one screen, refreshed monthly.

| Panel | Question | Honesty rule |
|---|---|---|
| **Market band** | What's my profile worth right now? | Always a range with `n` and sources. Never a single number. Never shown below `n=8`. |
| **Matched roles** | Who would hire me today? | Real, current, linkable postings only. Never "similar to" placeholders. |
| **Skill economics** | Which of my skills are appreciating or fading? | Directional (trend %) with posting counts, never a precision we don't have. |
| **Your position** | Am I drifting? | Derived from the log: category mix, recency, skill breadth. |

### 2.1 The trust constraint

This feature will be judged on whether its numbers are believable, and a single obviously-wrong salary band destroys the credibility of everything else — including the truthfulness brand the resume product depends on.

**Non-negotiable rules:**
1. **Never estimate compensation with a language model.** Bands come from arithmetic over collected postings, full stop. The model may *write about* a band; it may never *produce* one.
2. Show `n`, the date window, and the geography for every band. Suppress below `n=8`.
3. When we don't know, say we don't know: *"Not enough public data for Staff Backend in Bangalore. Here's the Senior band instead (n=14)."*
4. Every posting-derived claim links to the posting.
5. Label the source of each band: `Posted ranges (mandated disclosure)` · `Patronus user offers (anonymized)` · `Public dataset`.

---

## 3. Data acquisition

### 3.1 Job posting ingestion (ToS-safe, locked decision from v2 §11 — **no scraping**)

| Source | Method | Coverage |
|---|---|---|
| **Greenhouse** | Public board JSON: `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Very large; mostly tech |
| **Lever** | Public postings API: `api.lever.co/v0/postings/{company}?mode=json` | Large |
| **Ashby** | Public job board API | Growing, startup-heavy |
| **Workable / SmartRecruiters** | Public board endpoints | R3 |

**Board discovery** is the real work, not the fetching. Seed the `JobSource` table from:
1. Companies already in `CompanyInsight` and `ApplicationWorkspace` (our users' real target companies — the highest-value seed we have, and it's free).
2. A curated launch list of ~800 companies.
3. **User-triggered:** when someone uses the extension on a Greenhouse/Lever page, register that board automatically. The extension is a distributed board-discovery network we already deployed.

**Fetch cadence:** daily per board, staggered. Politeness: 1 req/s per host, `User-Agent: PatronusBot/1.0 (+https://…/bot)`, honor 429 with backoff, cache with ETag. Mark boards `inactive` after 5 consecutive 404s.

**Compensation extraction:** regex + unit normalization over the posting body, not a model. Patterns for `$120,000 - $160,000`, `$120K–$160K`, `£65,000-£80,000`, hourly, and equity/bonus mentions (captured separately, never folded into base). Normalize to annual base in the posting's currency; store the currency, never convert. Confidence flag when the range is wider than 60% of its midpoint (those are compliance-theater ranges and must be excluded from band math).

### 3.2 Skill signal rollup

Nightly job over postings from the last 90 days:
- Normalize skills from posting requirements via a curated alias map (`postgres`/`postgresql`/`psql` → `postgresql`). A curated map beats an embedding cluster here — precision matters more than coverage, and the map is auditable.
- Per skill: posting count, 90-day and 365-day trend, median disclosed range for postings requiring it, seniority distribution.
- Store in `SkillSignal`, keyed `(skillNorm, window, geoBucket)`.

**Trend is only shown when `postingCount ≥ 50` in both comparison windows.** Below that, the trend is noise and showing it is lying with a chart.

### 3.3 The user's own offer data (the compounding asset)

When a user marks an `ApplicationWorkspace` as `offer`, ask — optionally, skippable, once: *"What was the offer? It stays anonymous and it makes everyone's bands more accurate, including yours."* Capture base / equity / bonus / level / location.

This is a slow-compounding proprietary dataset that no competitor can copy, and it makes the Radar strictly better over time. Store hashed to the user, aggregate-only in output, minimum `n=8` before any band uses it, and never displayable in a way that identifies a company+level+individual.

---

## 4. Matching

Reuse the existing fit-score logic in `src/lib/extension/analyze.ts` — **do not write a second matcher.** Radar's addition is running it in batch, against the graph rather than a pasted JD.

```
candidate postings  = active postings, last 30 days
   filter → user's location prefs / remote preference
   filter → seniority band (from UserProfile + log recency)
   filter → exclude companies the user has an ApplicationWorkspace with
   filter → exclude user's current employer (unless internal-mobility mode)
rank  → fit score (existing) × recency × compensation delta vs. user's band
take  → top 5
```

**Why 5:** more than 5 reads as a job board and triggers "I'm not looking, unsubscribe." Five reads as curation.

**The `Win`-powered advantage:** matching input includes confirmed Wins from the last 18 months, not just the resume. This is why our match quality beats a keyword matcher — we know what she *actually did recently*, at a granularity a resume never carries.

---

## 5. The monthly digest

**Cadence:** monthly, on a fixed user-chosen day (default: first Tuesday, 09:00 local). Separate from the weekly log digest — different job, different rhythm, separate unsubscribe.

```
Subject: Your market, August

  YOUR BAND
  Senior Backend Engineer · Bengaluru · ₹48–72L
  You're likely tracking near the lower half.        [ Why? ]
  Based on 34 disclosed ranges, last 90 days.

  ROLES YOU'D LIKELY WIN                          5 new
  ▸ Staff Engineer, Payments · Razorpay · ₹65–85L
    92% fit — your checkout latency and payments
    reliability work maps directly.        [ View ]
  ▸ …

  YOUR SKILLS
  ↑ postgresql     +18% demand      appears in 62% of your matches
  ↑ kubernetes     +11%
  → typescript      flat
  ↓ jenkins        −24%             you last logged work here 14mo ago

  ONE OBSERVATION
  Your log is 70% execution, 8% cross-team. Roles at the
  band above yours ask for cross-team scope in 4 of 5 postings.
```

**"Why?" on the band** opens the methodology: the postings used, the date window, and how we placed the user. Radical transparency here is the whole defense against "your number is wrong."

**The conversion moment:** when the band delta or a match is strong, the digest gets a single, non-pushy CTA — *"Want to test the market? Turn on Search for a month."* One click to add the Search tier, one click to remove it later (06). No hard sell, no urgency copy. The data is the argument.

---

## 6. In-app surface

`/radar`. Same four panels, plus:
- **Band placement explainer** — where in the range we think they sit and why (years, level, recent scope). Editable: the user can correct their level, which improves matching.
- **Match history** — matches from previous months, with "saved" and "dismissed" states. Dismissing teaches the filter (`company`, `role type`, `location`).
- **Skill detail** — click any skill for its trend chart, the postings driving it, and *"you have 6 wins tagged postgresql; last one July 2026."*
- **Save to Applications** — one click creates an `ApplicationWorkspace` in `discovered`, joining the existing pipeline. This is the seam between Radar and the v2 apply product.

---

## 7. Data model

```prisma
enum JobBoardSource { greenhouse lever ashby workable smartrecruiters }
enum PostingStatus  { active closed stale }

model JobSource {
  id            String         @id @default(cuid())
  source        JobBoardSource
  boardToken    String
  companyName   String
  website       String?
  active        Boolean        @default(true)
  discoveredVia String                     // seed | extension | workspace | manual
  lastFetchedAt DateTime?
  lastSuccessAt DateTime?
  errorCount    Int            @default(0)
  postingCount  Int            @default(0)
  createdAt     DateTime       @default(now())

  @@unique([source, boardToken])
  @@index([active, lastFetchedAt])
}

model JobPosting {
  id             String         @id @default(cuid())
  source         JobBoardSource
  sourceId       String                        // -> JobSource.id
  externalId     String
  company        String
  title          String
  normalizedRole String?                       // "senior_backend_engineer"
  seniority      String?                       // junior|mid|senior|staff|principal|manager
  location       String?
  geoBucket      String?                       // normalized: "bengaluru_in", "remote_us"
  remote         Boolean        @default(false)
  description    String
  requirements   Json           @default("[]") // normalized skill slugs
  compMin        Int?
  compMax        Int?
  compCurrency   String?
  compPeriod     String?                       // year | hour
  compSource     String?                       // disclosed | inferred_none
  compConfidence Float?
  status         PostingStatus  @default(active)
  postedAt       DateTime?
  firstSeenAt    DateTime       @default(now())
  lastSeenAt     DateTime       @default(now())
  url            String

  @@unique([source, externalId])
  @@index([normalizedRole, geoBucket, postedAt])
  @@index([status, lastSeenAt])
}

model SkillSignal {
  id             String   @id @default(cuid())
  skillNorm      String
  geoBucket      String
  window         String                     // 90d | 365d
  postingCount   Int
  medianCompMin  Int?
  medianCompMax  Int?
  currency       String?
  trendPct       Float?                     // vs. previous equal window; null if underpowered
  seniorityMix   Json     @default("{}")
  computedAt     DateTime @default(now())

  @@unique([skillNorm, geoBucket, window])
  @@index([computedAt])
}

model RadarSnapshot {
  id           String   @id @default(cuid())
  userId       String
  periodStart  DateTime
  band         Json                        // {min,max,currency,n,sources[],placement,geoBucket}
  matches      Json     @default("[]")     // [{postingId, fit, reason, compDelta}]
  skillTrends  Json     @default("[]")
  observation  String?
  deliveredAt  DateTime?
  openedAt     DateTime?
  ctaClickedAt DateTime?
  createdAt    DateTime @default(now())

  @@unique([userId, periodStart])
  @@index([userId, createdAt])
}

model OfferDataPoint {
  id           String   @id @default(cuid())
  userIdHash   String                      // hashed; not joinable back to the user in analytics
  workspaceId  String?
  company      String?
  normalizedRole String
  seniority    String?
  geoBucket    String
  baseAmount   Int
  equityText   String?
  bonusAmount  Int?
  currency     String
  acceptedAt   DateTime?
  reportedAt   DateTime @default(now())

  @@index([normalizedRole, geoBucket, reportedAt])
}
```

---

## 8. AI usage (deliberately minimal)

Radar is mostly **arithmetic and retrieval**, not generation. The model is used for exactly three things:

1. **Posting normalization** — title → `normalizedRole` + `seniority`, requirements → skill slugs. Cheap model, batched 20 postings per call, cached by posting hash. Never re-run for an unchanged posting.
2. **The match reason** — one sentence explaining why this role fits, citing specific Wins. Must reference real Win IDs; no generic "your background aligns well."
3. **The observation** — one sentence from the log's category mix vs. the target band's posting requirements.

**No model touches a salary number.** Repeating this here because it will be tempting during implementation when the arithmetic returns `n=3`.

---

## 9. Entitlements

| | Free | Career | Search |
|---|---|---|---|
| Monthly digest | ✗ | ✓ | ✓ |
| Band | teaser only (blurred range, real `n`) | ✓ | ✓ |
| Matches | 1/month | 5/month | 5/month + on-demand refresh |
| Skill trends | ✗ | ✓ | ✓ |
| Save to applications | ✓ | ✓ | ✓ |

The free teaser is deliberately shaped: show the real `n` and the real methodology, blur the numbers. *"We found 34 disclosed ranges for your profile."* Concrete enough to be credible, withheld enough to convert.

New metered action: `radar_refresh` (on-demand recompute) — Free 0, Career 2/mo, Search unlimited.

---

## 10. Telemetry

| Event | Payload |
|---|---|
| `radar_snapshot_generated` | `{bandN, matchCount, hasTrends, computeMs}` |
| `radar_digest_sent` / `opened` | `{periodStart, channel}` |
| `radar_band_explainer_opened` | — ← trust signal; high rates mean our numbers look wrong |
| `radar_match_viewed` / `saved` / `dismissed` | `{postingId, fit, dismissReason}` |
| `radar_skill_detail_opened` | `{skill, trendPct}` |
| `radar_cta_clicked` | `{ctaType: 'enable_search', bandDelta}` |
| `offer_data_submitted` / `skipped` | `{hasBase, hasEquity}` |
| `board_discovered` | `{source, via}` |

**The business metric:** `radar_cta_clicked → Search tier activated within 14 days`. This is the number that justifies the whole feature's existence.

---

## 11. Edge cases

| Case | Handling |
|---|---|
| `n < 8` for the user's exact profile | Widen: same role/adjacent seniority → same role/wider geo → role family. Always state what was widened. |
| Non-disclosure geography (most of India, much of Asia) | Disclosed ranges are rare. Lean on `OfferDataPoint` + role-family postings, and be explicit that coverage is thin. Consider suppressing the band panel entirely below a coverage threshold rather than showing a bad one. |
| Currency mixing | Never convert. Bucket by currency; if a geo has mixed currencies, pick the dominant one and say so. |
| User is a manager / non-engineer | Radar quality degrades outside tech-IC roles. R2 ships IC-tech only and says so in the UI. Don't silently serve a bad band. |
| Compliance-theater ranges ($50K–$500K) | Excluded by the width heuristic (§3.1) |
| A match at the user's current employer | Excluded by default; a setting enables internal-mobility mode |
| User marked "not looking" | Radar still sends (that's the point) but suppresses the Search CTA and softens match framing to "for reference" |
| Posting disappears between snapshot and click | Snapshot stores title/company/comp; detail page shows the cached version with "this posting is no longer listed" |
| Board returns 10,000 postings | Cap ingest at 500/board/day, prioritized by `postedAt` |
| Stale postings | `lastSeenAt` > 30 days → `stale`; > 60 → `closed`. Never match on stale. |

---

## 12. Acceptance criteria

- [ ] 500 seeded boards ingest daily with <2% error rate, within a 4-hour window
- [ ] Compensation extraction achieves ≥90% precision on a 200-posting labeled set (precision over recall — a wrong range is worse than no range)
- [ ] No band renders with `n < 8`; the fallback widening path is exercised and labeled
- [ ] Every band shows `n`, window, geo, and source breakdown without extra clicks
- [ ] Match reasons cite real Win IDs; a synthetic check confirms zero generic reasons
- [ ] Digest renders and sends monthly on the user's chosen day ±30 min
- [ ] Saving a match creates an `ApplicationWorkspace` that appears in the existing inbox and extension
- [ ] Dismissing a match with a reason measurably changes next month's set
- [ ] Free teaser shows real `n` with blurred figures
- [ ] Skill trend suppressed when `postingCount < 50` in either window
- [ ] **No code path allows a model to emit a compensation figure** — verified by review, and by a test that mocks the model to return garbage and asserts the band is unchanged

---

## 13. Out of scope

Total-comp modeling (equity valuation) · negotiation advice inside Radar (that's a Mission, 05) · company culture/review data (existing `CompanyInsight` covers this separately) · non-tech role coverage · a browsable job board (we curate 5; we are not a job board) · alerts more frequent than monthly.
