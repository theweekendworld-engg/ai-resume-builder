/**
 * The job-search journey (docs/prd/11-job-journey.md).
 *
 * Forwarded email is filed against the user's applications, moves a job
 * forward when it is evidence of a step (never backwards, always undoable),
 * and lands on the application's timeline next to status changes, calendar
 * interviews and follow-up nudges.
 */

import { randomBytes } from 'node:crypto';
import { ApplicationEventKind, ApplicationStatus, Channel, JobEmailKind, JobEmailStatus, Prisma } from '@prisma/client';

import { config } from '@/lib/config';
import { isEnabled } from '@/lib/flags';
import { classifyJobEmail, type Candidate } from '@/lib/journey/classify';
import { draftFollowUp, draftReply, gmailComposeUrl, type Draft } from '@/lib/journey/draft';
import { GENERIC_DOMAINS, parseInbound, senderDomain, type InboundPayload } from '@/lib/journey/inbound';
import { KIND_LABEL, nextStatusFor, STATUS_LABEL } from '@/lib/journey/status';
import { escapeTelegramHtml } from '@/lib/channels/format';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';
import { err, ok, type Result } from '@/lib/result';
import { sendTelegramMessageDetailed } from '@/lib/telegram';
import { track } from '@/lib/track';

// ───────────────────────────────────────────────────────────── the address

export function inboundDomain(): string | null {
    return process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null;
}

export function addressFor(token: string): string | null {
    const domain = inboundDomain();
    return domain ? `jobs+${token}@${domain}` : null;
}

function newToken(): string {
    // 16 base32-ish characters: ~80 bits, and readable in an address.
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(16);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export type InboxView = {
    address: string | null;
    forwardingCode: string | null;
    forwardingConfirmUrl: string | null;
    forwardingSeenAt: string | null;
    lastReceivedAt: string | null;
    received: number;
};

export async function getOrCreateInbox(userId: string): Promise<InboxView> {
    const inbox = await prisma.emailInbox.upsert({
        where: { userId },
        create: { userId, token: newToken() },
        update: {},
    });
    const received = await prisma.jobEmail.count({ where: { userId } });
    return {
        address: addressFor(inbox.token),
        forwardingCode: inbox.forwardingCode,
        forwardingConfirmUrl: inbox.forwardingConfirmUrl,
        forwardingSeenAt: inbox.forwardingSeenAt?.toISOString() ?? null,
        lastReceivedAt: inbox.lastReceivedAt?.toISOString() ?? null,
        received,
    };
}

/** A new address; the old one stops working at once. For a leaked address. */
export async function rotateInbox(userId: string): Promise<InboxView> {
    await prisma.emailInbox.upsert({
        where: { userId },
        create: { userId, token: newToken() },
        update: { token: newToken(), forwardingCode: null, forwardingConfirmUrl: null, forwardingSeenAt: null },
    });
    return getOrCreateInbox(userId);
}

// ───────────────────────────────────────────────────────────── receiving

export type ReceiveOutcome =
    | { status: 'unroutable' | 'unknown_inbox' | 'not_enabled' | 'rate_limited' }
    | { status: 'forwarding_confirmation'; userId: string }
    | { status: 'duplicate' | 'stored'; userId: string; emailId: string };

/**
 * One inbound message. Idempotent on (user, Message-ID): a re-delivery is the
 * same row and is not classified twice.
 */
export async function receiveInbound(payload: InboundPayload): Promise<ReceiveOutcome> {
    const parsed = parseInbound(payload, inboundDomain());
    if (parsed.kind === 'unroutable') return { status: 'unroutable' };

    const inbox = await prisma.emailInbox.findUnique({ where: { token: parsed.token }, select: { userId: true } });
    if (!inbox) return { status: 'unknown_inbox' };
    const userId = inbox.userId;

    if (parsed.kind === 'forwarding_confirmation') {
        await prisma.emailInbox.update({
            where: { userId },
            data: { forwardingCode: parsed.code, forwardingConfirmUrl: parsed.confirmUrl, forwardingSeenAt: new Date() },
        });
        await notifyTelegram(userId, `Gmail asked to confirm forwarding to Patronus.${parsed.code ? `\n\nConfirmation code: ${parsed.code}` : ''}\n\nFinish setup: ${appUrl()}/settings/email`);
        return { status: 'forwarding_confirmation', userId };
    }

    if (!(await isEnabled(userId, 'job_journey'))) return { status: 'not_enabled' };
    const limited = await checkRateLimit('inboundEmail', userId);
    if (!limited.allowed) return { status: 'rate_limited' };

    const existing = await prisma.jobEmail.findUnique({ where: { userId_messageId: { userId, messageId: parsed.messageId } }, select: { id: true } });
    if (existing) return { status: 'duplicate', userId, emailId: existing.id };

    let email;
    try {
        email = await prisma.jobEmail.create({
            data: {
                userId,
                messageId: parsed.messageId,
                fromEmail: parsed.fromEmail,
                fromName: parsed.fromName,
                subject: parsed.subject,
                receivedAt: parsed.receivedAt,
                textBody: parsed.text,
            },
            select: { id: true },
        });
    } catch (error) {
        // A concurrent re-delivery won the insert.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const row = await prisma.jobEmail.findUniqueOrThrow({ where: { userId_messageId: { userId, messageId: parsed.messageId } }, select: { id: true } });
            return { status: 'duplicate', userId, emailId: row.id };
        }
        throw error;
    }
    await prisma.emailInbox.update({ where: { userId }, data: { lastReceivedAt: new Date() } });
    await track(userId, 'job_email_received', { feature: 'job_journey' });
    return { status: 'stored', userId, emailId: email.id };
}

