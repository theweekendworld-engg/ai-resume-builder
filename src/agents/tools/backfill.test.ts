/**
 * The backfill tools, against the real database.
 *
 * These are the six tools PRD 07 §5.1 specifies plus the session plumbing, and
 * what is under test is the data contract rather than the conversation: that a
 * capture is a row before the session ends, that an assertion lands as
 * unconfirmed evidence, that a figure the user did not say is refused at the
 * write, and that a transcript can be destroyed without destroying the record
 * it produced.
 *
 * Only Clerk and the near-duplicate embedding are faked. Postgres is real, and
 * every fixture is namespaced under a fresh userId so teardown never touches
 * anyone's development data.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installClerkMock } from '@/__mocks__/clerk';
import { formatMetricLabel } from './backfill';
import {
    EvidenceKind,
    GroundState,
    InterviewStatus,
    WinCategory,
    WinSensitivity,
    WinSource,
    WinStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as draftTesting } from '@/services/winDrafting';
import {
    cleanupTestUser,
    makeExperience,
    makeWin,
    newTestUserId,
    rememberWin,
} from '@/services/winFixtures.test-utils';

const clerk = installClerkMock();

const tools = await import('@/agents/tools/backfill');

const users: string[] = [];
const sessionIds: string[] = [];

function signIn(label: string): string {
    const id = newTestUserId(`backfill-${label}`);
    users.push(id);
    clerk.signIn(id);
    return id;
}

async function openSession(userId: string, label = 'Acme', subjectId: string | null = null) {
    const result = await tools.startSessionTool({
        userId,
        subjectType: 'employer',
        subjectId,
        subjectLabel: label,
    });
    if (!result.success) throw new Error(result.error);
    sessionIds.push(result.data.id);
    return result.data;
}

beforeAll(() => {
    draftTesting.setEmbedder(async () => {
        throw new Error('no vector store in this test');
    });
});

afterAll(async () => {
    draftTesting.reset();
    if (sessionIds.length > 0) {
        await prisma.interviewSession.deleteMany({ where: { id: { in: sessionIds } } });
    }
    for (const userId of users) await cleanupTestUser(userId);
});

// ═══════════════════════════════════════════════════════════════════ sessions

describe('session lifecycle', () => {
    test('a new session expires 30 days out, per the transcript TTL', async () => {
        const userId = signIn('ttl');
        const session = await openSession(userId);

        const days =
            (session.expiresAt.getTime() - session.startedAt.getTime()) / 86_400_000;
        expect(Math.round(days)).toBe(tools.TRANSCRIPT_TTL_DAYS);
        expect(session.status).toBe(InterviewStatus.active);
        expect(session.transcript).toEqual([]);
    });

    test('re-entering a subject resumes rather than forking a second transcript', async () => {
        // Two transcripts for one employer would make `askedTopics` useless and
        // question one would repeat forever.
        const userId = signIn('resume');
        const experience = await makeExperience({ userId, company: 'Acme', startDate: '2023-01' });

        const first = await openSession(userId, 'Acme', experience.id);
        await tools.persistTurnTool({
            userId,
            sessionId: first.id,
            appendTurns: [{ role: 'agent', content: 'What are you known for?', topic: 'anchor' }],
            askTopics: ['anchor'],
            questionCountDelta: 1,
        });

        const second = await openSession(userId, 'Acme', experience.id);
        expect(second.id).toBe(first.id);
        expect(second.askedTopics).toEqual(['anchor']);
        expect(second.questionCount).toBe(1);
    });

    test('a paused session reopens as active', async () => {
        const userId = signIn('paused');
        const session = await openSession(userId, 'Northwind');
        await tools.endSessionTool({ userId, sessionId: session.id, status: InterviewStatus.paused });

        const reopened = await openSession(userId, 'Northwind');
        expect(reopened.id).toBe(session.id);
        expect(reopened.status).toBe(InterviewStatus.active);
    });

    test('askedTopics de-duplicates, which is what stops a re-ask', async () => {
        const userId = signIn('topics');
        const session = await openSession(userId);

        await tools.persistTurnTool({ userId, sessionId: session.id, askTopics: ['anchor', 'sweep'] });
        const after = await tools.persistTurnTool({
            userId,
            sessionId: session.id,
            askTopics: ['anchor', 'evidence'],
        });

        expect(after.success).toBe(true);
        if (after.success) {
            expect(after.data.askedTopics).toEqual(['anchor', 'sweep', 'evidence']);
        }
    });

    test('another user cannot read the session', async () => {
        const owner = signIn('owner');
        const session = await openSession(owner);
        const intruder = signIn('intruder');

        const result = await tools.getSessionTool({ userId: intruder, sessionId: session.id });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('not_found');
    });

    test('findResumableSessionTool is what keeps a resume from being metered twice', async () => {
        const userId = signIn('meter');
        expect(
            await tools.findResumableSessionTool({ userId, subjectType: 'employer', subjectId: null }),
        ).toMatchObject({ success: true, data: null });

        const session = await openSession(userId);
        const found = await tools.findResumableSessionTool({
            userId,
            subjectType: 'employer',
            subjectId: null,
        });
        expect(found.success && found.data?.id).toBe(session.id);
    });
});

// ═══════════════════════════════════════════════════════════ subject context

describe('getSubjectContext', () => {
    test('reads the employer, its period, and the wins inside it', async () => {
        const userId = signIn('context');
        const experience = await makeExperience({
            userId,
            company: 'Acme',
            role: 'Staff Engineer',
            startDate: '2023-01',
            endDate: '2025-01',
        });
        await prisma.userExperience.update({
            where: { id: experience.id },
            data: { highlights: ['Led the payments migration'] },
        });
        await makeWin({
            userId,
            employerId: experience.id,
            occurredAt: new Date('2024-03-01T00:00:00.000Z'),
        });

        const result = await tools.getSubjectContextTool({
            userId,
            subjectType: 'employer',
            subjectId: experience.id,
            subjectLabel: 'Acme',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.role).toBe('Staff Engineer');
        expect(result.data.highlights).toEqual(['Led the payments migration']);
        expect(result.data.periodStart?.getUTCFullYear()).toBe(2023);
        expect(result.data.existingWins.length).toBe(1);
        expect(result.data.hasPriorContext).toBe(true);
    });

    test('reports honestly when it knows nothing, so the agent does not pretend', async () => {
        const userId = signIn('blank');
        const result = await tools.getSubjectContextTool({
            userId,
            subjectType: 'employer',
            subjectId: null,
            subjectLabel: 'Somewhere',
        });
        expect(result.success && result.data.hasPriorContext).toBe(false);
    });
});

describe('getGraphGaps', () => {
    test('finds the missing rare categories, the unquantified and the unscoped', async () => {
        const userId = signIn('gaps');
        const quantified = await makeWin({
            userId,
            title: 'Cut checkout p95 for the whole payments team',
            category: WinCategory.improved,
            impact: { metric: 'p95', baseline: '800ms', result: '180ms' },
        });
        const bare = await makeWin({
            userId,
            title: 'Rewrote the pricing lookup',
            narrative: 'Batched the query.',
            category: WinCategory.shipped,
        });

        const result = await tools.getGraphGapsTool({ userId, winIds: [quantified.id, bare.id] });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.data.quantifiedCount).toBe(1);
        expect(result.data.unquantifiedWins.map((win) => win.id)).toEqual([bare.id]);
        expect(result.data.unscopedWins.map((win) => win.id)).toEqual([bare.id]);
        // influenced/grew/saved are the categories the log is always missing.
        expect(result.data.missingCategories).toEqual([...tools.RARE_CATEGORIES]);
    });

    test('an empty subject is all gaps, not an error', async () => {
        const userId = signIn('nogaps');
        const result = await tools.getGraphGapsTool({ userId, winIds: [] });
        expect(result.success && result.data.missingCategories.length).toBe(3);
    });

    test('mentionsScope reads the sentence, not a flag', () => {
        expect(tools.mentionsScope('unblocked the payments team')).toBe(true);
        expect(tools.mentionsScope('rewrote the pricing lookup')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════ capture writes

describe('writeWinDraft', () => {
    test('persists a draft immediately, with the interview as its source', async () => {
        const userId = signIn('capture');
        const session = await openSession(userId);

        const result = await tools.writeWinDraftTool({
            userId,
            sessionId: session.id,
            questionIndex: 1,
            answerText: 'I cut checkout p95 from 800ms to 180ms',
            draft: {
                title: 'Cut checkout p95',
                narrative: '',
                category: WinCategory.improved,
                skills: [],
                collaborators: [],
                sensitivity: WinSensitivity.shareable,
                impact: { metric: 'checkout p95', baseline: '800ms', result: '180ms' },
                confidence: 0.6,
            },
            occurredAt: new Date('2024-06-01T00:00:00.000Z'),
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        rememberWin(userId, result.data.win.winId);

        const row = await prisma.win.findUnique({ where: { id: result.data.win.winId } });
        expect(row?.status).toBe(WinStatus.draft);
        expect(row?.source).toBe(WinSource.backfill);
        expect(row?.sourceRef).toBe(`${tools.BACKFILL_SOURCE_PREFIX}${session.id}`);
        expect(result.data.win.quantified).toBe(true);
        expect(result.data.win.metricLabel).toBe('800ms → 180ms');
    });

    test('refuses a figure the answer does not contain, and keeps the Win', async () => {
        // The whole feature turns on this. A Win with no number is useful; a Win
        // with an invented one ends up on a resume the user cannot defend.
        const userId = signIn('ungrounded');
        const session = await openSession(userId);

        const result = await tools.writeWinDraftTool({
            userId,
            sessionId: session.id,
            questionIndex: 1,
            answerText: 'I made the reporting API much faster',
            draft: {
                title: 'Made the reporting API faster',
                narrative: '',
                category: WinCategory.improved,
                skills: [],
                collaborators: [],
                sensitivity: WinSensitivity.shareable,
                impact: { metric: 'reporting latency', baseline: '2.4s', result: '300ms' },
                confidence: 0.6,
            },
            occurredAt: new Date('2024-06-01T00:00:00.000Z'),
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        rememberWin(userId, result.data.win.winId);

        expect(result.data.win.quantified).toBe(false);
        const metrics = await prisma.impactMetric.findMany({ where: { userId } });
        expect(metrics).toEqual([]);
    });

    test('the rail survives a reload because it is stored, not held in memory', async () => {
        const userId = signIn('rail');
        const session = await openSession(userId);
        const win = await makeWin({ userId });

        await tools.recordCapturesTool({
            userId,
            sessionId: session.id,
            wins: [
                {
                    winId: win.id,
                    title: win.title,
                    category: win.category,
                    sensitivity: win.sensitivity,
                    quantified: false,
                    metricLabel: null,
                    questionIndex: 1,
                    capturedAt: new Date().toISOString(),
                },
            ],
        });

        const reloaded = await tools.getSessionTool({ userId, sessionId: session.id });
        expect(reloaded.success && reloaded.data.captured.length).toBe(1);
    });
});

describe('writeImpactMetric', () => {
    test('attaches a stated figure and links it to the Win', async () => {
        const userId = signIn('impact');
        const win = await makeWin({ userId, title: 'Rebuilt the job queue', impact: null });

        const result = await tools.writeImpactMetricTool({
            userId,
            winId: win.id,
            answerText: 'the backlog went from 11 days to 7 days',
            impact: { metric: 'backlog', baseline: '11 days', result: '7 days' },
        });

        expect(result.success).toBe(true);
        const row = await prisma.win.findUnique({ where: { id: win.id } });
        expect(row?.impactMetricId).not.toBeNull();
    });

    test('updates in place rather than stacking a second metric', async () => {
        const userId = signIn('impact-update');
        const win = await makeWin({ userId, title: 'Rebuilt the job queue', impact: null });

        await tools.writeImpactMetricTool({
            userId,
            winId: win.id,
            answerText: 'from 11 days to 7 days',
            impact: { metric: 'backlog', baseline: '11 days', result: '7 days' },
        });
        await tools.writeImpactMetricTool({
            userId,
            winId: win.id,
            answerText: 'actually from 11 days to 5 days',
            impact: { metric: 'backlog', baseline: '11 days', result: '5 days' },
        });

        const metrics = await prisma.impactMetric.findMany({ where: { userId } });
        expect(metrics.length).toBe(1);
        expect(metrics[0].result).toBe('5 days');
    });

    test('refuses an answer with no figure in it', async () => {
        const userId = signIn('impact-refuse');
        const win = await makeWin({ userId, impact: null });

        const result = await tools.writeImpactMetricTool({
            userId,
            winId: win.id,
            answerText: 'it got a lot faster, I never saw the number',
            impact: { metric: 'latency', baseline: '800ms', result: '180ms' },
        });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.code).toBe('no_quantity');
        expect(await prisma.impactMetric.count({ where: { userId } })).toBe(0);
    });

    test('impactIsGrounded rejects a percentage derived from two real figures', () => {
        const source = 'CI build times went from 40 minutes to 12 minutes';
        expect(
            tools.impactIsGrounded(
                { metric: 'CI build time', baseline: '40 minutes', result: '12 minutes' },
                source,
            ),
        ).toBe(true);
        // Real inputs, invented arithmetic. Still a fabricated number.
        expect(
            tools.impactIsGrounded(
                { metric: 'CI build time', baseline: '40 minutes', result: '12 minutes', delta: '-70%' },
                source,
            ),
        ).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════ evidence

describe('linkEvidence', () => {
    test("the user's own words become unconfirmed evidence", async () => {
        const userId = signIn('evidence');
        const session = await openSession(userId);
        const win = await makeWin({ userId });

        const result = await tools.linkEvidenceTool({
            userId,
            sessionId: session.id,
            winId: win.id,
            excerpt: 'I rewrote the pricing lookup as one batched query',
        });

        expect(result.success).toBe(true);
        if (!result.success) return;

        const evidence = await prisma.evidence.findUnique({ where: { id: result.data.evidenceId } });
        expect(evidence?.kind).toBe(EvidenceKind.interview_assertion);
        expect(evidence?.excerpt).toBe('I rewrote the pricing lookup as one batched query');
        // Fail closed on truth: an interview assertion is a claim, not a ground.
        expect(evidence?.confirmedByUser).toBe(false);

        const link = await prisma.claimLink.findUnique({ where: { id: result.data.claimLinkId } });
        expect(link?.groundState).toBe(GroundState.needs_confirmation);
        expect(link?.claimRefId).toBe(win.id);
    });

    test('is idempotent, so a retried turn does not stack assertions', async () => {
        const userId = signIn('evidence-retry');
        const session = await openSession(userId);
        const win = await makeWin({ userId });

        const first = await tools.linkEvidenceTool({
            userId,
            sessionId: session.id,
            winId: win.id,
            excerpt: 'the same sentence',
        });
        const second = await tools.linkEvidenceTool({
            userId,
            sessionId: session.id,
            winId: win.id,
            excerpt: 'the same sentence',
        });

        expect(first.success && second.success).toBe(true);
        if (first.success && second.success) {
            expect(second.data.evidenceId).toBe(first.data.evidenceId);
        }
        expect(await prisma.claimLink.count({ where: { userId } })).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════ end & privacy

describe('endSession', () => {
    test('counts the closing screen from rows, not from the conversation', async () => {
        const userId = signIn('closing');
        const experience = await makeExperience({ userId, company: 'Acme', startDate: '2023-01' });
        await prisma.userExperience.update({
            where: { id: experience.id },
            data: { highlights: ['a', 'b', 'c'] },
        });
        const session = await openSession(userId, 'Acme', experience.id);

        const quantified = await makeWin({
            userId,
            employerId: experience.id,
            title: 'Cut checkout p95 for the payments team',
            impact: { metric: 'p95', baseline: '800ms', result: '180ms' },
        });
        const plain = await makeWin({
            userId,
            employerId: experience.id,
            title: 'Rewrote the pricing lookup',
            narrative: 'Batched query.',
            occurredAt: new Date('2024-02-02T00:00:00.000Z'),
        });

        await tools.recordCapturesTool({
            userId,
            sessionId: session.id,
            wins: [quantified, plain].map((win, index) => ({
                winId: win.id,
                title: win.title,
                category: win.category,
                sensitivity: win.sensitivity,
                quantified: index === 0,
                metricLabel: null,
                questionIndex: index,
                capturedAt: new Date().toISOString(),
            })),
        });

        const summary = await tools.endSessionTool({ userId, sessionId: session.id });
        expect(summary.success).toBe(true);
        if (!summary.success) return;

        expect(summary.data.winsCaptured).toBe(2);
        expect(summary.data.quantifiedCount).toBe(1);
        expect(summary.data.crossTeamCount).toBe(1);
        expect(summary.data.priorHighlightCount).toBe(3);

        const row = await prisma.interviewSession.findUnique({ where: { id: session.id } });
        expect(row?.status).toBe(InterviewStatus.completed);
        expect(row?.completedAt).not.toBeNull();
    });
});

describe('transcript privacy', () => {
    test('the transcript is deletable without touching the wins it produced', async () => {
        const userId = signIn('privacy');
        const session = await openSession(userId);
        const win = await makeWin({ userId });
        await tools.linkEvidenceTool({
            userId,
            sessionId: session.id,
            winId: win.id,
            excerpt: 'something I would rather not keep a record of',
        });
        await tools.persistTurnTool({
            userId,
            sessionId: session.id,
            appendTurns: [
                { role: 'agent', content: 'What happened there?' },
                { role: 'user', content: 'something I would rather not keep a record of' },
            ],
        });

        const deleted = await tools.deleteTranscriptTool({ userId, sessionId: session.id });
        expect(deleted.success && deleted.data.turnsRemoved).toBe(2);

        const after = await tools.getSessionTool({ userId, sessionId: session.id });
        expect(after.success && after.data.transcript).toEqual([]);

        // The record survives; the conversation does not.
        expect(await prisma.win.count({ where: { id: win.id } })).toBe(1);
        const evidence = await prisma.evidence.findFirst({ where: { userId } });
        expect(evidence?.excerpt).not.toContain('rather not keep');
    });

    test('the transcript is exportable', async () => {
        const userId = signIn('export');
        const session = await openSession(userId, 'Acme');
        await tools.persistTurnTool({
            userId,
            sessionId: session.id,
            appendTurns: [{ role: 'agent', content: 'What are you known for?' }],
        });

        const result = await tools.exportTranscriptTool({ userId, sessionId: session.id });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.subjectLabel).toBe('Acme');
        expect(result.data.transcript.length).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════ codecs

describe('json codecs', () => {
    test('a rail written as bare ids by an older shape still decodes', () => {
        const decoded = tools.decodeCaptured(['win-1', 'win-2']);
        expect(decoded.map((win) => win.winId)).toEqual(['win-1', 'win-2']);
    });

    test('garbage in a Json column degrades to empty rather than throwing', () => {
        expect(tools.decodeCaptured('not an array' as never)).toEqual([]);
        expect(tools.decodeTranscript([{ role: 'nobody', content: 1 }] as never)).toEqual([]);
    });

    test('formatMetricLabel picks the sharpest available figure', () => {
        expect(
            tools.formatMetricLabel({ metric: 'p95', baseline: '800ms', result: '180ms' }),
        ).toBe('800ms → 180ms');
        expect(tools.formatMetricLabel({ metric: 'tickets', delta: '-30%' })).toBe('-30%');
        expect(tools.formatMetricLabel(null)).toBeNull();
    });
});

describe('formatMetricLabel never renders an empty chip', () => {
    test('a guard-blanked delta falls through instead of returning an empty string', () => {
        // The guard writes '' rather than null when it strips a field, and ''
        // is not nullish — so `??` used to return it verbatim.
        expect(
            formatMetricLabel({ metric: 'p95 latency', baseline: '800ms', result: null, delta: '' }),
        ).toBe('p95 latency');
    });

    test('whitespace is treated as empty too', () => {
        expect(
            formatMetricLabel({ metric: 'tickets', baseline: '30', result: null, delta: '   ' }),
        ).toBe('tickets');
    });

    test('a real delta still wins', () => {
        expect(
            formatMetricLabel({ metric: 'p95 latency', baseline: '800ms', result: null, delta: '-77%' }),
        ).toBe('-77%');
    });

    test('baseline and result together still render the arrow', () => {
        expect(
            formatMetricLabel({ metric: 'p95', baseline: '800ms', result: '180ms', delta: '' }),
        ).toBe('800ms → 180ms');
    });

    test('everything blank yields null, not an empty label', () => {
        expect(formatMetricLabel({ metric: '', baseline: '', result: '', delta: '' })).toBeNull();
    });
});
