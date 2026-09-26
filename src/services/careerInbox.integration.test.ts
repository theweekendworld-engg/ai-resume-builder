/**
 * Career inbox — integration tests against the local Postgres.
 *
 * Covers the `track` section (Scout job → ApplicationWorkspace) and the inbox
 * service together, because the promise they make is joint: a job analysed
 * twice is one row, its status only moves forward, and a board built from
 * those rows never shows anyone else's.
 *
 * Isolation: every row is tagged with a unique user id and deleted afterwards.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createOrGetRun } from '@/lib/agent/run';
import { fakeContext, okSection } from '@/lib/scout/fit/testContext.test-utils';
import { trackSection, trackerUrl } from '@/lib/scout/sections/track';
import type { FitData, IngestData, JdData, ScoutSections } from '@/lib/scout/types';
import {
    inboxCounts,
    listChatNotes,
    listCompanies,
    listInsights,
    listJobBoard,
    setJobStatus,
    topFits,
} from './careerInbox';

const RUN = `itest-inbox-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users = new Set<string>();
let counter = 0;

function user(name: string): string {
    const id = `${RUN}-${name}`;
    users.add(id);
    return id;
}

afterAll(async () => {
    const ids = [...users];
    await prisma.applicationWorkspace.deleteMany({ where: { userId: { in: ids } } });
    await prisma.agentRun.deleteMany({ where: { userId: { in: ids } } });
    await prisma.savedInsight.deleteMany({ where: { userId: { in: ids } } });
    await prisma.win.deleteMany({ where: { userId: { in: ids } } });
});

function ingest(overrides: Partial<IngestData> = {}): IngestData {
    return {
        sourceUrl: 'https://www.linkedin.com/jobs/view/4455902670/?trackingId=abc',
        linkKind: 'linkedin_job',
        fetchVia: 'guest_job_api',
        title: 'Software Dev Engineer II',
        author: null,
        authorUrl: null,
        companyName: 'Amazon',
        location: 'Chennai, Tamil Nadu, India',
        postedAt: null,
        applicantsText: null,
        text: 'Build distributed systems. 3+ years of experience.',
        truncated: false,
        ...overrides,
    };
}

function jd(overrides: Partial<JdData> = {}): JdData {
    return {
        role: 'Software Dev Engineer II',
        company: 'Amazon',
        seniority: 'mid',
        domain: 'voice',
        location: 'Chennai, Tamil Nadu, India',
        workMode: 'onsite',
        employmentType: 'Full-time',
        compensationText: null,
        experienceText: '3+ years',
        requirements: [],
        skills: [],
        responsibilities: [],
        applyUrl: null,
        ...overrides,
    };
}

function fit(overrides: Partial<FitData> = {}): FitData {
    return {
        score: 56,
        verdict: 'possible',
        matched: [{ requirementId: 'r1', text: 'Distributed systems', evidence: 'Built a CQRS read path', strength: 'direct' }],
        gaps: [],
        preferenceChecks: [],
        notFitReasons: [],
        summary: 'Possible fit.',
        softRequirements: [],
        ...overrides,
    };
}

/** A real AgentRun (scoutRunId is unique and the board joins on it). */
async function scoutRun(userId: string, sections: ScoutSections, kind = 'job_posting'): Promise<string> {
    counter += 1;
    const { run } = await createOrGetRun({ userId, agent: 'scout', inputKey: `${RUN}-k${counter}`, input: { source: 'dashboard' } });
    await prisma.agentRun.update({
        where: { id: run.id },
        data: { kind, result: sections as unknown as Prisma.InputJsonValue },
    });
    return run.id;
}

/** Run the track section as the pipeline would, for a real run id. */
async function trackJob(userId: string, sections: ScoutSections) {
    const runId = await scoutRun(userId, sections);
    const base = fakeContext({ userId, sections });
    const ctx = { ...base, runId, step: { ...base.step, runId } };
    const outcome = await trackSection(ctx);
    if (outcome.status !== 'ok') throw new Error(`track did not succeed: ${JSON.stringify(outcome)}`);
    return { runId, data: outcome.data };
}

function jobSections(overrides: { ingest?: Partial<IngestData>; jd?: Partial<JdData>; fit?: Partial<FitData> | null } = {}): ScoutSections {
    return {
        ingest: okSection<'ingest'>(ingest(overrides.ingest)),
        jd: okSection<'jd'>(jd(overrides.jd)),
        ...(overrides.fit === null ? {} : { fit: okSection<'fit'>(fit(overrides.fit ?? {})) }),
    };
}

// ─────────────────────────────────────────────────────────────── track

