/**
 * Google Calendar for the job search (docs/prd/11-job-journey.md §6).
 *
 * Reads interviews into the application timeline and moves the job to
 * "Interviewing" (forward only); writes follow-up reminders on request.
 */

import { ApplicationEventKind, ApplicationStatus } from '@prisma/client';

import { config } from '@/lib/config';
import { decryptToken, encryptToken, tokenEncryptionConfigured } from '@/lib/crypto/tokens';
import { CalendarError, calendarTimeZone, eventStart, insertEvent, listEvents, type CalendarEvent } from '@/lib/google/calendar';
import { exchangeCode, fetchGoogleEmail, googleConfigured, GoogleAuthError, refreshAccessToken, revokeToken } from '@/lib/google/oauth';
import { matchEvent, type CalendarCandidate } from '@/lib/journey/calendarMatch';
import { GENERIC_DOMAINS, senderDomain } from '@/lib/journey/inbound';
import { STATUS_LABEL, STATUS_RANK } from '@/lib/journey/status';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { track } from '@/lib/track';

let fetchImpl: typeof fetch = ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch;
export const __testing = {
    setFetch(next: typeof fetch) {
        fetchImpl = next;
    },
    reset() {
        fetchImpl = ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch;
    },
};

function appUrl(): string {
    return config.app.url.replace(/\/$/, '');
}

export function calendarAvailable(): boolean {
    return googleConfigured() && tokenEncryptionConfigured();
}

export type CalendarStatus = {
    available: boolean;
    connected: boolean;
    email: string | null;
    syncedAt: string | null;
    lastError: string | null;
};

export async function calendarStatus(userId: string): Promise<CalendarStatus> {
    const row = await prisma.googleConnection.findUnique({ where: { userId }, select: { googleEmail: true, calendarSyncedAt: true, lastError: true } });
    return {
        available: calendarAvailable(),
        connected: !!row,
        email: row?.googleEmail ?? null,
        syncedAt: row?.calendarSyncedAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
    };
}

/** The OAuth callback's work: store the grant, then a first sync so the user sees something. */
export async function connectCalendar(userId: string, code: string): Promise<Result<{ email: string }>> {
    const tokens = await exchangeCode(code, appUrl(), fetchImpl);
    if (!tokens.scopes.includes('https://www.googleapis.com/auth/calendar.events')) {
        return err('Calendar access was not granted. Tick the calendar box on Google’s screen and try again.', 'scope_missing');
    }
    const email = (await fetchGoogleEmail(tokens.accessToken, fetchImpl)) ?? 'Google account';
    const timeZone = await calendarTimeZone(tokens.accessToken, fetchImpl);
    const existing = await prisma.googleConnection.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
    await prisma.googleConnection.upsert({
        where: { userId },
        create: {
            userId, googleEmail: email, scopes: tokens.scopes, timeZone,
            accessTokenEnc: encryptToken(tokens.accessToken),
            refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
            expiresAt: tokens.expiresAt,
        },
        update: {
            googleEmail: email, scopes: tokens.scopes, timeZone, lastError: null,
            accessTokenEnc: encryptToken(tokens.accessToken),
            // Google sends a refresh token only on the first consent; keep the old one otherwise.
            refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : existing?.refreshTokenEnc ?? null,
            expiresAt: tokens.expiresAt,
        },
    });
    await track(userId, 'calendar_connected', { feature: 'job_journey' });
    await syncCalendar(userId).catch((error: unknown) => console.warn('[calendar] first sync failed', String(error)));
    return ok({ email });
}

export async function disconnectCalendar(userId: string): Promise<void> {
    const row = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!row) return;
    const token = (row.refreshTokenEnc && decryptToken(row.refreshTokenEnc)) || decryptToken(row.accessTokenEnc);
    if (token) await revokeToken(token, fetchImpl);
    await prisma.googleConnection.delete({ where: { userId } });
}

/** A live access token, refreshed when within a minute of expiry. Null: reconnect needed. */
async function accessTokenFor(userId: string): Promise<string | null> {
    const row = await prisma.googleConnection.findUnique({ where: { userId } });
    if (!row) return null;
    if (row.expiresAt.getTime() - Date.now() > 60_000) {
        const token = decryptToken(row.accessTokenEnc);
        if (token) return token;
    }
    const refresh = row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null;
    if (!refresh) {
        await prisma.googleConnection.update({ where: { userId }, data: { lastError: 'Reconnect Google Calendar' } });
        return null;
    }
    try {
        const tokens = await refreshAccessToken(refresh, fetchImpl);
        await prisma.googleConnection.update({
            where: { userId },
            data: { accessTokenEnc: encryptToken(tokens.accessToken), expiresAt: tokens.expiresAt, lastError: null },
        });
        return tokens.accessToken;
    } catch (error) {
        const message = error instanceof GoogleAuthError && error.revoked ? 'Access was removed in Google. Reconnect to keep syncing.' : 'Could not refresh Google access.';
        await prisma.googleConnection.update({ where: { userId }, data: { lastError: message } });
        return null;
    }
}

