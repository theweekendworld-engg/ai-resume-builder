/**
 * The packet pipeline, end to end, against the real local Postgres.
 *
 * The workflow runtime is not involved — the steps are called in order, which is
 * exactly what the runtime does. What is under test is that each step reads its
 * inputs from and writes its outputs to the database, so a run survives a
 * refresh, and that a failure in the middle degrades rather than destroys.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { PacketStatus, PacketType, WinCategory, WinSensitivity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting } from '@/lib/ai/structured';
import {
    composeStep,
    failPacketStep,
    groupThemesStep,
    mapCompetenciesStep,
    readWinsStep,
    verifyAndFinishStep,
} from '@/workflows/steps/reviewPacket';
import {
    auditPacketNumbers,
    loadPacketWins,
    parsePacketContent,
    readProgress,
    renderMarkdown,
    type PacketContent,
} from '@/services/reviewPacket';
import { createFramework, PATRONUS_DEFAULT_FRAMEWORK } from '@/services/competency';
import {
    cleanupPacketUser,
    makeCaptureSignal,
    makeConfirmedWin,
    newPacketUserId,
} from '@/services/packetFixtures.test-utils';
import { buildReadinessReport } from '@/services/reviewPacket';

const users: string[] = [];

function user(label: string): string {
    const id = newPacketUserId(label);
    users.push(id);
    return id;
}

afterEach(async () => {
    aiTesting.reset();
    while (users.length > 0) {
        const id = users.pop();
        if (id) await cleanupPacketUser(id);
    }
});

const PERIOD_START = new Date('2026-02-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-07-31T00:00:00.000Z');

async function seedLog(userId: string) {
    await makeConfirmedWin(userId, {
        title: 'Cut checkout p95 from 800ms to 180ms',
        narrative: 'Rewrote the pricing lookup as one batched query.',
        occurredAt: new Date('2026-07-14T00:00:00.000Z'),
        category: WinCategory.improved,
        impact: { metric: 'checkout p95 latency', baseline: '800ms', result: '180ms' },
        sourceRef: 'https://github.com/acme/api/pull/482',
    });
    await makeConfirmedWin(userId, {
        title: 'Eliminated the top checkout support complaint',
        occurredAt: new Date('2026-06-02T00:00:00.000Z'),
        category: WinCategory.fixed,
    });
    await makeConfirmedWin(userId, {
        title: 'Ran the payments design review across two teams',
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        category: WinCategory.influenced,
    });
    await makeConfirmedWin(userId, {
        title: 'Renegotiated the vendor contract',
        occurredAt: new Date('2026-05-05T00:00:00.000Z'),
        category: WinCategory.saved,
        sensitivity: WinSensitivity.confidential,
    });
}

async function createPacket(userId: string, frameworkId: string | null, targetLevel: string | null) {
    return prisma.reviewPacket.create({
        data: {
            userId,
            type: PacketType.performance_review,
            status: PacketStatus.generating,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            frameworkId,
            targetLevel,
            audience: 'manager',
        },
        select: { id: true },
    });
}

/** A well-behaved model: real numbers only, drawn from the seeded log. */
function honestRunner() {
    aiTesting.setUsageLogger(async () => {});
    aiTesting.setObjectRunner(async ({ schema, prompt }) => {
        const ids = [...prompt.matchAll(/id: ([a-z0-9]+)/g)].map((match) => match[1]);

        const asThemes = schema.safeParse({
            themes: [
                {
                    title: 'Made checkout reliable at peak',
                    outcomeSentence: 'Cut checkout p95 from 800ms to 180ms and removed the top support complaint.',
                    winIds: ids,
                    scope: null,
                    strength: 'headline',
                },
            ],
            unthemed: [],
            coherenceNote: null,
        });
        if (asThemes.success) return { object: asThemes.data, inputTokens: 5, outputTokens: 5 };

        const asMappings = schema.safeParse({
            mappings: ids.map((id) => ({ winId: id, competencyKey: 'execution', strength: 'strong' })),
        });
        if (asMappings.success) return { object: asMappings.data, inputTokens: 5, outputTokens: 5 };

        return {
            object: {
                summary: 'I focused on checkout reliability, cutting p95 from 800ms to 180ms.',
                themeOutcomes: [
                    {
                        index: 0,
                        outcomeSentence: 'Cut checkout p95 from 800ms to 180ms.',
                        impact: null,
                    },
                ],
                growth: 'Mentorship has no evidence in this period. That is the gap worth closing.',
            },
            inputTokens: 5,
            outputTokens: 5,
        };
    });
}

