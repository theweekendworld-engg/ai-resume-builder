/**
 * Message drafts end to end against the database, with the model scripted:
 * the first draft through the real metered Scout path, revisions as new
 * versions, ownership in every query, and the numeric guard refusing a
 * revision that reaches for a number no source has.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { WinSensitivity, WinStatus } from '@prisma/client';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { createOrGetRun } from '@/lib/agent/run';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';
import { EMAIL_BODY_MAX_WORDS, wordCount } from '@/lib/scout/outreach';
import { prisma } from '@/lib/prisma';
import { cleanupTestUser, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import { composeLinks, createDraftForRun, getDraft, markDraftOpened, reviseDraft } from './drafts';

const users: string[] = [];
function user(): string {
    const id = newTestUserId('drafts');
    users.push(id);
    return id;
}

type Reply = { subject: string | null; body: string };
let prompts: string[] = [];
let replies: Reply[] = [];

function script(...next: Reply[]) {
    replies = next;
}

beforeAll(() => {
    structuredTesting.setUsageLogger(async () => undefined);
    structuredTesting.setBudgetGuard(async () => undefined);
    structuredTesting.setObjectRunner(async ({ prompt }) => {
        prompts.push(prompt);
        const reply = replies.length > 1 ? replies.shift()! : replies[0];
        if (!reply) throw new Error('no scripted reply');
        return { object: reply, inputTokens: 100, outputTokens: 50 };
    });
});

afterEach(() => {
    prompts = [];
    replies = [];
});

afterAll(async () => {
    structuredTesting.reset();
    for (const id of users) {
        await prisma.messageDraft.deleteMany({ where: { userId: id } });
        await prisma.applicationWorkspace.deleteMany({ where: { userId: id } });
        await prisma.agentRun.deleteMany({ where: { userId: id } });
        await prisma.userEducation.deleteMany({ where: { userId: id } });
        await prisma.userProfile.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

const POST = `Forward Deployed AI Engineer | Claude

We're hiring Forward Deployed Engineers to work with enterprise customers deploying Claude: scope, prototype and ship production agents with their teams. Bengaluru or remote. Strong Python or Go, evals, tool integrations.

Interested? send resumes to jobs@x.com`;

const V1: Reply = {
    subject: 'Forward Deployed AI Engineer application',
    body: 'Hi,\n\nI build Go services for settlement at Razorpay and would like to be considered for the Forward Deployed AI Engineer role. My resume is attached.\n\nThanks,\nJai',
};

/** A user with a record, and a finished job run whose posting names jobs@x.com. */
async function seed(options: { kind?: 'job_posting' | 'hiring_post' | 'knowledge'; storeEmails?: string[] } = {}) {
    const userId = user();
    await prisma.userProfile.create({ data: { userId, fullName: 'Jai Shankar' } });
    await prisma.userExperience.create({
        data: {
            userId, company: 'Razorpay', role: 'Software Engineer', startDate: '2021', current: true,
            highlights: ['Built the settlement service in Go', 'Cut p99 latency by 40% on the payouts API'],
        },
    });
    await prisma.userEducation.create({
        data: { userId, institution: 'IIT Delhi', degree: 'B.Tech', fieldOfStudy: 'Computer Science', startDate: '2014', endDate: '2018' },
    });
    const confidential = await makeWin({ userId, title: 'Negotiated the confidential Visa contract', sensitivity: WinSensitivity.confidential });
    await prisma.win.update({ where: { id: confidential.id }, data: { status: WinStatus.confirmed, confirmedAt: new Date() } });

    const { run } = await createOrGetRun({ userId, agent: 'scout', inputKey: `k-${Math.random()}`, input: { text: POST, source: 'telegram' } });
    const at = new Date().toISOString();
    await prisma.agentRun.update({
        where: { id: run.id },
        data: {
            kind: options.kind ?? 'job_posting',
            status: 'succeeded',
            result: {
                ingest: {
                    status: 'ok', sources: [], finishedAt: at,
                    data: {
                        sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: 'Forward Deployed AI Engineer | Claude',
                        author: null, authorUrl: null, companyName: null, location: null, postedAt: null, applicantsText: null,
                        text: POST, truncated: false,
                    },
                },
                jd: {
                    status: 'ok', sources: [], finishedAt: at,
                    data: {
                        role: 'Forward Deployed AI Engineer', company: 'Anthropic', seniority: 'senior', domain: 'ai', location: 'Bengaluru',
                        workMode: 'remote', employmentType: null, compensationText: null, experienceText: null, applyUrl: null,
                        requirements: [{ id: 'r1', text: 'Strong Python or Go', kind: 'must' }], skills: ['Python', 'Go'], responsibilities: [],
                        // Absent on purpose unless given: an old row, read from the posting text.
                        ...(options.storeEmails ? { applyEmails: options.storeEmails } : {}),
                    },
                },
            },
        },
    });
    const workspace = await prisma.applicationWorkspace.create({
        data: { userId, sourceUrl: `https://example.com/jobs/${run.id}`, scoutRunId: run.id, companyName: 'Anthropic', roleTitle: 'Forward Deployed AI Engineer' },
    });
    return { userId, runId: run.id, workspaceId: workspace.id };
}

