/**
 * Integration-test fixtures for the review packet layer.
 *
 * Deliberately NOT a `*.test.ts` file so the runner does not collect it.
 *
 * Everything is namespaced under a freshly generated `userId` and teardown only
 * ever deletes rows carrying that id. The local database is shared with real
 * development data — a test that truncates a table deletes someone's work.
 */

import { randomUUID } from 'node:crypto';
import {
    CaptureSourceKind,
    WinCategory,
    WinSensitivity,
    WinSource,
    type Win,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { confirmWin, createWinRecord } from '@/services/winGraph';
import { cleanupTestUser, rememberWin } from '@/services/winFixtures.test-utils';
import type { PacketWin } from '@/services/reviewPacket';

export function newPacketUserId(label = 'c2'): string {
    return `test-packet-${label}-${randomUUID()}`;
}

export type WinSeed = {
    title: string;
    narrative?: string;
    occurredAt: Date;
    category?: WinCategory;
    sensitivity?: WinSensitivity;
    impact?: { metric: string; baseline?: string; result?: string; delta?: string; scope?: string } | null;
    sourceRef?: string | null;
};

/**
 * A Win the packet pipeline will actually pick up: created and then confirmed,
 * so it carries the `Evidence(confirmedByUser) + ClaimLink(grounded)` pair the
 * rest of the product depends on.
 */
export async function makeConfirmedWin(userId: string, seed: WinSeed): Promise<Win> {
    const win = await createWinRecord({
        userId,
        title: seed.title,
        narrative: seed.narrative ?? '',
        occurredAt: seed.occurredAt,
        category: seed.category ?? WinCategory.shipped,
        sensitivity: seed.sensitivity ?? WinSensitivity.shareable,
        source: WinSource.manual,
        sourceRef: seed.sourceRef ?? null,
        employerId: null,
        impact: seed.impact ?? null,
    });
    rememberWin(userId, win.id);
    await confirmWin({ userId, winId: win.id });
    return win;
}

/** An unconverted capture signal, for the "you have unlogged evidence" card. */
export async function makeCaptureSignal(
    userId: string,
    seed: { title: string; body?: string; occurredAt: Date; kind?: string; url?: string | null },
): Promise<{ sourceId: string; signalId: string }> {
    const source = await prisma.captureSource.upsert({
        where: { userId_kind: { userId, kind: CaptureSourceKind.github } },
        create: {
            userId,
            kind: CaptureSourceKind.github,
            externalAccountId: `test-${randomUUID()}`,
            consentGrantedAt: new Date(),
            consentCopyVersion: 'test',
        },
        update: {},
        select: { id: true },
    });

    const signal = await prisma.captureSignal.create({
        data: {
            userId,
            sourceId: source.id,
            externalId: `test-${randomUUID()}`,
            kind: seed.kind ?? 'pr_reviewed',
            occurredAt: seed.occurredAt,
            title: seed.title,
            body: seed.body ?? '',
            url: seed.url ?? null,
        },
        select: { id: true },
    });

    return { sourceId: source.id, signalId: signal.id };
}

/** Removes everything the packet fixtures could have written, FK-safe. */
export async function cleanupPacketUser(userId: string): Promise<void> {
    await prisma.reviewPacket.deleteMany({ where: { userId } });
    await prisma.competencyFramework.deleteMany({ where: { userId } });
    await prisma.captureSignal.deleteMany({ where: { userId } });
    await prisma.captureSource.deleteMany({ where: { userId } });
    await cleanupTestUser(userId);
}

// ═════════════════════════════════════════════════ pure in-memory fixtures

let counter = 0;

/** A `PacketWin` with no database behind it, for the pure-function tests. */
export function packetWin(overrides: Partial<PacketWin> = {}): PacketWin {
    counter += 1;
    return {
        id: `w${counter}`,
        title: 'Shipped the batching refactor',
        narrative: 'Rewrote the pricing lookup as a single batched query.',
        occurredAt: new Date('2026-05-14T00:00:00.000Z'),
        category: WinCategory.shipped,
        sensitivity: WinSensitivity.shareable,
        employerId: null,
        employerName: 'Acme',
        metric: null,
        quantified: false,
        hasEvidence: true,
        evidenceLabel: null,
        evidenceUrl: null,
        ...overrides,
    };
}

// ═════════════════════════════════════════════════════════ the eval corpus
//
// PRD 03 §11: "Zero numbers appear that are not present in a source Win —
// automated digit-check on a 20-packet eval set; hard launch gate."
//
// Each scenario pairs a real set of Wins with a model that ACTIVELY TRIES to
// fabricate: it invents percentages, totals two source figures, rounds, and
// promotes a scope the log never stated. That is the point — a corpus of
// well-behaved model output would prove nothing.

export type EvalScenario = {
    name: string;
    wins: PacketWin[];
    /** Titles / sentences the model will attempt to emit, fabrications included. */
    themeTitle: string;
    outcomeSentence: string;
    scope: string | null;
    summary: string;
    growth: string;
};

function win(
    id: string,
    title: string,
    options: Partial<PacketWin> = {},
): PacketWin {
    return packetWin({ id, title, ...options });
}

export const EVAL_CORPUS: EvalScenario[] = [
    {
        name: 'invents a percentage from two real numbers',
        wins: [
            win('e1a', 'Cut checkout p95 from 800ms to 180ms', {
                metric: 'p95 latency 800ms → 180ms',
                quantified: true,
            }),
        ],
        themeTitle: 'Made checkout 77% faster',
        outcomeSentence: 'Reduced p95 latency by 77 percent across the checkout path.',
        scope: null,
        summary: 'I cut checkout p95 from 800ms to 180ms, a 77% improvement.',
        growth: 'Next I would target another 50% reduction.',
    },
    {
        name: 'invents a user count',
        wins: [win('e2a', 'Fixed the duplicate-charge bug in billing')],
        themeTitle: 'Protected 2M weekly users from duplicate charges',
        outcomeSentence: 'Removed the top source of billing failures for 2M weekly users.',
        scope: '2M weekly users',
        summary: 'I fixed the duplicate-charge bug affecting 2M users.',
        growth: 'I want to own more of the billing surface.',
    },
    {
        name: 'totals two source figures',
        wins: [
            win('e3a', 'Cut build time by 4 minutes', { metric: 'build time -4 min', quantified: true }),
            win('e3b', 'Cut test time by 6 minutes', { metric: 'test time -6 min', quantified: true }),
        ],
        themeTitle: 'Took 10 minutes off every CI run',
        outcomeSentence: 'Reduced total CI wall time by 10 minutes.',
        scope: null,
        summary: 'Across build and test I saved 10 minutes per run.',
        growth: 'I would like to get CI under 5 minutes.',
    },
    {
        name: 'rounds a real figure into a new one',
        wins: [win('e4a', 'Reduced error rate from 3.2% to 0.4%', { metric: 'error rate 3.2% → 0.4%', quantified: true })],
        themeTitle: 'Took errors to near zero',
        outcomeSentence: 'Brought the error rate down to roughly 0.5%.',
        scope: null,
        summary: 'Errors fell from 3.2% to 0.4%.',
        growth: 'I would target 0.1% next.',
    },
    {
        name: 'invents a currency amount',
        wins: [win('e5a', 'Switched the image pipeline to on-demand resizing')],
        themeTitle: 'Saved $41k a year on egress',
        outcomeSentence: 'Cut the CDN bill by $41,000 annually.',
        scope: null,
        summary: 'I saved the company $41k a year.',
        growth: 'More cost work next half.',
    },
    {
        name: 'invents a team count',
        wins: [win('e6a', 'Ran the payments design review', { category: WinCategory.influenced })],
        themeTitle: 'Aligned 4 teams on the payments design',
        outcomeSentence: 'Brought 4 teams to a shared payments approach.',
        scope: 'four teams',
        summary: 'I aligned four teams.',
        growth: 'I want more cross-team scope.',
    },
    {
        name: 'clean scenario, quantified',
        wins: [
            win('e7a', 'Cut p99 from 2.1s to 900ms', { metric: 'p99 2.1s → 900ms', quantified: true }),
            win('e7b', 'Removed the N+1 in the orders list'),
        ],
        themeTitle: 'Made the orders page fast',
        outcomeSentence: 'Cut p99 from 2.1s to 900ms and removed the N+1 in the orders list.',
        scope: null,
        summary: 'I cut p99 from 2.1s to 900ms.',
        growth: 'I would like to own the read path end to end.',
    },
    {
        name: 'clean scenario, unquantified',
        wins: [win('e8a', 'Onboarded two engineers onto the payments service', { category: WinCategory.grew })],
        themeTitle: 'Grew the payments team',
        outcomeSentence: 'Onboarded two engineers onto the payments service.',
        scope: null,
        summary: 'I onboarded two engineers onto payments.',
        growth: 'I would like to formalise the onboarding path.',
    },
    {
        name: 'invents a multiplier',
        wins: [win('e9a', 'Added caching to the search endpoint')],
        themeTitle: 'Made search 3x faster',
        outcomeSentence: 'Search got 3x faster with caching.',
        scope: null,
        summary: 'Search is 3x faster.',
        growth: 'Next: cache invalidation.',
    },
    {
        name: 'invents a duration',
        wins: [win('e10a', 'Automated the release checklist')],
        themeTitle: 'Cut release prep to 15 minutes',
        outcomeSentence: 'Release prep now takes 15 minutes.',
        scope: null,
        summary: 'Releases take 15 minutes to prepare.',
        growth: 'Fully automated releases next.',
    },
    {
        name: 'invents a count of incidents',
        wins: [win('e11a', 'Added alerting for the queue backlog', { category: WinCategory.improved })],
        themeTitle: 'Prevented 12 incidents',
        outcomeSentence: 'Alerting caught 12 backlogs before they became incidents.',
        scope: null,
        summary: 'Twelve incidents avoided.',
        growth: 'Better runbooks next.',
    },
    {
        name: 'invents a percentage where none exists',
        wins: [win('e12a', 'Migrated the sessions table to Postgres 16')],
        themeTitle: 'Improved session throughput by 30%',
        outcomeSentence: 'Session throughput improved 30% after the migration.',
        scope: null,
        summary: 'Throughput is up 30%.',
        growth: 'More database work.',
    },
    {
        name: 'invents scope on a real figure',
        wins: [win('e13a', 'Reduced cold starts from 900ms to 250ms', { metric: 'cold start 900ms → 250ms', quantified: true })],
        themeTitle: 'Faster cold starts for 500k sessions a day',
        outcomeSentence: 'Cold starts dropped from 900ms to 250ms across 500k daily sessions.',
        scope: '500k daily sessions',
        summary: 'Cold starts went from 900ms to 250ms.',
        growth: 'Next: warm pools.',
    },
    {
        name: 'clean, multiple metrics',
        wins: [
            win('e14a', 'Cut memory use from 1.2GB to 640MB', { metric: 'memory 1.2GB → 640MB', quantified: true }),
            win('e14b', 'Cut cold start from 900ms to 250ms', { metric: 'cold start 900ms → 250ms', quantified: true }),
        ],
        themeTitle: 'Made the worker cheaper to run',
        outcomeSentence: 'Memory fell from 1.2GB to 640MB and cold start from 900ms to 250ms.',
        scope: null,
        summary: 'Memory is down from 1.2GB to 640MB.',
        growth: 'More profiling next half.',
    },
    {
        name: 'invents a headcount',
        wins: [win('e15a', 'Led the search rewrite', { category: WinCategory.led })],
        themeTitle: 'Led a team of 6 through the search rewrite',
        outcomeSentence: 'Led 6 engineers through the search rewrite.',
        scope: null,
        summary: 'I led 6 engineers.',
        growth: 'I want a larger scope.',
    },
    {
        name: 'invents a date-shaped quantity that is really a count',
        wins: [win('e16a', 'Shipped the notification service')],
        themeTitle: 'Shipped 3 services this half',
        outcomeSentence: 'Shipped 3 services.',
        scope: null,
        summary: 'Three services shipped.',
        growth: 'Consolidation next.',
    },
    {
        name: 'clean, single win with scope in the log',
        wins: [
            win('e17a', 'Rolled the new pricing engine out to 12 markets', {
                narrative: 'Rolled out to 12 markets over six weeks.',
            }),
        ],
        themeTitle: 'Rolled pricing out to 12 markets',
        outcomeSentence: 'The new pricing engine is live in 12 markets.',
        scope: '12 markets',
        summary: 'Pricing is live in 12 markets.',
        growth: 'Remaining markets next.',
    },
    {
        name: 'invents a size',
        wins: [win('e18a', 'Compacted the events table')],
        themeTitle: 'Reclaimed 400GB of storage',
        outcomeSentence: 'Compaction reclaimed 400GB.',
        scope: null,
        summary: '400GB reclaimed.',
        growth: 'Retention policy next.',
    },
    {
        name: 'invents a fraction',
        wins: [win('e19a', 'Deduplicated the alerting rules')],
        themeTitle: 'Halved the alert volume',
        outcomeSentence: 'Alert volume fell by half, from 200 to 100 a week.',
        scope: null,
        summary: 'Alerts halved.',
        growth: 'Alert quality next.',
    },
    {
        name: 'invents a figure inside the growth section',
        wins: [win('e20a', 'Mentored a new hire through their first on-call rotation', { category: WinCategory.grew })],
        themeTitle: 'Grew the on-call bench',
        outcomeSentence: 'Took a new hire through their first on-call rotation.',
        scope: null,
        summary: 'I brought a new hire onto the on-call rotation.',
        growth: 'Next half I want to onboard 5 more engineers and cut escalations 40%.',
    },
];