async function runPipeline(packetId: string) {
    await readWinsStep(packetId);
    await groupThemesStep(packetId);
    await mapCompetenciesStep(packetId);
    await composeStep(packetId);
    await verifyAndFinishStep(packetId);
}

async function loadContent(packetId: string): Promise<PacketContent> {
    const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packetId } });
    const content = parsePacketContent(row.content);
    expect(content).not.toBeNull();
    return content as PacketContent;
}

describe('the packet pipeline', () => {
    test('produces a ready packet whose every block traces to a win', async () => {
        const userId = user('pipeline');
        await seedLog(userId);
        honestRunner();

        const packet = await createPacket(userId, null, null);
        await runPipeline(packet.id);

        const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } });
        expect(row.status).toBe(PacketStatus.ready);
        expect(row.wordCount).toBeGreaterThan(0);
        expect(row.generationMs).not.toBeNull();
        expect(Array.isArray(row.winIds) ? row.winIds : []).toHaveLength(4);

        const content = await loadContent(packet.id);
        expect(content.themes.length).toBeGreaterThanOrEqual(1);
        expect(content.themes.length).toBeLessThanOrEqual(5);
        expect(content.summary.text).toContain('800ms');

        // Nothing in a packet exists without a Win behind it.
        const scope = new Set(content.appendix.winIds);
        const blocks = [
            content.summary,
            content.growth,
            ...content.themes.flatMap((theme) => [theme.outcome, ...theme.bullets]),
        ].filter((block) => block.text.trim().length > 0);

        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
            expect(block.sourceWinIds.length).toBeGreaterThan(0);
            expect(block.sourceWinIds.every((id) => scope.has(id))).toBe(true);
        }

        // And nothing numeric that the log does not contain.
        const wins = await prisma.win.findMany({ where: { userId }, select: { id: true } });
        expect(wins).toHaveLength(4);
        expect(content.warnings).toEqual([]);
    }, 30_000);

    test('every stage records its result, so a refresh mid-run is a non-event', async () => {
        const userId = user('progress');
        await seedLog(userId);
        honestRunner();

        const packet = await createPacket(userId, null, null);

        await readWinsStep(packet.id);
        let progress = readProgress(
            (await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } })).content,
        );
        expect(progress?.stages.find((stage) => stage.id === 'read')?.status).toBe('done');
        expect(progress?.stages.find((stage) => stage.id === 'read')?.result).toContain('4 wins');
        expect(progress?.stages.find((stage) => stage.id === 'themes')?.status).toBe('pending');

        await groupThemesStep(packet.id);
        progress = readProgress(
            (await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } })).content,
        );
        expect(progress?.stages.find((stage) => stage.id === 'themes')?.result).toContain('found 1 theme');

        await mapCompetenciesStep(packet.id);
        await composeStep(packet.id);
        await verifyAndFinishStep(packet.id);

        progress = readProgress(
            (await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } })).content,
        );
        // The truthfulness pass is named in the UI because it is a feature.
        const verify = progress?.stages.find((stage) => stage.id === 'verify');
        expect(verify?.label).toBe('Checking every claim against your log');
        expect(verify?.status).toBe('done');
        expect(verify?.result).toBe('every claim traced to a win');
    }, 30_000);

    test('a model outage still produces a packet, grouped by category', async () => {
        const userId = user('degraded');
        await seedLog(userId);
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => {
            throw new Error('model unavailable');
        });

        const packet = await createPacket(userId, null, null);
        await runPipeline(packet.id);

        const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } });
        expect(row.status).toBe(PacketStatus.ready);

        const content = await loadContent(packet.id);
        // Deterministic themes, real bullets, no prose — and no error surfaced.
        expect(content.themes.length).toBeGreaterThan(0);
        expect(content.themes.flatMap((theme) => theme.bullets).length).toBe(4);
        expect(content.summary.text).toBe('');

        const wins = content.appendix.winIds;
        expect(wins).toHaveLength(4);
    }, 30_000);

    test('the competency section is populated when a framework is attached', async () => {
        const userId = user('framework');
        await seedLog(userId);
        honestRunner();

        const framework = await createFramework({
            userId,
            shape: { ...PATRONUS_DEFAULT_FRAMEWORK, name: 'Acme ladder' },
        });
        const packet = await createPacket(userId, framework.id, 'l4');
        await runPipeline(packet.id);

        const content = await loadContent(packet.id);
        expect(content.header.frameworkName).toBe('Acme ladder');
        expect(content.header.targetLevelName).toBe('Staff');
        expect(content.competencies).toHaveLength(6);

        // Absent is reported honestly — the mock mapped everything to execution.
        const mentorship = content.competencies.find((item) => item.key === 'mentorship');
        expect(mentorship?.verdict).toBe('absent');

        const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } });
        const gaps = Array.isArray(row.gaps) ? row.gaps : [];
        expect(gaps.length).toBeGreaterThan(0);
    }, 30_000);

    test('the exported markdown carries the log\'s real figures and no others', async () => {
        const userId = user('export');
        await seedLog(userId);
        honestRunner();

        const packet = await createPacket(userId, null, null);
        await runPipeline(packet.id);

        const content = await loadContent(packet.id);
        const packetWins = await loadPacketWins({
            userId,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
        });

        expect(auditPacketNumbers(content, packetWins)).toEqual([]);

        const withConfidential = renderMarkdown(content, packetWins, { includeConfidential: true });
        expect(withConfidential).toContain('800ms');
        expect(withConfidential).toContain('Renegotiated the vendor contract');
        expect(withConfidential).toContain('🔒');

        const without = renderMarkdown(content, packetWins, { includeConfidential: false });
        expect(without).not.toContain('Renegotiated the vendor contract');
    }, 30_000);

    test('failure marks the run failed and leaves the log untouched', async () => {
        const userId = user('fail');
        await seedLog(userId);
        honestRunner();

        const packet = await createPacket(userId, null, null);
        await readWinsStep(packet.id);
        await failPacketStep(packet.id, 'compose blew up');

        const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } });
        expect(row.status).toBe(PacketStatus.failed);

        const winCount = await prisma.win.count({ where: { userId } });
        expect(winCount).toBe(4);
    }, 30_000);

    test('failure never downgrades a packet that already finished', async () => {
        const userId = user('fail-late');
        await seedLog(userId);
        honestRunner();

        const packet = await createPacket(userId, null, null);
        await runPipeline(packet.id);
        await failPacketStep(packet.id, 'a late retry');

        const row = await prisma.reviewPacket.findUniqueOrThrow({ where: { id: packet.id } });
        expect(row.status).toBe(PacketStatus.ready);
    }, 30_000);
});