describe('createDraftForRun', () => {
    test('an email to the posting\'s address: v1, To from code, workspace found, degree in the prompt', async () => {
        const { userId, runId, workspaceId } = await seed();
        script(V1);
        const created = await createDraftForRun(userId, runId, { target: 'recruiter', format: null });
        if (!created.success) throw new Error(created.error);

        expect(created.data).toMatchObject({
            version: 1, runId, workspaceId, format: 'email', target: 'recruiter',
            toEmail: 'jobs@x.com', subject: V1.subject, body: V1.body,
        });
        // The address is the posting's, steered by code; the degree is evidence; rule 3 holds.
        expect(prompts[0]).toContain('jobs@x.com');
        expect(prompts[0]).toContain('B.Tech in Computer Science, IIT Delhi (2014–2018)');
        expect(prompts[0]).not.toContain('confidential Visa contract');

        const row = await prisma.messageDraft.findUnique({ where: { id: created.data.id } });
        expect(row).toMatchObject({ userId, parentId: null, status: 'draft', instruction: null });
        // The run still records the draft, as the dashboard's draft button does.
        const run = await prisma.agentRun.findUnique({ where: { id: runId } });
        expect(((run?.result as Record<string, unknown>).drafts as unknown[]).length).toBe(1);
    });

    test('null format without an address is a LinkedIn message; a referral email gets no inbox To', async () => {
        const { userId, runId } = await seed({ storeEmails: [] });
        script({ subject: null, body: 'Hi, I build Go services at Razorpay. Would you refer me for the Forward Deployed AI Engineer role?' });
        const message = await createDraftForRun(userId, runId, { target: 'referral', format: null });
        if (!message.success) throw new Error(message.error);
        expect(message.data).toMatchObject({ format: 'linkedin_message', toEmail: null, subject: null });

        const { userId: other, runId: otherRun } = await seed();
        script(V1);
        const referral = await createDraftForRun(other, otherRun, { target: 'referral', format: 'email' });
        if (!referral.success) throw new Error(referral.error);
        expect(referral.data.toEmail).toBeNull();
    });

    test('someone else\'s run, or a run that is not a job, writes nothing', async () => {
        const { runId } = await seed();
        const stranger = user();
        const denied = await createDraftForRun(stranger, runId, { target: 'recruiter', format: 'email' });
        expect(denied).toMatchObject({ success: false, code: 'not_found' });

        const { userId, runId: noteRun } = await seed({ kind: 'knowledge' });
        const notJob = await createDraftForRun(userId, noteRun, { target: 'recruiter', format: 'email' });
        expect(notJob).toMatchObject({ success: false, code: 'not_applicable' });
        expect(await prisma.messageDraft.count({ where: { userId: { in: [stranger, userId] } } })).toBe(0);
    });
});

