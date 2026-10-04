'use server';

/**
 * Job-search journey actions (docs/prd/11-job-journey.md).
 *
 * Convention: Clerk `auth()` → flag → zod → rate limit → (meter) → work → `Result`.
 * Drafts are metered as `cover_letter` ("Cover letters and outreach"), the
 * same quota Scout's outreach drafts use, and refunded when the draft fails.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

import { gateMeteredAction, isEntitlementError, refundMeteredAction } from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';
import { checkRateLimit } from '@/lib/rateLimit';
import { err, ok, type Result } from '@/lib/result';
import {
    addFollowUpReminder,
    calendarStatus,
    disconnectCalendar,
    syncCalendar,
    type CalendarStatus,
    type SyncOutcome,
} from '@/services/calendar';
import {
    createJobFromEmail,
    draftFollowUpFor,
    draftReplyFor,
    getJourney,
    getOrCreateInbox,
    ignoreEmail,
    linkEmail,
    listJobEmails,
    rotateInbox,
    setEmailHandled,
    undoEmailMove,
    type InboxView,
    type JobEmailView,
    type JourneyEvent,
} from '@/services/journey';

type Gate = { userId: string } | { error: Result<never> };

async function gate(): Promise<Gate> {
    const { userId } = await auth();
    if (!userId) return { error: err('Not signed in', 'unauthenticated') };
    if (!(await isEnabled(userId, 'job_journey'))) return { error: err('Email and calendar are not available on your account yet', 'not_available') };
    return { userId };
}

const Id = z.string().min(1).max(64);

async function metered<T>(userId: string, reason: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
    const limited = await checkRateLimit('ai', userId);
    if (!limited.allowed) return err(limited.error ?? 'Too many requests', 'rate_limited');
    try {
        await gateMeteredAction(userId, 'cover_letter');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }
    try {
        const result = await run();
        if (!result.success) await refundMeteredAction(userId, 'cover_letter', { reason });
        return result;
    } catch (error) {
        await refundMeteredAction(userId, 'cover_letter', { reason });
        console.warn('[journey] draft failed', { reason, error: String(error) });
        return err('Could not write that draft. Try again.', 'draft_failed');
    }
}

// ───────────────────────────────────────────────────────────── setup

export async function getEmailSetup(): Promise<Result<{ inbox: InboxView; calendar: CalendarStatus }>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const [inbox, calendar] = await Promise.all([getOrCreateInbox(g.userId), calendarStatus(g.userId)]);
    return ok({ inbox, calendar });
}

export async function rotateEmailAddress(): Promise<Result<InboxView>> {
    const g = await gate();
    if ('error' in g) return g.error;
    return ok(await rotateInbox(g.userId));
}

export async function disconnectGoogleCalendar(): Promise<Result<void>> {
    const g = await gate();
    if ('error' in g) return g.error;
    await disconnectCalendar(g.userId);
    return ok(undefined);
}

export async function syncGoogleCalendar(): Promise<Result<SyncOutcome>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const limited = await checkRateLimit('calendarSync', g.userId);
    if (!limited.allowed) return err(limited.error ?? 'Try again later', 'rate_limited');
    return syncCalendar(g.userId);
}

// ───────────────────────────────────────────────────────────── emails

export async function listEmails(input: { includeIgnored?: boolean } = {}): Promise<Result<JobEmailView[]>> {
    const g = await gate();
    if ('error' in g) return g.error;
    return ok(await listJobEmails(g.userId, { includeIgnored: !!input.includeIgnored }));
}

export async function draftEmailReply(input: { emailId: string; intent?: string }): Promise<Result<JobEmailView>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const parsed = z.object({ emailId: Id, intent: z.string().trim().max(500).optional() }).safeParse(input);
    if (!parsed.success) return err('Invalid input', 'invalid_input');
    return metered(g.userId, 'job_email_reply_failed', () => draftReplyFor(g.userId, parsed.data.emailId, parsed.data.intent));
}

export async function undoEmailStatus(emailId: string): Promise<Result<JobEmailView>> {
    const g = await gate();
    if ('error' in g) return g.error;
    if (!Id.safeParse(emailId).success) return err('Invalid id', 'invalid_input');
    return undoEmailMove(g.userId, emailId);
}

export async function fileEmailUnder(input: { emailId: string; workspaceId: string | null }): Promise<Result<JobEmailView>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const parsed = z.object({ emailId: Id, workspaceId: Id.nullable() }).safeParse(input);
    if (!parsed.success) return err('Invalid input', 'invalid_input');
    return linkEmail(g.userId, parsed.data.emailId, parsed.data.workspaceId);
}

export async function createJobFromEmailAction(emailId: string): Promise<Result<JobEmailView>> {
    const g = await gate();
    if ('error' in g) return g.error;
    if (!Id.safeParse(emailId).success) return err('Invalid id', 'invalid_input');
    return createJobFromEmail(g.userId, emailId);
}

export async function markEmailHandled(input: { emailId: string; handled: boolean }): Promise<Result<void>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const parsed = z.object({ emailId: Id, handled: z.boolean() }).safeParse(input);
    if (!parsed.success) return err('Invalid input', 'invalid_input');
    return setEmailHandled(g.userId, parsed.data.emailId, parsed.data.handled);
}

export async function ignoreJobEmail(emailId: string): Promise<Result<void>> {
    const g = await gate();
    if ('error' in g) return g.error;
    if (!Id.safeParse(emailId).success) return err('Invalid id', 'invalid_input');
    return ignoreEmail(g.userId, emailId);
}

// ───────────────────────────────────────────────────────────── a job's journey

export async function getJobJourney(workspaceId: string): Promise<Result<{ events: JourneyEvent[]; emails: JobEmailView[] }>> {
    const g = await gate();
    if ('error' in g) return g.error;
    if (!Id.safeParse(workspaceId).success) return err('Invalid id', 'invalid_input');
    return getJourney(g.userId, workspaceId);
}

export async function draftJobFollowUp(workspaceId: string): Promise<Result<{ subject: string; body: string; to: string; composeUrl: string }>> {
    const g = await gate();
    if ('error' in g) return g.error;
    if (!Id.safeParse(workspaceId).success) return err('Invalid id', 'invalid_input');
    return metered(g.userId, 'follow_up_draft_failed', () => draftFollowUpFor(g.userId, workspaceId));
}

export async function remindMeToFollowUp(input: { workspaceId: string; at: string }): Promise<Result<{ link: string | null }>> {
    const g = await gate();
    if ('error' in g) return g.error;
    const parsed = z.object({ workspaceId: Id, at: z.string().datetime({ offset: true }) }).safeParse(input);
    if (!parsed.success) return err('Pick a date and time', 'invalid_input');
    const when = new Date(parsed.data.at);
    if (when.getTime() < Date.now() - 60_000 || when.getTime() > Date.now() + 365 * 86_400_000) return err('Pick a time in the next year', 'invalid_input');
    return addFollowUpReminder(g.userId, parsed.data.workspaceId, when);
}