describe('track section', () => {
    test('files a LinkedIn job under its canonical URL, as analyzed, with the fit', async () => {
        const userId = user('create');
        const { runId, data } = await trackJob(userId, jobSections());
        expect(data.created).toBe(true);
        expect(data.status).toBe('analyzed');

        const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: data.workspaceId } });
        expect(row.sourceUrl).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(row.sourcePlatform).toBe('linkedin');
        expect(row.fitScore).toBe(56);
        expect(row.fitVerdict).toBe('possible');
        expect(row.scoutRunId).toBe(runId);
    });

    test('the same job analysed again updates the row instead of adding one, and the newer run wins', async () => {
        const userId = user('twice');
        const first = await trackJob(userId, jobSections());
        const second = await trackJob(userId, jobSections({ fit: { score: 70, verdict: 'strong' } }));

        expect(second.data.created).toBe(false);
        expect(second.data.workspaceId).toBe(first.data.workspaceId);
        expect(await prisma.applicationWorkspace.count({ where: { userId } })).toBe(1);
        const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: first.data.workspaceId } });
        expect(row.scoutRunId).toBe(second.runId);
        expect(row.fitScore).toBe(70);
    });

    test('a job the extension saved under a tracking URL is found by LinkedIn job id', async () => {
        const userId = user('extension');
        const saved = await prisma.applicationWorkspace.create({
            data: {
                userId,
                sourceUrl: 'https://www.linkedin.com/jobs/search/?currentJobId=4455902670&refId=xyz',
                applicationStatus: 'discovered',
            },
        });
        const { data } = await trackJob(userId, jobSections());
        expect(data.workspaceId).toBe(saved.id);
        expect(data.created).toBe(false);
        // discovered is the one status Scout may promote.
        expect(data.status).toBe('analyzed');
        // The extension's URL is left alone: it is how the extension finds the row.
        const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: saved.id } });
        expect(row.sourceUrl).toContain('currentJobId=4455902670');
    });

    test('a longer job id that merely contains this one is not a match', async () => {
        const userId = user('prefix');
        await prisma.applicationWorkspace.create({
            data: { userId, sourceUrl: 'https://www.linkedin.com/jobs/view/44559026701/', applicationStatus: 'applied' },
        });
        const { data } = await trackJob(userId, jobSections());
        expect(data.created).toBe(true);
    });

    test('status never moves backwards when a job is analysed again', async () => {
        const userId = user('regress');
        const first = await trackJob(userId, jobSections());
        for (const status of ['applied', 'interview', 'offer', 'rejected', 'archived'] as const) {
            await prisma.applicationWorkspace.update({ where: { id: first.data.workspaceId }, data: { applicationStatus: status } });
            const again = await trackJob(userId, jobSections());
            expect(again.data.status).toBe(status);
        }
    });

    test('pasted text with no URL is filed under the run', async () => {
        const userId = user('pasted');
        const { runId, data } = await trackJob(userId, jobSections({ ingest: { sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text' } }));
        const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: data.workspaceId } });
        expect(row.sourceUrl).toBe(`scout:${runId}`);
        expect(row.sourcePlatform).toBe('scout');
        expect(trackerUrl(null, 'r1')).toBe('scout:r1');
    });

    test('a job with no readable description is not tracked', async () => {
        const base = fakeContext({ userId: user('nojd'), sections: { ingest: okSection<'ingest'>(ingest()) } });
        const outcome = await trackSection(base);
        expect(outcome.status).toBe('unavailable');
    });

    test('an extension row with the same company and role is reused, a Scout-claimed one is not', async () => {
        const userId = user('companyrole');
        const extensionRow = await prisma.applicationWorkspace.create({
            data: { userId, sourceUrl: 'https://amazon.jobs/en/jobs/123', companyName: 'Amazon', roleTitle: 'Software Dev Engineer II' },
        });
        const first = await trackJob(userId, jobSections({ ingest: { sourceUrl: 'https://example.com/job/a', linkKind: 'web' } }));
        expect(first.data.workspaceId).toBe(extensionRow.id);
        // Now that row is Scout's; a different posting with the same title gets its own.
        const second = await trackJob(userId, jobSections({ ingest: { sourceUrl: 'https://example.com/job/b', linkKind: 'web' } }));
        expect(second.data.workspaceId).not.toBe(extensionRow.id);
    });
});

// ─────────────────────────────────────────────────────────────── board