// ───────────────────────────────────────────────────────────── filing

async function candidatesFor(userId: string): Promise<Candidate[]> {
    const rows = await prisma.applicationWorkspace.findMany({
        where: { userId, applicationStatus: { not: ApplicationStatus.archived } },
        orderBy: { updatedAt: 'desc' },
        take: 80,
        select: { id: true, companyName: true, roleTitle: true, applicationStatus: true, emails: { select: { fromEmail: true }, take: 20 } },
    });
    return rows.map((row) => ({
        workspaceId: row.id,
        company: row.companyName,
        role: row.roleTitle,
        status: row.applicationStatus,
        knownDomains: [...new Set(row.emails.map((e) => senderDomain(e.fromEmail)).filter((d): d is string => !!d && !GENERIC_DOMAINS.has(d)))],
    }));
}

export type FileOutcome = {
    kind: JobEmailKind;
    workspaceId: string | null;
    moved: { from: ApplicationStatus; to: ApplicationStatus } | null;
};

/**
 * Classify a stored email, link it, and move its job forward when the email
 * is evidence of a step. The move is conditional on the status the decision
 * was made from, so a concurrent change by the user wins.
 */
export async function fileEmail(emailId: string): Promise<Result<FileOutcome>> {
    const email = await prisma.jobEmail.findUnique({ where: { id: emailId } });
    if (!email) return err('Email not found', 'not_found');
    if (email.status === JobEmailStatus.processed && email.kind) {
        return ok({ kind: email.kind, workspaceId: email.workspaceId, moved: null });
    }

    let classification;
    try {
        classification = await classifyJobEmail({
            userId: email.userId,
            email: { fromEmail: email.fromEmail, fromName: email.fromName, subject: email.subject, text: email.textBody },
            candidates: await candidatesFor(email.userId),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : 'classification failed';
        await prisma.jobEmail.update({ where: { id: emailId }, data: { status: JobEmailStatus.failed, error: message } });
        return err('Could not read that email. It will be retried.', 'classify_failed');
    }

    const kind = classification.kind;
    let moved: FileOutcome['moved'] = null;
    const workspace = classification.workspaceId
        ? await prisma.applicationWorkspace.findFirst({ where: { id: classification.workspaceId, userId: email.userId }, select: { id: true, applicationStatus: true } })
        : null;

    await prisma.$transaction(async (tx) => {
        await tx.jobEmail.update({
            where: { id: emailId },
            data: {
                status: kind === 'not_job' ? JobEmailStatus.ignored : JobEmailStatus.processed,
                kind,
                summary: classification.summary || null,
                company: classification.company,
                role: classification.role,
                workspaceId: workspace?.id ?? null,
                error: null,
            },
        });
        if (!workspace) return;
        await tx.applicationEvent.upsert({
            where: { workspaceId_kind_refId: { workspaceId: workspace.id, kind: ApplicationEventKind.email, refId: emailId } },
            create: {
                userId: email.userId,
                workspaceId: workspace.id,
                kind: ApplicationEventKind.email,
                occurredAt: email.receivedAt,
                title: `${KIND_LABEL[kind]}: ${email.subject}`.slice(0, 300),
                detail: classification.summary || null,
                source: 'email',
                refId: emailId,
            },
            update: {},
        });
        const next = nextStatusFor(kind, workspace.applicationStatus);
        if (!next) return;
        const changed = await tx.applicationWorkspace.updateMany({
            where: { id: workspace.id, applicationStatus: workspace.applicationStatus },
            data: { applicationStatus: next },
        });
        if (changed.count !== 1) return;
        moved = { from: workspace.applicationStatus, to: next };
        await tx.jobEmail.update({ where: { id: emailId }, data: { previousStatus: workspace.applicationStatus, appliedStatus: next } });
        await tx.applicationEvent.create({
            data: {
                userId: email.userId,
                workspaceId: workspace.id,
                kind: ApplicationEventKind.status_change,
                occurredAt: email.receivedAt,
                title: `Moved to ${STATUS_LABEL[next]}`,
                detail: `From an email: ${email.subject}`.slice(0, 300),
                source: 'email',
                refId: `email:${emailId}`,
                fromStatus: workspace.applicationStatus,
                toStatus: next,
            },
        });
    });

    if (moved) await track(email.userId, 'job_status_from_email', { feature: 'job_journey', kind, ...(moved as object) });
    if (kind === 'interview_request' || kind === 'offer' || kind === 'assessment') {
        const what = kind === 'offer' ? 'An offer' : kind === 'assessment' ? 'An assessment' : 'An interview request';
        await notifyTelegram(email.userId, `${what}${email.fromName ? ` from ${email.fromName}` : ''}: ${email.subject}\n\n${classification.summary}\n\nDraft a reply: ${appUrl()}/scout?tab=email`);
    }
    return ok({ kind, workspaceId: workspace?.id ?? null, moved });
}

/** Re-file emails a crash or a model error left behind. Called by the daily job. */
export async function refileStuck(limit = 100): Promise<number> {
    const stuck = await prisma.jobEmail.findMany({
        where: {
            OR: [
                { status: JobEmailStatus.pending, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
                { status: JobEmailStatus.failed, updatedAt: { lt: new Date(Date.now() - 60 * 60_000) } },
            ],
        },
        take: limit,
        select: { id: true },
    });
    let filed = 0;
    for (const row of stuck) {
        const result = await fileEmail(row.id);
        if (result.success) filed += 1;
    }
    return filed;
}

// ───────────────────────────────────────────────────────────── the user's actions

export type JobEmailView = {
    id: string;
    fromEmail: string;
    fromName: string | null;
    subject: string;
    receivedAt: string;
    status: JobEmailStatus;
    kind: JobEmailKind | null;
    kindLabel: string | null;
    summary: string | null;
    company: string | null;
    role: string | null;
    job: { workspaceId: string; company: string | null; role: string | null; status: ApplicationStatus; runId: string | null } | null;
    moved: { from: ApplicationStatus; to: ApplicationStatus } | null;
    draft: { subject: string; body: string; composeUrl: string } | null;
    handled: boolean;
};

const emailSelect = {
    id: true, fromEmail: true, fromName: true, subject: true, receivedAt: true, status: true, kind: true, summary: true,
    company: true, role: true, previousStatus: true, appliedStatus: true, draftSubject: true, draftBody: true, handledAt: true,
    workspace: { select: { id: true, companyName: true, roleTitle: true, applicationStatus: true, scoutRunId: true } },
} satisfies Prisma.JobEmailSelect;

type EmailRow = Prisma.JobEmailGetPayload<{ select: typeof emailSelect }>;

function toView(row: EmailRow): JobEmailView {
    return {
        id: row.id,
        fromEmail: row.fromEmail,
        fromName: row.fromName,
        subject: row.subject,
        receivedAt: row.receivedAt.toISOString(),
        status: row.status,
        kind: row.kind,
        kindLabel: row.kind ? KIND_LABEL[row.kind] : null,
        summary: row.summary,
        company: row.company,
        role: row.role,
        job: row.workspace
            ? { workspaceId: row.workspace.id, company: row.workspace.companyName, role: row.workspace.roleTitle, status: row.workspace.applicationStatus, runId: row.workspace.scoutRunId }
            : null,
        moved: row.previousStatus && row.appliedStatus ? { from: row.previousStatus, to: row.appliedStatus } : null,
        draft: row.draftSubject && row.draftBody
            ? { subject: row.draftSubject, body: row.draftBody, composeUrl: gmailComposeUrl({ to: row.fromEmail, subject: row.draftSubject, body: row.draftBody }) }
            : null,
        handled: !!row.handledAt,
    };
}

export async function listJobEmails(userId: string, opts: { includeIgnored?: boolean; limit?: number } = {}): Promise<JobEmailView[]> {
    const rows = await prisma.jobEmail.findMany({
        where: { userId, ...(opts.includeIgnored ? {} : { status: { not: JobEmailStatus.ignored } }) },
        orderBy: { receivedAt: 'desc' },
        take: Math.min(opts.limit ?? 100, 200),
        select: emailSelect,
    });
    return rows.map(toView);
}

export async function unhandledEmailCount(userId: string): Promise<number> {
    return prisma.jobEmail.count({
        where: { userId, status: JobEmailStatus.processed, handledAt: null, kind: { in: ['recruiter_outreach', 'interview_request', 'scheduling', 'assessment', 'offer', 'other_job'] } },
    });
}

async function ownedEmail(userId: string, emailId: string) {
    return prisma.jobEmail.findFirst({ where: { id: emailId, userId } });
}

/** Put the job back where it was before this email moved it, if nothing moved it since. */
export async function undoEmailMove(userId: string, emailId: string): Promise<Result<JobEmailView>> {
    const email = await ownedEmail(userId, emailId);
    if (!email) return err('Email not found', 'not_found');
    if (!email.workspaceId || !email.previousStatus || !email.appliedStatus) return err('This email did not move a job', 'invalid_input');
    const { workspaceId, previousStatus, appliedStatus } = email;
    const done = await prisma.$transaction(async (tx) => {
        const changed = await tx.applicationWorkspace.updateMany({
            where: { id: workspaceId, userId, applicationStatus: appliedStatus },
            data: { applicationStatus: previousStatus },
        });
        if (changed.count !== 1) return false;
        await tx.jobEmail.update({ where: { id: emailId }, data: { previousStatus: null, appliedStatus: null } });
        await tx.applicationEvent.create({
            data: {
                userId, workspaceId, kind: ApplicationEventKind.status_change, occurredAt: new Date(),
                title: `Moved back to ${STATUS_LABEL[previousStatus]}`, detail: 'Undone by you', source: 'user',
                refId: `undo:${emailId}`, fromStatus: appliedStatus, toStatus: previousStatus,
            },
        });
        return true;
    });
    if (!done) return err('The job has moved since; change its status from the job instead.', 'conflict');
    const row = await prisma.jobEmail.findUniqueOrThrow({ where: { id: emailId }, select: emailSelect });
    return ok(toView(row));
}

/** File an email against a different job, or none. Status is not touched: that is the user's call. */
export async function linkEmail(userId: string, emailId: string, workspaceId: string | null): Promise<Result<JobEmailView>> {
    const email = await ownedEmail(userId, emailId);
    if (!email) return err('Email not found', 'not_found');
    if (workspaceId) {
        const owned = await prisma.applicationWorkspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
        if (!owned) return err('That job is not in your tracker', 'not_found');
    }
    await prisma.$transaction(async (tx) => {
        if (email.workspaceId && email.workspaceId !== workspaceId) {
            await tx.applicationEvent.deleteMany({ where: { workspaceId: email.workspaceId, kind: ApplicationEventKind.email, refId: emailId } });
        }
        await tx.jobEmail.update({ where: { id: emailId }, data: { workspaceId, status: JobEmailStatus.processed } });
        if (workspaceId) {
            await tx.applicationEvent.upsert({
                where: { workspaceId_kind_refId: { workspaceId, kind: ApplicationEventKind.email, refId: emailId } },
                create: {
                    userId, workspaceId, kind: ApplicationEventKind.email, occurredAt: email.receivedAt,
                    title: `${email.kind ? KIND_LABEL[email.kind] : 'Email'}: ${email.subject}`.slice(0, 300),
                    detail: email.summary, source: 'email', refId: emailId,
                },
                update: {},
            });
        }
    });
    const row = await prisma.jobEmail.findUniqueOrThrow({ where: { id: emailId }, select: emailSelect });
    return ok(toView(row));
}

/** A recruiter wrote first: the job did not exist yet. */
export async function createJobFromEmail(userId: string, emailId: string): Promise<Result<JobEmailView>> {
    const email = await ownedEmail(userId, emailId);
    if (!email) return err('Email not found', 'not_found');
    if (email.workspaceId) return err('This email is already filed against a job', 'invalid_input');
    const company = email.company ?? (email.fromName && !GENERIC_DOMAINS.has(senderDomain(email.fromEmail) ?? '') ? senderDomain(email.fromEmail)?.split('.')[0] ?? null : null);
    const workspace = await prisma.applicationWorkspace.upsert({
        where: { userId_sourceUrl: { userId, sourceUrl: `email:${email.messageId}`.slice(0, 500) } },
        create: {
            userId,
            sourceUrl: `email:${email.messageId}`.slice(0, 500),
            sourcePlatform: 'email',
            companyName: company,
            roleTitle: email.role,
            applicationStatus: email.kind === 'interview_request' || email.kind === 'scheduling' ? ApplicationStatus.interview : ApplicationStatus.discovered,
        },
        update: {},
        select: { id: true },
    });
    return linkEmail(userId, emailId, workspace.id);
}

export async function setEmailHandled(userId: string, emailId: string, handled: boolean): Promise<Result<void>> {
    const changed = await prisma.jobEmail.updateMany({ where: { id: emailId, userId }, data: { handledAt: handled ? new Date() : null } });
    return changed.count ? ok(undefined) : err('Email not found', 'not_found');
}

export async function ignoreEmail(userId: string, emailId: string): Promise<Result<void>> {
    const changed = await prisma.jobEmail.updateMany({ where: { id: emailId, userId }, data: { status: JobEmailStatus.ignored } });
    return changed.count ? ok(undefined) : err('Email not found', 'not_found');
}

async function firstName(userId: string): Promise<string> {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { fullName: true } });
    return profile?.fullName?.trim().split(/\s+/)[0] || 'Me';
}

/** Metering is the caller's (the server action gates `cover_letter` once). */
export async function draftReplyFor(userId: string, emailId: string, intent?: string): Promise<Result<JobEmailView>> {
    const email = await prisma.jobEmail.findFirst({ where: { id: emailId, userId }, include: { workspace: { select: { companyName: true, roleTitle: true } } } });
    if (!email) return err('Email not found', 'not_found');
    const draft: Draft = await draftReply({
        userId,
        firstName: await firstName(userId),
        email: { fromName: email.fromName, fromEmail: email.fromEmail, subject: email.subject, text: email.textBody },
        job: email.workspace ? { company: email.workspace.companyName, role: email.workspace.roleTitle } : email.company ? { company: email.company, role: email.role } : null,
        intent: intent?.trim() || undefined,
    });
    await prisma.jobEmail.update({ where: { id: emailId }, data: { draftSubject: draft.subject, draftBody: draft.body, draftedAt: new Date() } });
    await track(userId, 'job_email_drafted', { feature: 'job_journey', kind: email.kind });
    const row = await prisma.jobEmail.findUniqueOrThrow({ where: { id: emailId }, select: emailSelect });
    return ok(toView(row));
}

// ───────────────────────────────────────────────────────────── follow-ups

/** An application this quiet for this long gets a follow-up nudge. */
export const QUIET_DAYS = 7;
const FOLLOW_UP_STATUSES: ApplicationStatus[] = [ApplicationStatus.submitted, ApplicationStatus.applied, ApplicationStatus.in_review];

export type QuietJob = { workspaceId: string; company: string | null; role: string | null; quietSince: Date };

/** Applied-to jobs with nothing from the employer for QUIET_DAYS, not nudged in the last QUIET_DAYS. */
export async function quietApplications(userId: string, now: Date = new Date()): Promise<QuietJob[]> {
    const cutoff = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
    const rows = await prisma.applicationWorkspace.findMany({
        where: { userId, applicationStatus: { in: FOLLOW_UP_STATUSES } },
        select: {
            id: true, companyName: true, roleTitle: true, updatedAt: true, createdAt: true,
            events: { orderBy: { occurredAt: 'desc' }, take: 20, select: { kind: true, occurredAt: true } },
        },
        take: 200,
    });
    const quiet: QuietJob[] = [];
    for (const row of rows) {
        const nudged = row.events.some((event) => event.kind === ApplicationEventKind.follow_up_due && event.occurredAt > cutoff);
        if (nudged) continue;
        const activity = row.events.filter((event) => event.kind !== ApplicationEventKind.follow_up_due).map((event) => event.occurredAt.getTime());
        const last = activity.length ? Math.max(...activity) : row.updatedAt.getTime();
        if (last <= cutoff.getTime()) quiet.push({ workspaceId: row.id, company: row.companyName, role: row.roleTitle, quietSince: new Date(last) });
    }
    return quiet;
}

/** Record the nudge on each quiet job's timeline. Idempotent per job per week. */
export async function recordFollowUps(userId: string, now: Date = new Date()): Promise<QuietJob[]> {
    const quiet = await quietApplications(userId, now);
    const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * 86_400_000))}`;
    const created: QuietJob[] = [];
    for (const job of quiet) {
        const days = Math.round((now.getTime() - job.quietSince.getTime()) / 86_400_000);
        try {
            await prisma.applicationEvent.create({
                data: {
                    userId, workspaceId: job.workspaceId, kind: ApplicationEventKind.follow_up_due, occurredAt: now,
                    title: 'Time to follow up', detail: `No reply in ${days} days.`, source: 'system', refId: `followup:${week}`,
                },
            });
            created.push(job);
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
    }
    if (created.length) await track(userId, 'follow_up_due', { feature: 'job_journey', count: created.length });
    return created;
}

/** Metering is the caller's. `to` is the last real person who wrote about this job, if any. */
export async function draftFollowUpFor(userId: string, workspaceId: string): Promise<Result<{ subject: string; body: string; to: string; composeUrl: string }>> {
    const job = await prisma.applicationWorkspace.findFirst({
        where: { id: workspaceId, userId },
        select: {
            companyName: true, roleTitle: true, createdAt: true,
            emails: { orderBy: { receivedAt: 'desc' }, take: 10, select: { fromEmail: true, fromName: true } },
            events: { where: { kind: ApplicationEventKind.status_change, toStatus: ApplicationStatus.applied }, orderBy: { occurredAt: 'asc' }, take: 1, select: { occurredAt: true } },
        },
    });
    if (!job) return err('That job is not in your tracker', 'not_found');
    // A no-reply ATS address is not someone to follow up with.
    const contact = job.emails.find((e) => !/no-?reply|do-?not-?reply|notifications?@/i.test(e.fromEmail) && !GENERIC_DOMAINS.has(senderDomain(e.fromEmail) ?? '')) ?? null;
    const draft = await draftFollowUp({
        userId,
        firstName: await firstName(userId),
        job: { company: job.companyName, role: job.roleTitle },
        appliedOn: job.events[0]?.occurredAt ?? null,
        contactName: contact?.fromName ?? null,
    });
    const to = contact?.fromEmail ?? '';
    return ok({ ...draft, to, composeUrl: gmailComposeUrl({ to, subject: draft.subject, body: draft.body }) });
}

// ───────────────────────────────────────────────────────────── the timeline

export type JourneyEvent = {
    id: string;
    kind: ApplicationEventKind;
    occurredAt: string;
    title: string;
    detail: string | null;
    source: string;
    refId: string | null;
};

export async function getJourney(userId: string, workspaceId: string): Promise<Result<{ events: JourneyEvent[]; emails: JobEmailView[] }>> {
    const owned = await prisma.applicationWorkspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
    if (!owned) return err('That job is not in your tracker', 'not_found');
    const [events, emails] = await Promise.all([
        prisma.applicationEvent.findMany({ where: { workspaceId }, orderBy: { occurredAt: 'desc' }, take: 200 }),
        prisma.jobEmail.findMany({ where: { workspaceId, userId }, orderBy: { receivedAt: 'desc' }, take: 50, select: emailSelect }),
    ]);
    return ok({
        events: events.map((e) => ({ id: e.id, kind: e.kind, occurredAt: e.occurredAt.toISOString(), title: e.title, detail: e.detail, source: e.source, refId: e.refId })),
        emails: emails.map(toView),
    });
}

/** Called wherever the user moves a job, so the timeline holds every step. */
export async function recordStatusChange(params: { userId: string; workspaceId: string; from: ApplicationStatus; to: ApplicationStatus; source: string }): Promise<void> {
    if (params.from === params.to) return;
    await prisma.applicationEvent.create({
        data: {
            userId: params.userId, workspaceId: params.workspaceId, kind: ApplicationEventKind.status_change, occurredAt: new Date(),
            title: `Moved to ${STATUS_LABEL[params.to]}`, source: params.source, fromStatus: params.from, toStatus: params.to,
        },
    }).catch((error: unknown) => console.warn('[journey] status event not recorded', String(error)));
}

// ───────────────────────────────────────────────────────────── channels

function appUrl(): string {
    return config.app.url.replace(/\/$/, '');
}

/** Best effort: the record is the source of truth, a missed alert is not data loss. */
export async function notifyTelegram(userId: string, text: string): Promise<void> {
    try {
        const identity = await prisma.channelIdentity.findFirst({ where: { userId, channel: Channel.telegram, verified: true }, select: { externalId: true } });
        if (!identity) return;
        await sendTelegramMessageDetailed({ chatId: identity.externalId, text: escapeTelegramHtml(text) });
    } catch (error) {
        console.warn('[journey] telegram alert failed', { userId, error: String(error) });
    }
}
