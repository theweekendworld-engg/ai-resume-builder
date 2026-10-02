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
| ✅ | v2 resume: every `sourceLine` must be found in the evidence the model saw; numeric guard on summary, headline, project descriptions (c48f7f4) |
| ✅ | v2 resume: drop bad bullets instead of failing the whole resume; `submit_resume` rejects and lets the model fix (c48f7f4) |
| ✅ | Confirmed Wins reach the resume: role evidence includes the role's confirmed shareable Wins (c48f7f4) |
| ✅ | Import keeps every role (long highlights split) (c48f7f4) |
| ✅ | Stuck states recover: Scout runs idle > 15 min and generations > 30 min failed; stalled re-share restarts free (c48f7f4) |
| ✅ | Failed jobs retry within minutes (health-check drain); requeue/discard dead jobs from /admin/ops (c48f7f4, c9f7dcc) |
| ✅ | Email off is visible; email digests not composed when they cannot be sent; Work Log links Month in Review (c48f7f4) |
| ✅ | Job boards seeded and discovered from shared jobs (c48f7f4) |
| ✅ | Tavily absent: user copy, not operator copy (c48f7f4) |
| 👤 | `RESEND_API_KEY` + `EMAIL_FROM` |

## Wave 3 — operator

| | Item |
|---|---|
| ✅ | Suspend a user (DB + Clerk ban), audit log of admin actions, reset usage (c9f7dcc) |
| ✅ | /admin/[userId]: chat, runs, jobs, generation errors, channels, plan; actions (c9f7dcc) |
| ✅ | Daily operator digest to the admin's Telegram (c9f7dcc) |
| ✅ | `/api/health` for an uptime monitor (c9f7dcc) |
| ✅ | Settings → Channels: connected devices, disconnect the extension (0349954) |

## Wave 4 — redesign for the positioning

| | Item |
|---|---|
| ✅ | Chat is the landing after sign-in/onboarding (via /app); cards never link to a switched-off page (0349954) |
| ✅ | Nav: Chat · Goals · Work Log · Jobs · Resumes; Settings → Channels (0349954) |
| ✅ | Landing page: career-long companion; claims only live channels (0349954) |
| ✅ | Onboarding ends in chat; chat offers Telegram (0349954) |
| ✅ | Copilot and Applications out of the dashboard menu (0349954) |
| ✅ | Mission steps link to where you do them; hidden routes linked (0349954) |
| ✅ | Mobile: sticky chat composer, 16px inputs, editor grid, readiness widths (0349954) |
| ✅ | Visual redesign: sidebar shell + phone tab bar, chat home with record rail, Resumes tabs (delete confirms), Jobs board, landing chat demo + channels |

## Wave 5 — CLI

| | Item |
|---|---|
| ✅ | Per-user API keys (hashed, revocable, Settings → Channels) (ec79dd3) |
| ✅ | `/api/cli/v1/*` on the chat service; `patronus` CLI (ec79dd3) |
| 👤 | Publish the CLI: `cd cli && npm publish` |

## Wave 6 — prove it

| | Item |
|---|---|
| 🔨 | End-to-end QA harness over every flow (real model, local stack), each step pass/fail, run before launch |
| 👤 | Clerk production instance: user ID migration (every table keys on the dev-instance id), DNS, own GitHub OAuth app |
| 👤 | Razorpay keys → payments |