describe('job board', () => {
    test('sorts by fit with unknown scores last, maps columns, and filters', async () => {
        const userId = user('board');
        const strong = await trackJob(userId, jobSections({
            ingest: { sourceUrl: 'https://www.linkedin.com/jobs/view/1000000001/' },
            jd: { role: 'Backend Engineer', company: 'Acme', location: 'Bengaluru', workMode: 'remote' },
            fit: { score: 88, verdict: 'strong' },
        }));
        await trackJob(userId, jobSections({
            ingest: { sourceUrl: 'https://www.linkedin.com/jobs/view/1000000002/' },
            jd: { role: 'SRE', company: 'Beta', location: 'Pune' },
            fit: { score: 30, verdict: 'not_a_fit', notFitReasons: ['Asks for 5+ years; you have 2'] },
        }));
        await trackJob(userId, jobSections({
            ingest: { sourceUrl: 'https://www.linkedin.com/jobs/view/1000000003/' },
            jd: { role: 'Data Engineer', company: 'Gamma', location: 'Bengaluru' },
            fit: null,
        }));

        const board = await listJobBoard(userId);
        expect(board.map((item) => item.company)).toEqual(['Acme', 'Beta', 'Gamma']);
        expect(board[0].column).toBe('to_review');
        expect(board[0].topStrength).toBe('Built a CQRS read path');
        expect(board[1].topConcern).toBe('Asks for 5+ years; you have 2');
        expect(board[2].fitScore).toBeNull();

        expect((await listJobBoard(userId, { location: 'bengaluru' })).map((item) => item.company)).toEqual(['Acme', 'Gamma']);
        expect((await listJobBoard(userId, { verdicts: ['strong'] })).map((item) => item.company)).toEqual(['Acme']);
        expect((await listJobBoard(userId, { workModes: ['remote'] })).map((item) => item.company)).toEqual(['Acme']);

        await setJobStatus(userId, { runId: strong.runId }, 'applied');
        const applied = await listJobBoard(userId, { columns: ['applied'] });
        expect(applied.map((item) => item.company)).toEqual(['Acme']);
        expect(applied[0].column).toBe('applied');
        expect((await listJobBoard(userId, { columns: ['to_review'] })).map((item) => item.company)).toEqual(['Beta', 'Gamma']);
    });

    test('the run is the source of truth for the verdict when fit changed after an answer', async () => {
        const userId = user('fresher');
        const { runId } = await trackJob(userId, jobSections({ fit: { score: 40, verdict: 'stretch' } }));
        // Fit re-ran after the user answered a question; track did not.
        await prisma.agentRun.update({
            where: { id: runId },
            data: { result: jobSections({ fit: { score: 75, verdict: 'strong' } }) as unknown as Prisma.InputJsonValue },
        });
        const [item] = await listJobBoard(userId);
        expect(item.verdict).toBe('strong');
        expect(item.fitScore).toBe(75);
    });

    test('topFits: to-review only, strong and possible first, then score', async () => {
        const userId = user('top');
        const add = (id: string, score: number, verdict: FitData['verdict']) => trackJob(userId, jobSections({
            ingest: { sourceUrl: `https://www.linkedin.com/jobs/view/${id}/` },
            jd: { company: `C${id}` },
            fit: { score, verdict },
        }));
        await add('2000000001', 90, 'stretch');
        await add('2000000002', 60, 'possible');
        await add('2000000003', 80, 'strong');
        const applied = await add('2000000004', 95, 'strong');
        await setJobStatus(userId, { workspaceId: applied.data.workspaceId }, 'applied');

        const top = await topFits(userId, { limit: 3 });
        expect(top.map((item) => item.company)).toEqual(['C2000000003', 'C2000000002', 'C2000000001']);
    });
});

// ────────────────────────────────────────────────────────── status moves

describe('setJobStatus', () => {
    test('moves a job by run id, and "saved" never undoes progress', async () => {
        const userId = user('status');
        const { runId } = await trackJob(userId, jobSections());
        const interviewing = await setJobStatus(userId, { runId }, 'interviewing');
        expect(interviewing.success && interviewing.data.status).toBe('interview');

        const saved = await setJobStatus(userId, { runId }, 'saved');
        expect(saved.success && saved.data.status).toBe('interview');

        const passed = await setJobStatus(userId, { runId }, 'not_interested');
        expect(passed.success && passed.data.status).toBe('archived');
        expect(passed.success && passed.data.column).toBe('closed');
    });

    test('another user cannot move my job', async () => {
        const owner = user('owner');
        const other = user('other');
        const { runId, data } = await trackJob(owner, jobSections());
        expect((await setJobStatus(other, { runId }, 'applied')).success).toBe(false);
        expect((await setJobStatus(other, { workspaceId: data.workspaceId }, 'applied')).success).toBe(false);
        const row = await prisma.applicationWorkspace.findUniqueOrThrow({ where: { id: data.workspaceId } });
        expect(row.applicationStatus).toBe('analyzed');
    });
});

// ──────────────────────────────────────────────────── insights, companies, notes

