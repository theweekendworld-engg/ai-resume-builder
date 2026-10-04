/**
 * The job-search journey end to end, against the local Postgres. The model
 * and Google are replaced at their seams; everything else is real: the
 * inbound parse, the inbox lookup, idempotency, filing, forward-only moves,
 * undo, the timeline, follow-ups and the calendar sync.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ApplicationStatus, Channel } from '@prisma/client';

import { __testing as aiTesting } from '@/lib/ai/structured';
import { encryptToken } from '@/lib/crypto/tokens';
import { restoreFlags, setFlagForTest, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';
import { InboundPayloadSchema } from '@/lib/journey/inbound';
import { prisma } from '@/lib/prisma';
import { __testing as calendarTesting, syncCalendar } from './calendar';
import { fileEmail, getJourney, getOrCreateInbox, linkEmail, recordFollowUps, receiveInbound, undoEmailMove } from './journey';

const RUN = `itest-journey-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USER = `${RUN}-user`;
const DOMAIN = 'in.patronus.test';
let flags: FlagSnapshot;
let token = '';
let acmeId = '';
let globexId = '';
let replies: Array<Record<string, unknown>> = [];

function modelSays(...objects: Array<Record<string, unknown>>) {
    replies = [...objects];
    aiTesting.setObjectRunner(async () => ({ object: replies.shift() ?? {}, inputTokens: 1, outputTokens: 1 }));
}

const classified = (over: Record<string, unknown>) => ({ kind: 'other_job', jobIndex: 0, summary: '', company: '', role: '', ...over });

let seq = 0;
function mail(over: Record<string, unknown> = {}) {
    seq += 1;
    return InboundPayloadSchema.parse({
        From: 'Priya Rao <priya@acme.com>',
        FromFull: { Email: 'priya@acme.com', Name: 'Priya Rao' },
        OriginalRecipient: `jobs+${token}@${DOMAIN}`,
        Subject: 'Next steps',
        MessageID: `<${RUN}-${seq}@acme.com>`,
        Date: new Date().toUTCString(),
        TextBody: 'Hi, we would like to schedule a 45 minute interview with the team.',
        ...over,
    });
}

async function status(id: string) {
    return (await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id }, select: { applicationStatus: true } })).applicationStatus;
}

beforeAll(async () => {
    process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    flags = await snapshotFlags();
    await setFlagForTest('job_journey', { enabled: true, allowUserIds: [USER] });
    token = (await getOrCreateInbox(USER)).address!.match(/jobs\+([a-z0-9]+)@/)![1];
});

beforeEach(async () => {
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setBudgetGuard(async () => {});
    await prisma.jobEmail.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    acmeId = (await prisma.applicationWorkspace.create({
        data: { userId: USER, sourceUrl: `https://jobs.acme.com/${RUN}`, companyName: 'Acme', roleTitle: 'Senior Backend Engineer', applicationStatus: ApplicationStatus.applied },
    })).id;
    globexId = (await prisma.applicationWorkspace.create({
        data: { userId: USER, sourceUrl: `https://globex.com/${RUN}`, companyName: 'Globex', roleTitle: 'Platform Engineer', applicationStatus: ApplicationStatus.analyzed },
    })).id;
});

afterEach(() => {
    aiTesting.reset();
    calendarTesting.reset();
});

afterAll(async () => {
    await restoreFlags(flags);
    await prisma.jobEmail.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
    await prisma.googleConnection.deleteMany({ where: { userId: USER } });
    await prisma.emailInbox.deleteMany({ where: { userId: USER } });
});

describe('receiving', () => {
    test('a message is stored once; a re-delivery is the same row', async () => {
        const payload = mail();
        const first = await receiveInbound(payload);
        const again = await receiveInbound(payload);
        expect(first.status).toBe('stored');
        expect(again.status).toBe('duplicate');
        expect(await prisma.jobEmail.count({ where: { userId: USER } })).toBe(1);
    });

    test('Gmail\'s forwarding confirmation is kept for Settings, not stored as mail', async () => {
        const outcome = await receiveInbound(mail({
            From: 'forwarding-noreply@google.com', FromFull: { Email: 'forwarding-noreply@google.com' },
            Subject: '(#612345789) Gmail Forwarding Confirmation - Receive Mail from jai@gmail.com',
            TextBody: 'https://mail-settings.google.com/mail/vf-abc',
        }));
        expect(outcome.status).toBe('forwarding_confirmation');
        const inbox = await getOrCreateInbox(USER);
        expect(inbox.forwardingCode).toBe('612345789');
        expect(await prisma.jobEmail.count({ where: { userId: USER } })).toBe(0);
    });

    test('an unknown address and a user without the flag store nothing', async () => {
        expect((await receiveInbound(mail({ OriginalRecipient: `jobs+zzzzzzzzzzzzzzzz@${DOMAIN}` }))).status).toBe('unknown_inbox');
        await setFlagForTest('job_journey', { enabled: false });
        try {
            expect((await receiveInbound(mail())).status).toBe('not_enabled');
        } finally {
            await setFlagForTest('job_journey', { enabled: true, allowUserIds: [USER] });
        }
    });
});

describe('filing', () => {
    test('an interview request moves the job forward and lands on its timeline; undo puts it back', async () => {
        const received = await receiveInbound(mail());
        if (received.status !== 'stored') throw new Error(received.status);
        // Acme ranks first: its company is the sender's domain.
        modelSays(classified({ kind: 'interview_request', jobIndex: 1, summary: 'Asks to schedule a 45 minute interview.' }));
        const filed = await fileEmail(received.emailId);
        expect(filed.success && filed.data).toEqual({ kind: 'interview_request', workspaceId: acmeId, moved: { from: 'applied', to: 'interview' } });
        expect(await status(acmeId)).toBe('interview');

        const journey = await getJourney(USER, acmeId);
        const kinds = journey.success ? journey.data.events.map((e) => e.kind).sort() : [];
        expect(kinds).toEqual(['email', 'status_change']);

        const undone = await undoEmailMove(USER, received.emailId);
        expect(undone.success).toBe(true);
        expect(await status(acmeId)).toBe('applied');
    });

    test('never backwards: a late confirmation leaves an interviewing job where it is', async () => {
        await prisma.applicationWorkspace.update({ where: { id: acmeId }, data: { applicationStatus: 'interview' } });
        const received = await receiveInbound(mail({ Subject: 'We received your application' }));
        if (received.status !== 'stored') throw new Error(received.status);
        modelSays(classified({ kind: 'application_received', jobIndex: 1, summary: 'Confirms the application arrived.' }));
        const filed = await fileEmail(received.emailId);
        expect(filed.success && filed.data.moved).toBeNull();
        expect(await status(acmeId)).toBe('interview');
    });

    test('a newsletter is never filed against a job, whatever index the model returns', async () => {
        const received = await receiveInbound(mail({ Subject: 'Top 10 jobs this week' }));
        if (received.status !== 'stored') throw new Error(received.status);
        modelSays(classified({ kind: 'not_job', jobIndex: 1 }));
        const filed = await fileEmail(received.emailId);
        expect(filed.success && filed.data.workspaceId).toBeNull();
        expect((await prisma.jobEmail.findUniqueOrThrow({ where: { id: received.emailId } })).status).toBe('ignored');
    });

    test('a figure the email does not contain is stripped from the summary', async () => {
        const received = await receiveInbound(mail());
        if (received.status !== 'stored') throw new Error(received.status);
        modelSays(
            classified({ kind: 'interview_request', jobIndex: 1, summary: 'Offers 42 LPA for the role.' }),
            classified({ kind: 'interview_request', jobIndex: 1, summary: 'Offers 42 LPA for the role.' }),
        );
        await fileEmail(received.emailId);
        const row = await prisma.jobEmail.findUniqueOrThrow({ where: { id: received.emailId } });
        expect(row.summary ?? '').not.toContain('42');
    });

    test('a model failure leaves the email failed for the daily re-file, and moves nothing', async () => {
        const received = await receiveInbound(mail());
        if (received.status !== 'stored') throw new Error(received.status);
        aiTesting.setObjectRunner(async () => { throw new Error('model down'); });
        const filed = await fileEmail(received.emailId);
        expect(filed.success).toBe(false);
        expect((await prisma.jobEmail.findUniqueOrThrow({ where: { id: received.emailId } })).status).toBe('failed');
        expect(await status(acmeId)).toBe('applied');
    });

    test('filing under another job moves its timeline entry with it', async () => {
        const received = await receiveInbound(mail());
        if (received.status !== 'stored') throw new Error(received.status);
        modelSays(classified({ kind: 'other_job', jobIndex: 1 }));
        await fileEmail(received.emailId);
        await linkEmail(USER, received.emailId, globexId);
        const [acme, globex] = await Promise.all([getJourney(USER, acmeId), getJourney(USER, globexId)]);
        expect(acme.success && acme.data.events.filter((e) => e.kind === 'email')).toHaveLength(0);
        expect(globex.success && globex.data.events.filter((e) => e.kind === 'email')).toHaveLength(1);
    });
});

describe('follow-ups', () => {
    test('a quiet application gets one nudge a week, not one a day', async () => {
        await prisma.applicationWorkspace.update({ where: { id: acmeId }, data: { updatedAt: new Date(Date.now() - 10 * 86_400_000) } });
        // updatedAt is @updatedAt; set it raw so the job reads as quiet.
        await prisma.$executeRaw`UPDATE "ApplicationWorkspace" SET "updatedAt" = now() - interval '10 days' WHERE id = ${acmeId}`;
        const first = await recordFollowUps(USER);
        const second = await recordFollowUps(USER);
        expect(first.map((job) => job.workspaceId)).toEqual([acmeId]);
        expect(second).toHaveLength(0);
    });
});

describe('calendar', () => {
    test('an interview on the calendar lands on the job and moves it; a cancellation removes it', async () => {
        await prisma.googleConnection.upsert({
            where: { userId: USER },
            create: { userId: USER, googleEmail: 'jai@gmail.com', scopes: [], accessTokenEnc: encryptToken('access'), refreshTokenEnc: encryptToken('refresh'), expiresAt: new Date(Date.now() + 3_600_000) },
            update: { accessTokenEnc: encryptToken('access'), expiresAt: new Date(Date.now() + 3_600_000) },
        });
        let status_ = 'confirmed';
        calendarTesting.setFetch((async (url: string | URL | Request) => {
            if (String(url).includes('/calendars/primary/events')) {
                return Response.json({ items: [{ id: 'evt1', status: status_, summary: 'Globex - Technical interview', start: { dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString() } }] });
            }
            return Response.json({});
        }) as typeof fetch);

        const synced = await syncCalendar(USER);
        expect(synced.success && synced.data).toEqual({ scanned: 1, matched: 1, moved: 1 });
        expect(await status(globexId)).toBe('interview');
        // A second sync is a no-op.
        const again = await syncCalendar(USER);
        expect(again.success && again.data.moved).toBe(0);
        expect(await prisma.applicationEvent.count({ where: { workspaceId: globexId, kind: 'interview' } })).toBe(1);

        status_ = 'cancelled';
        await syncCalendar(USER);
        expect(await prisma.applicationEvent.count({ where: { workspaceId: globexId, kind: 'interview' } })).toBe(0);
    });
});

describe('deletion', () => {
    test('deleting an account removes its inbox, emails, timeline and Google tokens', async () => {
        const other = `${RUN}-deleted`;
        const ws = await prisma.applicationWorkspace.create({ data: { userId: other, sourceUrl: `https://x.test/${RUN}`, companyName: 'X' } });
        await prisma.emailInbox.create({ data: { userId: other, token: `del${Date.now()}` } });
        await prisma.jobEmail.create({ data: { userId: other, messageId: 'm1', fromEmail: 'a@x.test', subject: 's', receivedAt: new Date(), textBody: 'private', workspaceId: ws.id } });
        await prisma.applicationEvent.create({ data: { userId: other, workspaceId: ws.id, kind: 'note', occurredAt: new Date(), title: 't', source: 'user' } });
        await prisma.googleConnection.create({ data: { userId: other, googleEmail: 'x@gmail.com', scopes: [], accessTokenEnc: 'v1.a.b.c', expiresAt: new Date() } });
        const { deleteUserData } = await import('./accountDeletion');
        await deleteUserData(other);
        const left = await Promise.all([
            prisma.emailInbox.count({ where: { userId: other } }),
            prisma.jobEmail.count({ where: { userId: other } }),
            prisma.applicationEvent.count({ where: { userId: other } }),
            prisma.googleConnection.count({ where: { userId: other } }),
        ]);
        expect(left).toEqual([0, 0, 0, 0]);
    });
});

void Channel;