async function candidatesFor(userId: string): Promise<CalendarCandidate[]> {
    const rows = await prisma.applicationWorkspace.findMany({
        where: { userId, applicationStatus: { notIn: [ApplicationStatus.archived, ApplicationStatus.rejected] } },
        select: { id: true, companyName: true, emails: { select: { fromEmail: true }, take: 20 } },
        take: 200,
    });
    return rows.map((row) => ({
        workspaceId: row.id,
        company: row.companyName,
        knownDomains: [...new Set(row.emails.map((e) => senderDomain(e.fromEmail)).filter((d): d is string => !!d && !GENERIC_DOMAINS.has(d)))],
    }));
}

export type SyncOutcome = { scanned: number; matched: number; moved: number };

/** Two weeks back, two months ahead. Idempotent per calendar event. */
export async function syncCalendar(userId: string, now: Date = new Date()): Promise<Result<SyncOutcome>> {
    const token = await accessTokenFor(userId);
    if (!token) return err('Reconnect Google Calendar', 'reconnect');
    let events: CalendarEvent[];
    try {
        events = await listEvents(token, { timeMin: new Date(now.getTime() - 14 * 86_400_000), timeMax: new Date(now.getTime() + 60 * 86_400_000) }, fetchImpl);
    } catch (error) {
        const message = error instanceof CalendarError && (error.status === 401 || error.status === 403) ? 'Reconnect Google Calendar' : 'Calendar sync failed';
        await prisma.googleConnection.update({ where: { userId }, data: { lastError: message } });
        return err(message, 'sync_failed');
    }

    const candidates = await candidatesFor(userId);
    let matched = 0;
    let moved = 0;
    for (const event of events) {
        if (event.status === 'cancelled') {
            // The interview was called off: take it off the timeline.
            await prisma.applicationEvent.deleteMany({ where: { userId, kind: ApplicationEventKind.interview, refId: `gcal:${event.id}` } });
            continue;
        }
        const workspaceId = matchEvent(event, candidates);
        const start = eventStart(event);
        if (!workspaceId || !start) continue;
        matched += 1;
        const title = (event.summary || 'Interview').slice(0, 300);
        await prisma.applicationEvent.upsert({
            where: { workspaceId_kind_refId: { workspaceId, kind: ApplicationEventKind.interview, refId: `gcal:${event.id}` } },
            create: { userId, workspaceId, kind: ApplicationEventKind.interview, occurredAt: start, title, detail: event.htmlLink ?? null, source: 'calendar', refId: `gcal:${event.id}` },
            // A rescheduled interview keeps its row and takes the new time.
            update: { occurredAt: start, title, detail: event.htmlLink ?? null },
        });
        const job = await prisma.applicationWorkspace.findUnique({ where: { id: workspaceId }, select: { applicationStatus: true } });
        if (!job || STATUS_RANK[job.applicationStatus] >= STATUS_RANK.interview) continue;
        const changed = await prisma.applicationWorkspace.updateMany({
            where: { id: workspaceId, applicationStatus: job.applicationStatus },
            data: { applicationStatus: ApplicationStatus.interview },
        });
        if (changed.count === 1) {
            moved += 1;
            await prisma.applicationEvent.create({
                data: {
                    userId, workspaceId, kind: ApplicationEventKind.status_change, occurredAt: now,
                    title: `Moved to ${STATUS_LABEL.interview}`, detail: `From your calendar: ${title}`.slice(0, 300),
                    source: 'calendar', refId: `gcal-move:${event.id}`, fromStatus: job.applicationStatus, toStatus: ApplicationStatus.interview,
                },
            }).catch(() => undefined);
        }
    }
    await prisma.googleConnection.update({ where: { userId }, data: { calendarSyncedAt: now, lastError: null } });
    await track(userId, 'calendar_synced', { feature: 'job_journey', scanned: events.length, matched, moved });
    return ok({ scanned: events.length, matched, moved });
}

/** A 15-minute "Follow up" reminder on the user's calendar. Returns the event link. */
export async function addFollowUpReminder(userId: string, workspaceId: string, when: Date): Promise<Result<{ link: string | null }>> {
    const job = await prisma.applicationWorkspace.findFirst({ where: { id: workspaceId, userId }, select: { companyName: true, roleTitle: true, scoutRunId: true } });
    if (!job) return err('That job is not in your tracker', 'not_found');
    const token = await accessTokenFor(userId);
    if (!token) return err('Connect Google Calendar first', 'reconnect');
    const connection = await prisma.googleConnection.findUnique({ where: { userId }, select: { timeZone: true } });
    const what = `${job.roleTitle ?? 'your application'}${job.companyName ? ` at ${job.companyName}` : ''}`;
    const link = job.scoutRunId ? `${appUrl()}/scout/${job.scoutRunId}` : `${appUrl()}/scout`;
    try {
        const event = await insertEvent(token, {
            summary: `Follow up: ${what}`,
            description: `Draft the follow-up in Patronus: ${link}`,
            start: when,
            minutes: 15,
            timeZone: connection?.timeZone ?? null,
        }, fetchImpl);
        return ok({ link: event.htmlLink ?? null });
    } catch {
        return err('Could not add it to your calendar', 'calendar_failed');
    }
}

/** Users with a calendar connected, for the daily sync's fan-out. */
export async function connectedUserIds(limit = 5_000): Promise<string[]> {
    const rows = await prisma.googleConnection.findMany({ select: { userId: true }, take: limit });
    return rows.map((row) => row.userId);
}
