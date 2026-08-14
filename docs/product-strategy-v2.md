# Patronus — Product Strategy v2 (PM Redesign)

## Status
- Document state: `Proposed` — strategic redesign, supersedes the scattered framing across `one-stop-platform-plan.md` and `resume-builder-experience-plan.md` at the *vision* level (those remain authoritative for engineering sequencing).
- Author: AI Product Analyst pass, 2026-06-26
- Audience: founder/owner deciding what to build and what to charge for.

---

## 0. The one-line thesis

> **Patronus is the system that knows your career better than you do — and uses that to write a truthful, role-perfect resume and apply for you on any portal, while you watch.**

Everything below ladders up to one defensible idea: **the moat is the Career Context Graph**, not the resume editor and not the autofill. Editors are commoditized (Rezi, Kickresume, Canva). Autofill is commoditized (Simplify, LazyApply). ATS scoring is commoditized (Jobscan, Teal). **Nobody owns a rich, verified, continuously-growing model of *who the user actually is* and uses it to make every output more accurate.** That's what we build, and that's what people pay for.

---

## 1. Why this product, why now, and who pays

### The honest market read
| Competitor | Owns | Weakness we exploit |
|---|---|---|
| Teal | Tracker + bookmark + light AI | Shallow tailoring, no apply-automation, generic context |
| Jobscan | ATS keyword match | One feature, no build, no apply, $49/mo for a score |
| Rezi / Kickresume | Editor + templates | No portal apply, no tracking, "AI" = generic rewrite |
| Simplify / LazyApply | Mass autofill | Spray-and-pray, *hurts* accuracy, no resume quality, ban risk |
| Careerflow / Huntr | Tracker + LinkedIn | No deep resume engine |

Every competitor owns **one slice**. None combines *deep truthful context → perfect resume → one-click apply → tracking* in a single loop. That's the wedge. The reason it's defensible: the context graph compounds. The 50th application is dramatically easier and better than the 1st because the system has learned the user. Switching cost = re-teaching a new tool everything about your career.

### Who actually pays (and the trap to avoid)
The **trap**: building for "everyone job hunting." Job-seekers are episodic, price-sensitive, and churn the moment they get hired. Build the *whole* business on them and you have a leaky bucket.

Three payer segments, ranked by willingness-to-pay durability:

1. **The Active Switcher (primary, immediate revenue).** Mid-to-senior IC, currently applying to 10–60 roles over 4–10 weeks. Acute pain, time-poor, willing to pay $20–40/mo *for the duration of the hunt*. Monetize the **intensity** of the hunt, not a permanent subscription they'll resent.
2. **The Always-On Professional (retention & LTV).** Keeps profile warm, gets curated matches, applies opportunistically. Lower intensity, but if the context graph + tracker becomes their "career home base," they stay subscribed at a lower tier between hunts. This is the recurring revenue that survives them getting hired.
3. **The Career Coach / Bootcamp / University Career Center (B2B2C, highest LTV).** Sells *outcomes*. Wants a multi-seat dashboard, branded resumes, cohort analytics. This is where real margin lives later — don't build it first, but design the data model so it's not a rewrite.

**Pricing principle:** charge for *outcomes and intensity* (tailored generations, multi-step auto-applies, deep company intel), keep *table-stakes* free (score, basic build, manual export) so the funnel never clogs.

---

## 1.5. DECISION: primary payer = the Always-On Professional

Owner decision (2026-06-26): optimize the first chapter of this redesign for the **Always-On Professional**, not the Active Switcher. This is a *retention-first* posture rather than a revenue-velocity posture, and it changes emphasis throughout:

- **The product is a permanent career home base, not a hunt-season tool.** The pitch shifts from "get hired fast" to "keep your career always ready — and pounce when the right role appears."
- **Pillar 4 (Track & Coach) and the context graph's *continuous capture* are the headline value**, not multi-step auto-apply. Apply automation still ships, but as a payoff for an already-warm profile rather than the lead hook.
- **Pricing center of gravity moves to the low, durable tier.** Rather than treating "$5 Pause/Hired" as an afterthought, make a **~$8–12/mo "always-on" plan the default paid product**: keeps the profile warm, runs a curated match digest, maintains the tracker, and includes a modest monthly tailoring allotment. The high-intensity Pro tier becomes the *upgrade during an active hunt*, not the entry point.
- **Retention metrics lead.** The north star for chapter one is *months-active per user* and *profile-still-warm rate at 90 days*, not free→Pro conversion speed.

The roadmap in §9 is annotated below to reflect this — coaching, continuous capture, match digest, and the always-on tier are pulled earlier; multi-step orchestration stays important but is no longer the single flagship.

## 2. The product spine: four pillars around one engine

```
                    ┌──────────────────────────────────┐
                    │   CAREER CONTEXT GRAPH (the moat)  │
                    │  experiences · projects · proof ·  │
                    │  voice · preferences · feedback    │
                    └──────────────────────────────────┘
                          ▲          │          ▲
              learns from │          │ feeds     │ learns from
                          │          ▼          │
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ 1. KNOW ME   │  │ 2. BUILD ME  │  │ 3. APPLY     │  │ 4. TRACK &   │
   │ (onboarding/ │  │ (truthful    │  │ (one-stop    │  │ COACH        │
   │  ingestion)  │  │  tailoring)  │  │  apply)      │  │ (pipeline)   │
   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

The pillars are a journey, not a menu. Each one *both consumes and enriches* the graph. That feedback loop is the whole game.

---

## 3. Pillar 1 — KNOW ME (the context engine)
**Goal:** richest, most accurate model of the user, captured with the least effort. This is where "as much context as possible" gets built.

This is the most under-invested area today (you have manual entry + a PDF import + manual GitHub username). Make this *magical* and the rest of the product gets better for free.

### Features
| Feature | Free/Paid | Why it matters |
|---|---|---|
| **Multi-source ingestion** — LinkedIn export, existing resume (PDF/DOCX ✅ done), GitHub repos (auto-summarized into impact bullets), personal site/portfolio URL scrape | Free to import, Paid for auto-enrichment | Cold-start is the #1 reason people abandon resume tools. Kill the blank page. |
| **The Context Interview** — a short, AI-led conversational intake (voice or chat) that extracts *quantified impact* the user would never think to write ("you said you 'improved the pipeline' — by how much? how many users?") | Paid (premium onboarding) | This is the single highest-leverage feature. It's how we get metrics competitors' generic rewrites can never invent. Differentiator. |
| **Proof & evidence layer** — every claim links to a source (a repo, a metric the user confirmed, a doc). Stored on `KnowledgeItem`. | Free | The foundation of the **truthfulness guarantee** (§5). No claim without a source. |
| **Voice capture** — sample the user's real writing once; store a voice profile so drafted answers/summaries sound like them, not like ChatGPT | Paid | Recruiters can smell AI boilerplate. Sounding human is a paid superpower. |
| **Profile completeness & strength meter** — gamified, shows exactly what's missing and what each addition unlocks | Free | Drives graph richness, which drives output quality, which drives willingness to pay. Self-reinforcing. |
| **Continuous capture** — "you just applied to a PM role — want to add the side project you mentioned in the cover letter to your profile?" | Free | The graph compounds passively. |

### PM note
You already embed experiences/projects/knowledge in Qdrant. The missing layer is **structured impact extraction + evidence linking + a delightful intake**. Prioritize the Context Interview — it's the demo that makes someone say "oh, this is different."

---

## 4. Pillar 2 — BUILD ME (truthful tailoring)
**Goal:** the best, most accurate, role-specific resume — provably truthful, visibly tailored.

You have the pipeline (JD parse → semantic match → paraphrase → assemble → validate → ATS → PDF). The redesign is about **trust, transparency, and control**, which is what justifies payment over a free GPT prompt.

### Features
| Feature | Free/Paid | Why it matters |
|---|---|---|
| **Truthfulness guarantee** — claim validator (✅ exists) elevated to a *visible product promise*: every bullet shows a "✓ grounded in your profile" or "⚠ needs your confirmation" chip. Nothing fabricated. | Free (it's the brand) | This is your anti-AI-slop moat. "Patronus never lies on your resume." Make it the tagline. |
| **Tailored generation** with a visible **diff vs. master** — show exactly what changed for *this* job and why (keyword X added, project Y promoted) | Paid (metered: N free/mo, unlimited on Pro) | Tailoring is the core paid action. Showing the *why* converts trust into renewals. |
| **Real-time generation theater** — replace the black-box wait with a streamed, legible play-by-play ("matching your 6 projects to this JD… promoting the Stripe integration… checking claims…") | Free | Perceived quality. A 30s wait that *shows its work* feels premium; a silent spinner feels broken. You flagged this gap yourself. |
| **Side-by-side ATS before/after** + prioritized fix list (✅ scorer exists) with one-click apply-fix | Free score, Paid auto-fix | The Jobscan killer — bundled, not a separate $49 tool. |
| **Multiple truthful angles** — generate 2–3 framings (e.g. "lead with leadership" vs "lead with technical depth") and let the user pick | Paid | Higher perceived value per generation; great for senior roles. |
| **Cover letter + outreach DM** from the same context + JD | Paid | Natural attach; one context, three artifacts. |
| **Design system** (templates/themes ✅ done) — keep, but **demote LaTeX to "Advanced"** and ship 2–3 genuinely recruiter-tested templates rather than 4 mediocre ones | Free | Polish. Fewer, better. |

### PM note
**Collapse the 13-item editor sidebar.** Recommended IA: *Content · Tailor · Score & Fix · Design · (Advanced: LaTeX/JSON)*. Move the knowledge base out of the per-resume editor and into the profile (it's user-level, not resume-level). This single cleanup is the difference between "developer tool" and "product."

---

## 5. Pillar 3 — APPLY (one-stop, any portal)
**Goal:** apply on any site without retyping, without losing the resume's quality, without auto-submit risk.

Your extension is the strongest existing asset and your `one-stop-platform-plan.md` already nails the engineering. The PM additions:

| Feature | Free/Paid | Why it matters |
|---|---|---|
| **Multi-step orchestration** (Workday/Greenhouse/Lever across pages) | Paid (the headline paid feature) | This is the "80% less effort" promise. It's hard, valuable, and defensible — exactly what to charge for. |
| **Fit score on every job page** — within ~5s of landing | Free (it's the hook that sells the extension) | Free value that demonstrates the context graph live, in the wild. |
| **Tailored-resume-at-apply** — generate scoped to the current JD, inherit the source theme | Paid (counts against generation quota) | Quality where it matters most: the moment of applying. |
| **Question drafting in the user's voice** with one-click insert + reusable answer memory (✅ partial) | Paid | The thing that makes app #30 take 2 minutes instead of 20. |
| **Never auto-submit** (locked decision ✅) — but surface "review & submit" with a final truthfulness pass | Free principle | Trust. Mass-apply tools spray garbage; we apply *well*. Position against them explicitly. |
| **Apply-readiness gate** — won't let you fire off applications until profile completeness clears a bar | Free | Protects output quality = protects the brand. |

### PM note
Resist the urge to build "mass auto-apply." It's a race to the bottom that destroys the truthfulness brand and risks user account bans. **Our pitch is the opposite of LazyApply: fewer, dramatically better applications, near-effortlessly.** That's a premium position and a durable one.

---

## 6. Pillar 4 — TRACK & COACH (the home base)
**Goal:** become the user's permanent career home base so they don't churn the day they get hired.

This is the retention pillar — the antidote to the leaky-bucket problem. You have `ApplicationWorkspace` + status state machine planned; the PM elevation is turning a *tracker* into a *coach*.

| Feature | Free/Paid | Why it matters |
|---|---|---|
| **Application inbox / pipeline** — every workspace, status, resume-used, JD snapshot, deep link back | Free | Table stakes; the reason they keep the app installed. |
| **Auto-status detection** — confirmation-page heuristics flip status to "submitted" | Paid | Removes the one manual step trackers always have. |
| **Pipeline analytics** — "your resume gets 3× more responses when it scores >85"; response rates by resume version, by role type | Paid | Turns data into *advice*. This is coaching, and coaching retains. |
| **Follow-up nudges** — "applied 10 days ago, no movement — draft a follow-up?" via email/Telegram | Paid | Re-engagement engine; reason to open the app between hunts. |
| **Interview prep from the graph + JD** — likely questions, your best evidence-backed answers | Paid | Extends value past "apply" into "land the job" = outcome ownership = pricing power. |
| **Offer/comp tracking** | Free | Sticky, low-cost, keeps them around for next time. |

### PM note
The metric that matters here isn't applications sent — it's **interviews landed per 10 applications**. If we can credibly improve that ratio (and prove it with their own pipeline data), we own the outcome narrative and can charge accordingly.

---

## 7. Monetization

### Recommended tiers
| Tier | Price | Who | What |
|---|---|---|---|
| **Free** | $0, no login for score | Top of funnel | ATS score, 1 master resume, basic build & manual export, fit-score-on-page in extension, manual tracking. Generous on purpose. |
| **Pro** | **$24/mo** or **$15/mo annual** | The Active Switcher | Unlimited tailored generations, multi-step auto-apply, voice-matched answers, Context Interview, auto-fix, cover letters, company intel, auto-status, pipeline analytics. |
| **Pause / Hired** | **$5/mo** | Always-On Professional | Keeps profile warm + tracker + light match digest between hunts. The anti-churn tier — offered *at the moment they mark "got an offer."* |
| **Teams / Coaches** | Custom | B2B2C | Multi-seat, cohort analytics, branded exports. Design-for now, sell later. |

### The metering insight
Meter **tailored generations** and **auto-applies** — the expensive, high-value AI actions (you already track cost per op in `ApiUsageLog` ✅). Free tier gets a small monthly allotment so the value is *felt* before the paywall. The paywall lands at the moment of peak intent: *"You've used your 3 free tailored resumes this month. The next role you actually care about — let's make it perfect. Upgrade."*

### Why not free-forever (current positioning)
Your landing page currently says "free forever." That's leaving money on the table *and* signaling "hobby project." A confident, value-based price signals "this is a serious tool that gets you hired." Keep the free tier genuinely useful; charge for intensity and outcomes.

---

## 8. The quality bar that makes people pay ("polish")

Paying happens when the product feels *trustworthy and crafted*. Concrete bars:

1. **No black boxes.** Every wait shows its work (generation theater). Every AI claim shows its source. Every fill shows what & why.
2. **Truthfulness as a visible, branded guarantee** — not a hidden validator. "Patronus never invents anything."
3. **Speed budgets** — score < 5s, side-panel first paint < 200ms, tailored resume < 30s with live progress.
4. **One coherent design system** across web + extension (already a locked decision ✅ — finish it).
5. **Sound human** — voice matching so outputs don't read as AI.
6. **Fewer, better** — 3 great templates not 4 okay ones; 5 sidebar items not 13.
7. **Reversibility everywhere** — undo on fills, undo on status flips, diff before apply. Trust = the ability to undo.

---

## 9. Prioritized roadmap (PM lens — value × effort × moat)

> Reordered for the **Always-On Professional** decision (§1.5): retention and home-base value lead; auto-apply follows.

### NOW (next ~6 weeks) — "become the home base, and trustworthy"
1. **Monetization scaffolding** — Stripe, tiers, generation metering (your cost-tracking is already there). Center the **always-on tier**, not just Pro. *Nothing else matters without the ability to capture value.*
2. **Application inbox** (extension Wave 3 inbox view) — the home base needs a home screen. Pulled forward: it's the reason an Always-On user keeps the app installed between hunts.
3. **Generation theater** — stream the pipeline you already have. Cheap, huge perceived-quality win.
4. **Truthfulness guarantee, made visible** — surface the existing claim validator as grounded/needs-confirm chips + a brand promise.
5. **Editor IA cleanup** — collapse sidebar, demote LaTeX, move knowledge base to profile.

### NEXT (~6–12 weeks) — "keep them warm and learning"
6. **Context Interview v1 + continuous capture** — the wedge demo *and* the engine that keeps a passive user's graph growing between hunts. Doubly valuable for this segment.
7. **GitHub auto-ingestion** + LinkedIn export import — fill the context graph automatically.
8. **Auto-status detection** + **follow-up nudges** (email/Telegram) — the re-engagement engine that brings an Always-On user back without an active hunt.
9. **Match digest v1** — a light curated "roles you'd fit" feed (seeded from Greenhouse/Lever public boards) delivered to the inbox/Telegram. The recurring reason to open the app.

### LATER — "own the outcome & monetize intensity"
10. **Multi-step orchestration** (extension Wave 1–2) — still the hard, defensible apply feature, now positioned as the *Pro upgrade during an active hunt* rather than the lead hook.
11. **Voice matching** for answers & summaries.
12. **Pipeline analytics + coaching** (interviews-per-10 narrative).
13. **Interview prep from the graph.**
14. **Full discovery / job ingestion** (Greenhouse/Lever public boards — Wave 4).
15. **Teams/Coaches B2B2C.**

### Sequencing logic (for the Always-On bet)
- Monetization first or you're building a charity. It's small and you already track costs — and the tier shape (always-on as default) is the decision that matters here.
- The **inbox + nudges + match digest** trio (items 2, 8, 9) is what converts a one-time tool into a subscription someone keeps between hunts. That's the whole retention thesis — pull it early.
- Trust/polish (3–5) are cheap and convert *existing* capability into *perceived* premium — still best ROI.
- **Continuous capture** (6) is what makes the graph compound passively while the user isn't actively job-hunting — the moat mechanism specific to this segment.
- Multi-step orchestration (10) is no longer the flagship, but it's the natural value-add that justifies the Pro step-up the moment an Always-On user enters an active hunt.

---

## 10. The metrics that tell us it's working
| Layer | North-star | Leading indicators |
|---|---|---|
| Acquisition | Free score → signup rate | scores run, signup conversion |
| Activation | **Profile strength reaches "strong"** | ingestion completion, Context Interview completion |
| Value | **Tailored resumes generated / user** | generation theater completion, fix-apply rate |
| Apply | Applications completed via extension | multi-step completion %, fields auto-filled % |
| **Outcome (the one that matters)** | **Interviews landed per 10 applications** | response rate by resume score |
| Monetization | Free→Pro conversion, Pro retention, Pause-tier capture | paywall-hit→upgrade, hired→pause conversion |
| Moat | Context graph richness over time | evidence-linked claims per user, repeat-tailoring reuse rate |

---

## 11. What to explicitly NOT build
- **Mass auto-apply / auto-submit.** Destroys the truthfulness brand, risks user bans. Our whole position is the opposite.
- **LinkedIn scraping.** ToS-hostile, ban risk on the user (already a locked decision ✅).
- **A 5th resume template before the first 3 are recruiter-validated.**
- **WhatsApp / more channels** before web + extension are excellent (already parked ✅).
- **B2B dashboard** before the consumer loop converts and retains.

---

## 12. The pitch, in one paragraph (use this on the landing page)
> Most resume tools give you a blank page and a thesaurus. Patronus learns your real career — your projects, your impact, your proof — through a 5-minute interview, then writes a truthful, recruiter-perfect resume tailored to any job in 30 seconds, and applies for you across Workday, Greenhouse, Lever, and LinkedIn without you retyping a thing. It never invents a single claim, it sounds like you, and it tracks every application until you land the offer. Fewer applications. Far better ones. Effortlessly.