// ═══════════════════════════════════════════════════════ readiness report

describe('the readiness report', () => {
    test('finds unlogged evidence for a weak competency and links to it', async () => {
        const userId = user('unlogged');
        await seedLog(userId);
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => {
            throw new Error('deterministic priors only');
        });

        await makeCaptureSignal(userId, {
            title: 'Reviewed PR #918 from a junior engineer',
            body: 'Left detailed review comments on the retry logic.',
            occurredAt: new Date('2026-06-11T00:00:00.000Z'),
            url: 'https://github.com/acme/api/pull/918',
        });
        await makeCaptureSignal(userId, {
            title: 'Reviewed PR #931 and paired on the fix',
            occurredAt: new Date('2026-06-18T00:00:00.000Z'),
        });

        const report = await buildReadinessReport({
            userId,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
        });

        expect(report.winCount).toBe(4);
        expect(report.competencies.find((item) => item.key === 'mentorship')?.verdict).toBe('absent');
        expect(report.unloggedEvidence).not.toBeNull();
        expect(report.unloggedEvidence?.competencyKey).toBe('mentorship');
        expect(report.unloggedEvidence?.count).toBe(2);
        expect(report.unloggedEvidence?.samples.some((sample) => sample.url?.includes('pull/'))).toBe(
            true,
        );
    }, 30_000);

    test('hides the card when there is nothing unlogged to show', async () => {
        const userId = user('no-unlogged');
        await seedLog(userId);
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => {
            throw new Error('deterministic priors only');
        });

        const report = await buildReadinessReport({
            userId,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
        });
        expect(report.unloggedEvidence).toBeNull();
        // The diagnosis still stands on its own.
        expect(report.honestRead.length).toBeGreaterThan(0);
        expect(report.whatWouldCloseIt.length).toBeGreaterThan(0);
    }, 30_000);

    test('never emits a score out of 100', async () => {
        const userId = user('no-score');
        await seedLog(userId);
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setObjectRunner(async () => {
            throw new Error('deterministic priors only');
        });

        const report = await buildReadinessReport({
            userId,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
        });
        const serialized = JSON.stringify(report);
        expect(serialized).not.toMatch(/\/\s?100\b/);
        expect(serialized).not.toMatch(/"score"/);
    }, 30_000);
});
