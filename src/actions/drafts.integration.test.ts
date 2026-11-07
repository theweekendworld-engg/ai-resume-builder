/**
 * Apply-by-email on the web (QA 2026-11-07, finding 7): the Telegram path's
 * versioned drafts behind the web job page's buttons. Against the local
 * database, with Clerk mocked and the model scripted.
 *
 * What is proven: the To is the posting's own address (code-read); v1 is made
 * once per job and a second click does not charge again; Shorter and a typed
 * instruction make v2 and v3 in one chain; compose links are Gmail and
 * mailto, prefilled; "opened" flips once; another user's draft is out of
 * reach; and the tailored resume's PDF is offered for attaching.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { createOrGetRun } from '@/lib/agent/run';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';
import { prisma } from '@/lib/prisma';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';

const clerk = installClerkMock();
const drafts = await import('@/actions/drafts');

const users: string[] = [];
let replies: { subject: string | null; body: string }[] = [];

beforeAll(() => {
    structuredTesting.setUsageLogger(async () => undefined);
    structuredTesting.setBudgetGuard(async () => undefined);
    structuredTesting.setObjectRunner(async () => {
        const reply = replies.length > 1 ? replies.shift()! : replies[0];
        if (!reply) throw new Error('no scripted reply');
        return { object: reply, inputTokens: 100, outputTokens: 50 };
    });
});

afterEach(() => {
    replies = [];
    clerk.signOut();
});

afterAll(async () => {
    structuredTesting.reset();
    for (const id of users) {
        await prisma.messageDraft.deleteMany({ where: { userId: id } });
        await prisma.generatedPdf.deleteMany({ where: { userId: id } });
        await prisma.resume.deleteMany({ where: { userId: id } });
        await prisma.applicationWorkspace.deleteMany({ where: { userId: id } });
        await prisma.agentRun.deleteMany({ where: { userId: id } });
        await prisma.userProfile.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

const POST = `Forward Deployed AI Engineer (#C3) | Claude
Remote, DMV preferred | $90/hr or $190K salary
jobs@iserveworld.com | chris.d@iserveworld.com
Build and deploy client-facing AI agents using Claude, MCP, RAG, and A2A or multi-agent patterns.`;

async function seed(options: { text?: string } = {}) {
    const userId = newTestUserId('apply-web');
    users.push(userId);
    await prisma.userProfile.create({ data: { userId, fullName: 'Jai Shankar' } });
    await prisma.userExperience.create({
        data: { userId, company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', current: true, highlights: ['Built voice AI agents with MCP tools'] },
    });
    const text = options.text ?? POST;
    const { run } = await createOrGetRun({ userId, agent: 'scout', inputKey: `k-${Math.random()}`, input: { text, source: 'dashboard' } });
    const at = new Date().toISOString();
    await prisma.agentRun.update({
        where: { id: run.id },
        data: {
            kind: 'job_posting',
            status: 'succeeded',
            result: {
                ingest: {
                    status: 'ok', sources: [], finishedAt: at,
                    data: {
                        sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: 'Forward Deployed AI Engineer', author: null, authorUrl: null,
                        companyName: null, location: null, postedAt: null, applicantsText: null, text, truncated: false,
                    },
                },
            },
        },
    });
    const workspace = await prisma.applicationWorkspace.create({
        data: { userId, sourceUrl: `https://example.com/jobs/${run.id}`, scoutRunId: run.id, companyName: 'iServeWorld', roleTitle: 'Forward Deployed AI Engineer' },
    });
    clerk.signIn(userId);
    return { userId, runId: run.id, workspaceId: workspace.id };
}

const V1 = { subject: 'Application: Forward Deployed AI Engineer', body: 'Hi,\n\nI build voice AI agents with MCP tools at Plivo and would like to be considered for the Forward Deployed AI Engineer role. My resume is attached.\n\nThanks,\nJai' };
const V2 = { subject: 'Application: Forward Deployed AI Engineer', body: 'Hi,\n\nI build voice AI agents with MCP tools at Plivo. Resume attached.\n\nJai' };
const V3 = { subject: 'Application: Forward Deployed AI Engineer', body: 'Hi,\n\nI build voice AI agents with MCP tools at Plivo, so client-facing agent work is familiar. Resume attached.\n\nJai' };

describe('apply by email from the web job page', () => {
    test('signed out is refused before anything is read', async () => {
        const result = await drafts.getApplyEmailState('anything');
        expect(result).toMatchObject({ success: false, code: 'unauthenticated' });
    });

    test('the state before a draft: the posting\'s addresses, best first, and no versions', async () => {
        const { runId } = await seed();
        const state = await drafts.getApplyEmailState(runId);
        if (!state.success) throw new Error(state.error);
        expect(state.data.applyEmails).toEqual(['jobs@iserveworld.com', 'chris.d@iserveworld.com']);
        expect(state.data.versions).toEqual([]);
        expect(state.data.attachment).toBeNull();
    });

    test('v1 goes To the posting\'s address with compose links; a second click returns it, not a new charge', async () => {
        const { userId, runId } = await seed();
        replies = [V1];
        const started = await drafts.startApplyEmail({ runId });
        if (!started.success) throw new Error(started.error);
        const [v1] = started.data.versions;
        expect(v1).toMatchObject({ version: 1, toEmail: 'jobs@iserveworld.com', subject: V1.subject, body: V1.body, format: 'email' });
        expect(v1.links.gmail).toStartWith('https://mail.google.com/mail/?view=cm&fs=1&to=jobs%40iserveworld.com&su=');
        expect(v1.links.mailto).toStartWith('mailto:jobs@iserveworld.com?subject=');

        const again = await drafts.startApplyEmail({ runId });
        if (!again.success) throw new Error(again.error);
        expect(again.data.versions.map((v) => v.id)).toEqual([v1.id]);
        expect(await prisma.messageDraft.count({ where: { userId, runId } })).toBe(1);
    });

    test('Shorter, then the user\'s own words: v2 and v3 in one chain, each saying how it came to be', async () => {
        const { runId } = await seed();
        replies = [V1];
        const started = await drafts.startApplyEmail({ runId });
        if (!started.success) throw new Error(started.error);

        replies = [V2];
        const shorter = await drafts.reviseApplyEmail({ draftId: started.data.versions[0].id, revision: 'shorter' });
        if (!shorter.success) throw new Error(shorter.error);
        replies = [V3];
        const custom = await drafts.reviseApplyEmail({ draftId: shorter.data.versions[1].id, instruction: 'mention client-facing agent work' });
        if (!custom.success) throw new Error(custom.error);

        expect(custom.data.versions.map((v) => v.version)).toEqual([1, 2, 3]);
        expect(custom.data.versions[1].instruction).toBe(REVISION_INSTRUCTIONS.shorter);
        expect(custom.data.versions[2].instruction).toBe('mention client-facing agent work');
        expect(custom.data.versions[2].toEmail).toBe('jobs@iserveworld.com');
        expect(custom.data.versions[2].links.gmail).toContain(encodeURIComponent('client-facing agent work'));
    });

    test('a revision needs exactly one of a button or an instruction', async () => {
        const { runId } = await seed();
        replies = [V1];
        const started = await drafts.startApplyEmail({ runId });
        if (!started.success) throw new Error(started.error);
        const neither = await drafts.reviseApplyEmail({ draftId: started.data.versions[0].id });
        expect(neither).toMatchObject({ success: false, code: 'invalid_input' });
    });

    test('opened flips once; another user cannot open, revise or read it', async () => {
        const { runId } = await seed();
        replies = [V1];
        const started = await drafts.startApplyEmail({ runId });
        if (!started.success) throw new Error(started.error);
        const draftId = started.data.versions[0].id;

        expect(await drafts.markApplyEmailOpened({ draftId, via: 'gmail' })).toEqual({ success: true, data: { flipped: true } });
        expect(await drafts.markApplyEmailOpened({ draftId, via: 'mail' })).toEqual({ success: true, data: { flipped: false } });

        await seed();
        expect(await drafts.markApplyEmailOpened({ draftId, via: 'gmail' })).toMatchObject({ success: false, code: 'not_found' });
        replies = [V2];
        expect((await drafts.reviseApplyEmail({ draftId, revision: 'shorter' })).success).toBe(false);
        expect(await drafts.getApplyEmailState(runId)).toMatchObject({ success: false, code: 'not_found' });
    });

    test('no address in the posting: no draft, and the reason', async () => {
        const { runId } = await seed({ text: `${'We are hiring a backend engineer to build payment rails in Go. '.repeat(4)}Apply on our careers page.` });
        const result = await drafts.startApplyEmail({ runId });
        expect(result).toMatchObject({ success: false, code: 'no_apply_email' });
    });

    test('the tailored resume is offered for attaching: its PDF when one exists, else the editor', async () => {
        const { userId, runId, workspaceId } = await seed();
        const base = await prisma.resume.create({ data: { userId, title: 'My Resume', content: {} } });
        const copy = await prisma.resume.create({ data: { userId, title: 'Forward Deployed AI Engineer — iServeWorld', content: {}, baseResumeId: base.id, workspaceId } });
        await prisma.applicationWorkspace.update({ where: { id: workspaceId }, data: { selectedResumeId: copy.id } });

        const noPdf = await drafts.getApplyEmailState(runId);
        if (!noPdf.success) throw new Error(noPdf.error);
        expect(noPdf.data.attachment).toEqual({ resumeId: copy.id, title: copy.title, pdfUrl: null, editorUrl: `/editor/${copy.id}` });

        // An expired PDF is not offered; the live one is.
        await prisma.generatedPdf.create({ data: { userId, resumeId: copy.id, blobKey: 'old', blobUrl: 'https://blob.test/old.pdf', fileSizeBytes: 10, expiresAt: new Date(Date.now() - 86_400_000) } });
        const pdf = await prisma.generatedPdf.create({ data: { userId, resumeId: copy.id, blobKey: 'k', blobUrl: 'https://blob.test/k.pdf', fileSizeBytes: 10 } });
        const withPdf = await drafts.getApplyEmailState(runId);
        if (!withPdf.success) throw new Error(withPdf.error);
        expect(withPdf.data.attachment?.pdfUrl).toBe(`/api/pdfs/${pdf.id}`);
    });
});
