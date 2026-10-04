# 11 — The job-search journey: email, calendar, follow-ups

Status: built 2026-10-04, flag `job_journey` (seeded off).

## 1. What it does

Every application tracks itself from first contact to offer:

- **Email.** The user forwards job mail to their own Patronus address. Each
  message is read, filed under the right application, and moves the job
  forward when it is evidence of a step (interview request → Interviewing,
  rejection → Rejected, offer → Offer). A reply is drafted on request and
  opened in Gmail's compose window to send.
- **Calendar.** Google Calendar, connected directly. Interviews on it land on
  the job's timeline and move it to Interviewing. Follow-up reminders are
  added when the user asks.
- **Follow-ups.** A job applied to with nothing from the employer for 7 days
  gets a nudge (timeline + one Telegram message a day at most) and a drafted
  follow-up on tap.
- **Timeline.** Every job has one: status changes (by the user, by email, by
  calendar), emails, interviews, follow-up nudges.

## 2. Why forwarding, not Gmail access

Reading or drafting in Gmail needs Google's *restricted* scopes: app
verification plus a paid annual CASA security assessment before more than
100 users can connect, and an "unverified app" warning until then. The owner
chose forwarding first (2026-10-04): no Gmail scope at all, launchable now.
Direct Gmail access can be added later behind the same flag once the review
is done. Calendar uses `calendar.events`, a *sensitive* scope: verification,
no paid assessment.

## 3. Email in

- Address: `jobs+<token>@<INBOUND_EMAIL_DOMAIN>` (`EmailInbox`). The token is
  the credential; "New address" rotates it.
- Provider: any inbound service that posts Postmark's inbound JSON to
  `POST /api/inbound/email`. Auth: `INBOUND_EMAIL_SECRET` as the basic-auth
  password in the webhook URL, or `?secret=`. Unset = 503 (closed).
- Gmail's forwarding confirmation is recognised and its code shown in
  Settings → Email & calendar (and sent to Telegram).
- Hand-forwarded mail ("Fwd:") is unwrapped to the original sender.
- Idempotent on (user, Message-ID). 150 messages per user per day.

## 4. Filing (`src/lib/journey/classify.ts`, `src/services/journey.ts`)

One `generateStructured` call (task `jobEmailClassify`): kind, application by
index from a code-ranked shortlist (sender domain, company, role), one-line
summary under the numeric guard. Unrelated mail (`not_job`) is never filed.

Moves are forward only (`src/lib/journey/status.ts`), conditional on the
status the decision saw, recorded on the email, and undoable from the Email
tab. A late "application received" never pulls an interviewing job back; a
rejection never closes an offer; nothing reopens a closed job.

## 5. Drafts

Task `jobEmailReply`. Sources: the email, the job, and the user's confirmed
**shareable** Wins (filtered in the query, rule 3). The numeric guard holds
the body to figures in those sources; times are never invented
(`[your availability]` placeholder). Metered as `cover_letter`, refunded on
failure. Nothing is sent by Patronus.

## 6. Calendar (`src/lib/google/*`, `src/services/calendar.ts`)

Direct OAuth (not Clerk). Signed state bound to the signed-in user. Tokens
AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`). Sync window: 14 days back,
60 ahead. An event is an interview for a job only when clearly so
(`calendarMatch.ts`): company named with an interview word, or an attendee
from a domain that already emailed about the job; ties match nothing.
Cancelled events are removed from the timeline.

## 7. Daily job

`journey_daily` (schedule.ts): re-files stuck emails, then one child per user
with an inbox, a calendar or an open application: calendar sync and
follow-up nudges.

## 8. Data

`EmailInbox`, `JobEmail`, `ApplicationEvent`, `GoogleConnection`. All carry
`userId`, so account deletion and export cover them; tokens are redacted
from exports. Email text is blanked after 180 days (`purge_expired`); the
summary and timeline stay.

## 9. Owner setup

1. **Inbound email.** Pick a provider that posts Postmark-format inbound JSON
   (Postmark Inbound is the reference). Point MX for a subdomain (e.g.
   `in.patronus.cv`) at it, set the webhook to
   `https://inbound:<INBOUND_EMAIL_SECRET>@www.patronus.cv/api/inbound/email`.
   Env: `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET`.
2. **Google Calendar.** Google Cloud project → OAuth consent screen (scopes:
   `openid`, `email`, `calendar.events`) → OAuth client (Web), redirect URI
   `https://www.patronus.cv/api/google/callback`. Env: `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64:
   `openssl rand -base64 32`). Submit for verification before going past 100
   test users.
3. Enable `job_journey` in /admin (yourself first).

## 10. Not built yet

- Direct Gmail access (needs the restricted-scope review).
- Interview times read from email bodies (calendar invites cover the common case).
- A chat action for "any replies?"; the chat rail shows the count instead.