describe('insights, companies, notes, counts', () => {
    test('insights filter by tag and text, case-insensitively', async () => {
        const userId = user('insights');
        await prisma.savedInsight.createMany({
            data: [
                { userId, title: 'System design interviews', takeaways: ['Clarify requirements first'], tags: ['System Design'] },
                { userId, title: 'Negotiating offers', takeaways: ['Anchor with a range'], tags: ['career'] },
            ],
        });
        expect((await listInsights(userId)).length).toBe(2);
        expect((await listInsights(userId, { tag: 'system design' })).map((item) => item.title)).toEqual(['System design interviews']);
        expect((await listInsights(userId, { q: 'anchor' })).map((item) => item.title)).toEqual(['Negotiating offers']);
    });

    test('companies group across spellings and count news mentions', async () => {
        const userId = user('companies');
        await trackJob(userId, jobSections({
            ingest: { sourceUrl: 'https://www.linkedin.com/jobs/view/3000000001/' },
            jd: { company: 'Stripe, Inc.' },
            fit: { score: 70, verdict: 'strong' },
        }));
        await trackJob(userId, jobSections({
            ingest: { sourceUrl: 'https://www.linkedin.com/jobs/view/3000000002/' },
            jd: { company: 'Stripe', role: 'Staff Engineer' },
            fit: { score: 40, verdict: 'stretch' },
        }));
        await scoutRun(userId, {
            classify: okSection<'classify'>({ kind: 'company_signal', confidence: 0.9, companies: ['Stripe', 'Plaid'], roleTitle: null, reason: '' }),
        }, 'company_signal');

        const companies = await listCompanies(userId);
        const stripe = companies.find((company) => company.name.toLowerCase().startsWith('stripe'))!;
        expect(stripe.jobs).toBe(2);
        expect(stripe.mentions).toBe(1);
        expect(stripe.bestFit?.score).toBe(70);
        const plaid = companies.find((company) => company.name === 'Plaid')!;
        expect(plaid.jobs).toBe(0);
        expect(plaid.bestFit).toBeNull();
    });

    test('chat notes are the chat-sourced Wins only, newest first; counts add up', async () => {
        const userId = user('notes');
        const base = { userId, occurredAt: new Date(), category: 'shipped' as const };
        await prisma.win.create({ data: { ...base, title: 'Manual win', source: 'manual' } });
        await prisma.win.create({ data: { ...base, title: 'Chat draft', source: 'chat', createdAt: new Date(Date.now() - 1000) } });
        await prisma.win.create({ data: { ...base, title: 'Chat confirmed', source: 'chat', status: 'confirmed' } });

        const notes = await listChatNotes(userId);
        expect(notes.map((note) => note.title)).toEqual(['Chat confirmed', 'Chat draft']);

        await trackJob(userId, jobSections());
        await prisma.savedInsight.create({ data: { userId, title: 'x' } });
        expect(await inboxCounts(userId)).toEqual({ toReview: 1, applied: 0, interviewing: 0, insights: 1, draftNotes: 1 });
    });
});

// ─────────────────────────────────────────────────────────────── scoping

describe('user scoping', () => {
    test("no query returns another user's rows", async () => {
        const mine = user('scope-mine');
        const theirs = user('scope-theirs');
        await trackJob(theirs, jobSections({ jd: { company: 'TheirCo' } }));
        await prisma.savedInsight.create({ data: { userId: theirs, title: 'Their insight' } });
        await prisma.win.create({ data: { userId: theirs, title: 'Their note', source: 'chat', occurredAt: new Date(), category: 'shipped' } });

        expect(await listJobBoard(mine)).toEqual([]);
        expect(await topFits(mine)).toEqual([]);
        expect(await listInsights(mine)).toEqual([]);
        expect(await listCompanies(mine)).toEqual([]);
        expect(await listChatNotes(mine)).toEqual([]);
        expect(await inboxCounts(mine)).toEqual({ toReview: 0, applied: 0, interviewing: 0, insights: 0, draftNotes: 0 });
    });

    test("a board never joins in another user's run, even if a row points at it", async () => {
        const mine = user('scope-join-mine');
        const theirs = user('scope-join-theirs');
        const theirRun = await scoutRun(theirs, jobSections({ fit: { score: 99, verdict: 'strong' } }));
        await prisma.applicationWorkspace.create({
            data: { userId: mine, sourceUrl: 'https://example.com/forged', scoutRunId: theirRun, fitScore: 10, fitVerdict: 'stretch' },
        });
        const [item] = await listJobBoard(mine);
        expect(item.fitScore).toBe(10);
        expect(item.verdict).toBe('stretch');
    });
});