describe('reviseDraft', () => {
    test('writes v2 then v3, each pointing at its parent, the instruction stored verbatim', async () => {
        const { userId, runId, workspaceId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);

        prompts = [];
        const withDegree = { ...V1, body: V1.body.replace('at Razorpay', 'at Razorpay, after a B.Tech at IIT Delhi,') };
        script(withDegree);
        const v2 = await reviseDraft(userId, v1.data.id, '  add IIT Delhi  ');
        if (!v2.success) throw new Error(v2.error);
        expect(v2.data).toMatchObject({ version: 2, runId, workspaceId, toEmail: 'jobs@x.com', body: withDegree.body, subject: V1.subject });
        expect(await prisma.messageDraft.findUnique({ where: { id: v2.data.id } })).toMatchObject({ parentId: v1.data.id, instruction: 'add IIT Delhi' });
        // The model is shown the version it edits, the instruction, and the evidence.
        expect(prompts[0]).toContain(V1.body);
        expect(prompts[0]).toContain('add IIT Delhi');
        expect(prompts[0]).toContain('IIT Delhi (2014–2018)');
        expect(prompts[0]).not.toContain('confidential Visa contract');

        script({ ...withDegree, body: 'Hi,\n\nI build Go services at Razorpay after a B.Tech at IIT Delhi. My resume is attached for the Forward Deployed AI Engineer role.\n\nJai' });
        const v3 = await reviseDraft(userId, v2.data.id, REVISION_INSTRUCTIONS.shorter);
        if (!v3.success) throw new Error(v3.error);
        expect(v3.data.version).toBe(3);
        expect(await prisma.messageDraft.findUnique({ where: { id: v3.data.id } })).toMatchObject({ parentId: v2.data.id });
        // Every version stays readable.
        expect((await getDraft(userId, v1.data.id))?.body).toBe(V1.body);
    });

    test('a second tap of the same revision on the same version returns that version, free', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);
        script({ ...V1, body: 'Hi,\n\nI build Go services at Razorpay. Resume attached.\n\nJai' });
        const first = await reviseDraft(userId, v1.data.id, REVISION_INSTRUCTIONS.shorter);
        prompts = [];
        const again = await reviseDraft(userId, v1.data.id, REVISION_INSTRUCTIONS.shorter);
        if (!first.success || !again.success) throw new Error('revision failed');
        expect(again.data.id).toBe(first.data.id);
        expect(prompts).toHaveLength(0);
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(2);
    });

    test('a number in the evidence may be used; one in no source is refused and nothing is written', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);

        script({ ...V1, body: 'Hi,\n\nAt Razorpay I cut p99 latency by 40% on the payouts API and built settlement in Go. My resume is attached.\n\nJai' });
        const sourced = await reviseDraft(userId, v1.data.id, REVISION_INSTRUCTIONS.stronger);
        expect(sourced.success).toBe(true);

        // Scripted twice: the guard's own corrective retry gets the same fabrication.
        script({ ...V1, body: 'Hi,\n\nAt Razorpay I cut infrastructure costs by 47% and built settlement in Go. My resume is attached.\n\nJai' });
        const before = await prisma.messageDraft.count({ where: { userId } });
        const refused = await reviseDraft(userId, v1.data.id, 'make me sound stronger');
        expect(refused).toMatchObject({ success: false, code: 'guard_rejected' });
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(before);
    });

    test('the outreach limits hold: an overlong revision is trimmed to the email cap', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);
        const long = `Hi, ${'I build Go services at Razorpay. '.repeat(40)}Jai`;
        script({ subject: V1.subject, body: long });
        prompts = [];
        const revised = await reviseDraft(userId, v1.data.id, 'add more detail about Go');
        if (!revised.success) throw new Error(revised.error);
        expect(wordCount(revised.data.body)).toBeLessThanOrEqual(EMAIL_BODY_MAX_WORDS);
        // One corrective retry for the length, then the code trims.
        expect(prompts).toHaveLength(2);
    });

    test('an address the user types becomes the To', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);
        script(V1);
        const moved = await reviseDraft(userId, v1.data.id, 'send it to Careers@Anthropic.com instead');
        if (!moved.success) throw new Error(moved.error);
        expect(moved.data.toEmail).toBe('careers@anthropic.com');
    });

    test('someone else\'s draft is not found, and is not touched', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);
        const stranger = user();
        prompts = [];
        expect(await reviseDraft(stranger, v1.data.id, 'shorter')).toMatchObject({ success: false, code: 'not_found' });
        expect(await getDraft(stranger, v1.data.id)).toBeNull();
        expect(await markDraftOpened(stranger, v1.data.id)).toBe(false);
        expect(prompts).toHaveLength(0);
        expect(await prisma.messageDraft.count({ where: { userId } })).toBe(1);
    });
});

describe('reads and links', () => {
    test('markDraftOpened flips once; composeLinks prefill the address', async () => {
        const { userId, runId } = await seed();
        script(V1);
        const v1 = await createDraftForRun(userId, runId, { target: 'recruiter', format: 'email' });
        if (!v1.success) throw new Error(v1.error);
        expect(await markDraftOpened(userId, v1.data.id)).toBe(true);
        expect(await markDraftOpened(userId, v1.data.id)).toBe(false);

        const links = composeLinks(v1.data);
        expect(new URL(links.gmail!).searchParams.get('to')).toBe('jobs@x.com');
        expect(links.mailto!.startsWith('mailto:jobs@x.com?subject=')).toBe(true);
        expect(composeLinks({ ...v1.data, format: 'linkedin_note' })).toEqual({ gmail: null, mailto: null });
    });
});
