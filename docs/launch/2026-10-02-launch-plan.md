# Launch plan (2026-10-02)

Positioning: **Patronus is with you through your whole working life** — job
search, resumes, help at your current company — wherever you talk to it: web
chat, Telegram, WhatsApp, and a CLI. "Learning" is not built and is not claimed.

Source: six code audits run 2026-10-02 (rate limits/load, metering, security,
UX, admin/observability, core paths). Each item names the exploit or failure
it closes. Status: ✅ shipped · 🔨 in progress · ⏳ next · 👤 needs the owner.

## Wave 1 — abuse, cost, security (blockers)

| | Item | Commit |
|---|---|---|
| ✅ | `/api/v1` closed: one shared key + caller-supplied userId = act as anyone | ec82ef0 |
| ✅ | Rate limits real without Upstash (Postgres fallback, per-bucket prefixes) | ec82ef0 |
| ✅ | Extension connect approved on page load → account token takeover | ec82ef0 |
| ✅ | Telegram webhook accepted all when secret unset; groups could act as owner | ec82ef0 |
| ✅ | Monthly cost cap on every model call; live totals; failed calls count | 7269bea |
| ✅ | Free loops closed: clarification resubmit, retry of finished sessions, company research refund | 7269bea |
| ✅ | Rate limits + input caps on resume AI actions, reviseLine, readiness, packets, extension, import, channels | 7269bea |
| ✅ | Timeouts: structured 90s, resume loop 180s, OpenAI client 90s/1 retry, LaTeX 45s | 7269bea |
| ✅ | Account deletion (Settings + Clerk webhook), complete export with secrets redacted | bf01499 |
| ✅ | Security headers, upload byte-sniffing, LaTeX link injection, Telegram regen scoping | bf01499 |
| 👤 | Upstash Redis (Vercel Marketplace, free) for the per-IP middleware limit | — |
| 👤 | `CLERK_WEBHOOK_SIGNING_SECRET` + Clerk webhook to `/api/clerk/webhook` (user.deleted) | — |
| 👤 | Blob storage private (`PDF_STORAGE_ACCESS`, `RESUME_IMPORT_STORAGE_ACCESS`) after checking the store type | — |

## Wave 2 — the core promise holds

| | Item |
|---|---|
| ⏳ | v2 resume: every `sourceLine` must be found in the evidence the model saw; numeric guard on summary, headline, project descriptions |
| ⏳ | v2 resume: never save zero roles when the record has some; drop bad bullets instead of failing the whole resume; `submit_resume` rejects and lets the model fix |
| ⏳ | Confirmed Wins reach the resume (a `get_confirmed_wins` tool, shareable only) |
| ⏳ | Import keeps every role (split long highlights), and says what it could not read |
| ⏳ | Stuck states recover: Scout runs idle > 10 min → failed; generation sessions killed mid-run → failed; retry route enqueue failure |
| ⏳ | Failed jobs retry within the hour, not the next day; requeue/discard dead jobs from /admin/ops |
| ⏳ | Email off is visible: banner on notifications, digests not composed when they cannot be sent, month review linked from /log |
| ⏳ | Job boards seeded (`seedLaunchList`, `discoverFromWorkspaces` have no callers), so `find_jobs` and Radar have data |
| ⏳ | Tavily absent: user copy, not operator copy; do not charge job runs whose research is all unavailable |
| 👤 | `RESEND_API_KEY` + `EMAIL_FROM` |

## Wave 3 — operator

| | Item |
|---|---|
| 🔨 | Suspend a user (DB + Clerk ban), audit log of admin actions, reset usage |
| ⏳ | /admin/[userId]: chat, runs, jobs, generation errors, channels, plan; actions |
| ⏳ | Daily operator digest to the admin's Telegram: dead jobs, error rates, spend vs ceiling, config errors |
| ⏳ | `/api/health` for an uptime monitor |
| ⏳ | Users: "connected devices" (channels + extension tokens) with disconnect |

## Wave 4 — redesign for the positioning

| | Item |
|---|---|
| ⏳ | Chat is the landing after sign-in/onboarding, on by default; cards render detail inline so they never link to a switched-off page |
| ⏳ | Nav: Chat · Jobs · Record · Documents · Goals; Settings → Channels (Web, Telegram, WhatsApp, CLI) |
| ⏳ | Landing page: career-long companion, every channel; no "learning" claim |
| ⏳ | Onboarding ends in chat and offers Telegram/WhatsApp |
| ⏳ | Remove duplicates: dashboard Copilot (duplicates /build), Applications (duplicates Inbox) |
| ⏳ | Mission steps link to where you do them; hidden routes linked (review, backfill, readiness) |
| ⏳ | Mobile: chat composer under the banner, 16px inputs (iOS zoom), editor grid, readiness widths |

## Wave 5 — CLI

| | Item |
|---|---|
| ⏳ | Per-user API keys (hashed, scoped, revocable, created in Settings → Channels) |
| ⏳ | `/api/cli/chat` on the same chat service; `patronus` CLI: chat, log, jobs, tailor |

## Wave 6 — prove it

| | Item |
|---|---|
| ⏳ | End-to-end QA harness over every flow (real model, local stack), each step pass/fail, run before launch |
| 👤 | Clerk production instance: user ID migration (every table keys on the dev-instance id), DNS, own GitHub OAuth app |
| 👤 | Razorpay keys → payments |
