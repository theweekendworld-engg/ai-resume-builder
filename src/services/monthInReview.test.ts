/**
 * Month in Review — the composer and the copy (PRD 01 §6.4 / §8.2, §13 R1.4).
 *
 * Runs against the real local Postgres. Only the model is faked, because a unit
 * test must never make a model call — everything else, including the Win rows,
 * the ClaimLinks and the record totals, is real.
 *
 * The two checks the ticket names explicitly are the centre of this file:
 *   - the ENTITY check: the paragraph may reference only the supplied Wins
 *   - the DIGIT check: no number may appear that is absent from them
 * Both are asserted in both directions — a clean paragraph survives, a
 * contaminated one is dropped rather than repaired.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GroundState, WinCategory, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { __testing as aiTesting, type ObjectRunner } from '@/lib/ai/structured';
import { WIN_CLAIM_TYPE } from '@/services/winGraph';
import {
    COMPOSE_MONTH_IN_REVIEW_SYSTEM,
    MIN_WINS_FOR_REVIEW,
    buildComposePrompt,
    buildFacts,
    buildHeadline,
    buildMixSentence,
    buildMonthInReview,
    buildReceipt,
    buildSourceText,
    buildSubject,
    checkDigitGrounding,
    checkTone,
    checkEntityGrounding,
    composeMonthInReview,
    countByCategory,
    dropReason,
    extractEntities,
    formatPeriodKey,
    hasHardNumbers,
    isMonthInReviewDue,
    loadMonthWins,
    loadPersistedReview,
    loadRecordTotals,
    markMonthInReviewSent,
    mixForWinIds,
    parsePeriodKey,
    periodLabel,
    periodRange,
    persistMonthInReview,
    previousPeriodFor,
    selectObservation,
    shiftPeriod,
    visibleMixRows,
    type Period,
    type ReviewWin,
} from '@/services/monthInReview';
import {
    cleanupTestUser,
    makeWin,
    newTestUserId,
} from '@/services/winFixtures.test-utils';

const JULY: Period = { year: 2026, month: 7 };
const NOW = new Date('2026-08-01T09:00:00.000Z');

const users: string[] = [];

function user(label = 'd2'): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

function stubModel(paragraph: string | ((attempt: number) => string)): { calls: () => number } {
    let attempt = 0;
    const runner: ObjectRunner = async () => {
        const value = typeof paragraph === 'function' ? paragraph(attempt) : paragraph;
        attempt += 1;
        return { object: { paragraph: value }, inputTokens: 120, outputTokens: 60 };
    };
    aiTesting.setObjectRunner(runner);
    return { calls: () => attempt };
}

beforeEach(() => {
    aiTesting.setUsageLogger(async () => {});
});

afterEach(async () => {
    aiTesting.reset();
    while (users.length > 0) {
        const id = users.pop();
        if (!id) continue;
        await prisma.monthlyReview.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

// ─────────────────────────────────────────────────────────── fixtures

/**
 * The month from design/02 §E, as real rows: eight confirmed wins, five with a
 * hard number, four `improved`, one `influenced`, none `grew`.
 */
async function seedJulyMonth(userId: string): Promise<void> {
    const specs: Array<{
        title: string;
        narrative: string;
        category: WinCategory;
        day: number;
        impact?: { metric: string; baseline?: string; result?: string };
    }> = [
        {
            title: 'Cut checkout p95 latency from 800ms to 180ms',
            narrative: 'Rewrote the pricing lookup as a batched query with a read-through cache.',
            category: WinCategory.improved,
            day: 3,
            impact: { metric: 'checkout p95 latency', baseline: '800ms', result: '180ms' },
        },
        {
            title: 'Cut nightly reconciliation from 40 minutes to 6 minutes',
            narrative: 'Replaced the row-by-row job with a set-based query.',
            category: WinCategory.improved,
            day: 6,
            impact: { metric: 'reconciliation runtime', baseline: '40 minutes', result: '6 minutes' },
        },
        {
            title: 'Cut the failed-payment retry backlog from 30 a week to 4',
            narrative: 'Added a clearer decline reason so the retry path stopped looping.',
            category: WinCategory.improved,
            day: 9,
        },
        {
            title: 'Removed 4 duplicate cache layers from the pricing path',
            narrative: 'Consolidated onto one cache and deleted the rest.',
            category: WinCategory.improved,
            day: 12,
        },
        {
            title: 'Shipped the webhook replay endpoint',
            narrative: 'Lets the payments team re-deliver a failed webhook without a deploy.',
            category: WinCategory.shipped,
            day: 15,
        },
        {
            title: 'Shipped the decline-reason API',
            narrative: 'Exposes the processor decline code to the checkout client.',
            category: WinCategory.shipped,
            day: 18,
        },
        {
            title: 'Shipped the idempotency key on the charge call, closing 2 double-charge paths',
            narrative: 'The charge call now keys off the client-supplied token.',
            category: WinCategory.shipped,
            day: 21,
        },
        {
            title: 'Ran the payments design review on webhook retries',
            narrative: 'Changed how that team handles retry backoff.',
            category: WinCategory.influenced,
            day: 24,
        },
    ];

    for (const spec of specs) {
        const win = await makeWin({
            userId,
            title: spec.title,
            narrative: spec.narrative,
            category: spec.category,
            occurredAt: new Date(Date.UTC(2026, 6, spec.day)),
            source: WinSource.manual,
            employerId: null,
            impact: spec.impact
                ? {
                    metric: spec.impact.metric,
                    baseline: spec.impact.baseline ?? null,
                    result: spec.impact.result ?? null,
                }
                : null,
        });
        await prisma.win.update({
            where: { id: win.id },
            data: { status: WinStatus.confirmed, confirmedAt: new Date(Date.UTC(2026, 6, spec.day)) },
        });
    }
}

async function groundWin(userId: string, winId: string): Promise<void> {
    const evidence = await prisma.evidence.create({
        data: {
            userId,
            kind: 'url',
            sourceRef: `https://example.com/${winId}`,
            excerpt: 'source',
            confirmedByUser: true,
        },
        select: { id: true },
    });
    await prisma.claimLink.create({
        data: {
            userId,
            claimType: WIN_CLAIM_TYPE,
            claimRefId: winId,
            evidenceId: evidence.id,
            groundState: GroundState.grounded,
        },
    });
}

function fakeWin(overrides: Partial<ReviewWin> = {}): ReviewWin {
    return {
        id: 'w1',
        title: 'Shipped the webhook replay endpoint',
        narrative: '',
        category: WinCategory.shipped,
        occurredAt: new Date('2026-07-15T00:00:00.000Z'),
        skills: [],
        collaborators: [],
        impact: null,
        hasEvidence: false,
        ...overrides,
    };
}

// ═════════════════════════════════════════════════════════════ periods

describe('periods', () => {
    test('round-trips a yyyy-mm key', () => {
        expect(formatPeriodKey(parsePeriodKey('2026-07') as Period)).toBe('2026-07');
        expect(periodLabel({ year: 2026, month: 7 })).toBe('July 2026');
    });

    test('rejects anything that is not a real month', () => {
        for (const bad of ['2026-13', '2026-00', 'july', '26-07', '', null]) {
            expect(parsePeriodKey(bad)).toBeNull();
        }
    });

    test('the range is half-open UTC, so the 31st is in and the 1st of August is not', () => {
        const { start, end } = periodRange(JULY);
        expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
        expect(end.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    test('shiftPeriod crosses a year boundary in both directions', () => {
        expect(shiftPeriod({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
        expect(shiftPeriod({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    });

    test('the previous month is the users own, not UTCs', () => {
        // 19:00 UTC on 31 July is already 00:30 on 1 August in Kolkata, so their
        // July is over and UTC's is not. Getting this wrong sends someone a
        // review of the month they are still in.
        const instant = new Date('2026-07-31T19:00:00.000Z');
        expect(previousPeriodFor('Asia/Kolkata', instant)).toEqual(JULY);
        expect(previousPeriodFor('Etc/UTC', instant)).toEqual({ year: 2026, month: 6 });

        const later = new Date('2026-08-01T02:00:00.000Z');
        expect(previousPeriodFor('Etc/UTC', later)).toEqual(JULY);
    });

    test('due only on the 1st, at the users own digest hour', () => {
        const prefs = { timezone: 'America/New_York', digestHour: 9 };
        expect(isMonthInReviewDue(prefs, new Date('2026-08-01T13:00:00.000Z'))).toBe(true);
        expect(isMonthInReviewDue(prefs, new Date('2026-08-01T14:00:00.000Z'))).toBe(false);
        expect(isMonthInReviewDue(prefs, new Date('2026-08-02T13:00:00.000Z'))).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════ loading

describe('loadMonthWins', () => {
    test('returns only confirmed wins inside the month, with their impact and evidence', async () => {
        const userId = user('load');
        await seedJulyMonth(userId);

        // A draft in July and a confirmed win in June must both stay out.
        await makeWin({
            userId,
            title: 'A draft nobody confirmed',
            occurredAt: new Date(Date.UTC(2026, 6, 20)),
            employerId: null,
        });
        const june = await makeWin({
            userId,
            title: 'Shipped the June thing',
            occurredAt: new Date(Date.UTC(2026, 5, 20)),
            employerId: null,
        });
        await prisma.win.update({
            where: { id: june.id },
            data: { status: WinStatus.confirmed },
        });

        const wins = await loadMonthWins(userId, JULY);
        expect(wins).toHaveLength(8);
        expect(wins.map((win) => win.title)).not.toContain('Shipped the June thing');
        expect(wins.map((win) => win.title)).not.toContain('A draft nobody confirmed');

        const latency = wins.find((win) => win.title.includes('checkout p95'));
        expect(latency?.impact?.baseline).toBe('800ms');
        expect(latency?.impact?.result).toBe('180ms');
        expect(wins.every((win) => win.hasEvidence === false)).toBe(true);

        await groundWin(userId, wins[0].id);
        const regrounded = await loadMonthWins(userId, JULY);
        expect(regrounded.filter((win) => win.hasEvidence)).toHaveLength(1);
    });

    test('record totals count the whole log and the part older than 90 days', async () => {
        const userId = user('totals');
        await seedJulyMonth(userId);
        const old = await makeWin({
            userId,
            title: 'Shipped something in January',
            occurredAt: new Date(Date.UTC(2026, 0, 10)),
            employerId: null,
        });
        await prisma.win.update({ where: { id: old.id }, data: { status: WinStatus.confirmed } });

        const totals = await loadRecordTotals(userId, NOW);
        expect(totals.totalConfirmed).toBe(9);
        // July 3rd is 29 days before 1 Aug; only January clears the 90-day line.
        expect(totals.olderThan90Days).toBe(1);
    });
});

// ═════════════════════════════════════════════════════════════ counting

describe('counting', () => {
    test('hard numbers come from the metric or from the users own words', () => {
        expect(hasHardNumbers(fakeWin())).toBe(false);
        expect(hasHardNumbers(fakeWin({ title: 'Cut latency from 800ms to 180ms' }))).toBe(true);
        expect(hasHardNumbers(fakeWin({ narrative: 'Removed 4 cache layers.' }))).toBe(true);
        expect(
            hasHardNumbers(
                fakeWin({
                    impact: {
                        metric: 'p95 latency',
                        baseline: '800ms',
                        result: '180ms',
                        delta: null,
                        scope: null,
                        timeframe: null,
                    },
                }),
            ),
        ).toBe(true);
        // A metric with no figure in it is not a hard number.
        expect(
            hasHardNumbers(
                fakeWin({
                    impact: {
                        metric: 'developer happiness',
                        baseline: null,
                        result: null,
                        delta: null,
                        scope: null,
                        timeframe: null,
                    },
                }),
            ),
        ).toBe(false);
    });

    test('visibleMixRows keeps every non-zero row and exactly one absent senior signal', () => {
        const rows = visibleMixRows([
            { category: 'shipped', count: 3 },
            { category: 'learned', count: 0 },
            { category: 'led', count: 0 },
            { category: 'influenced', count: 1 },
            { category: 'grew', count: 0 },
        ]);
        // `led` and `grew` are both empty; only the one the mix sentence names shows.
        expect(rows.map((row) => row.category)).toEqual(['shipped', 'influenced', 'grew']);
    });

    test('visibleMixRows shows no empty row when every senior signal is present', () => {
        const rows = visibleMixRows([
            { category: 'shipped', count: 3 },
            { category: 'learned', count: 0 },
            { category: 'grew', count: 1 },
        ]);
        expect(rows.map((row) => row.category)).toEqual(['shipped', 'grew']);
    });
});

// ═════════════════════════════════════════════════════════════ copy

describe('the computed copy blocks', () => {
    test('the headline and the subject are the real counts', () => {
        expect(buildHeadline(8, 5)).toBe('8 wins, 5 with hard numbers');
        expect(buildHeadline(1, 0)).toBe('1 win, 0 with hard numbers');
        expect(buildSubject(JULY, 8, 5)).toBe('July: 8 wins, 5 with numbers');
    });

    test('the mix sentence is the §E sentence, from real counts', () => {
        const mix = countByCategory([
            ...Array.from({ length: 4 }, () => fakeWin({ category: WinCategory.improved })),
            ...Array.from({ length: 3 }, () => fakeWin({ category: WinCategory.shipped })),
            fakeWin({ category: WinCategory.influenced }),
        ]);
        expect(buildMixSentence(mix, 8)).toBe(
            'Four of eight wins were `improved`. Only one was `influenced`, and none were `grew`.',
        );
    });

    test('the mix sentence stays grammatical for a one-win month', () => {
        const mix = countByCategory([fakeWin({ category: WinCategory.shipped })]);
        expect(buildMixSentence(mix, 1)).toBe('One of one win was `shipped`. None were `grew`.');
    });

    test('the receipt states what was drawn on and what is older than 90 days', () => {
        expect(
            buildReceipt({
                period: JULY,
                winCount: 8,
                withEvidence: 5,
                totals: { totalConfirmed: 74, olderThan90Days: 12 },
            }),
        ).toBe(
            'This review drew on 8 wins from July, 5 with evidence. ' +
            'Your record now holds 74 wins — 12 of them from more than 90 days ago.',
        );
    });

    test('the receipt says so honestly when nothing is old yet', () => {
        const line = buildReceipt({
            period: JULY,
            winCount: 3,
            withEvidence: 1,
            totals: { totalConfirmed: 3, olderThan90Days: 0 },
        });
        expect(line).toContain('all from the last 90 days');
        expect(line).not.toContain('more than 90 days ago');
    });

    test('no copy congratulates the user or the tool', () => {
        const copy = [
            buildHeadline(8, 5),
            buildSubject(JULY, 8, 5),
            buildMixSentence(countByCategory([fakeWin()]), 1),
            buildReceipt({
                period: JULY,
                winCount: 8,
                withEvidence: 5,
                totals: { totalConfirmed: 74, olderThan90Days: 12 },
            }),
        ].join(' ');
        expect(copy).not.toContain('!');
        expect(copy.toLowerCase()).not.toContain('great');
        expect(copy.toLowerCase()).not.toContain('congrat');
        // Storage framing is the failure mode M3 exists to prevent.
        expect(copy.toLowerCase()).not.toContain('saved to');
        expect(copy.toLowerCase()).not.toContain('backed up');
    });
});

describe('the honest observation', () => {
    function observationFor(wins: ReviewWin[]) {
        return selectObservation(wins, countByCategory(wins));
    }

    test('names the unmeasured majority first, with the real split', () => {
        const wins = [
            fakeWin({ id: '1', title: 'Cut latency from 800ms to 180ms' }),
            fakeWin({ id: '2', title: 'Shipped the replay endpoint' }),
            fakeWin({ id: '3', title: 'Shipped the decline API' }),
            fakeWin({ id: '4', title: 'Ran the design review' }),
        ];
        const observation = observationFor(wins);
        expect(observation?.kind).toBe('mostly_unquantified');
        expect(observation?.text).toContain('Only 1 of 4 wins carries a number');
        expect(observation?.text).toContain('The other 3');
    });

    test('names the missing business impact when the month is measured but internal', () => {
        const wins = [
            fakeWin({ id: '1', title: 'Cut checkout p95 latency from 800ms to 180ms', category: WinCategory.improved }),
            fakeWin({ id: '2', title: 'Cut the nightly job from 40 minutes to 6 minutes', category: WinCategory.improved }),
            fakeWin({ id: '3', title: 'Removed 4 duplicate cache layers', category: WinCategory.influenced }),
        ];
        const observation = observationFor(wins);
        expect(observation?.kind).toBe('no_business_impact');
        expect(observation?.text).toBe(
            'None of your wins this month mention business impact — revenue, cost, or user numbers. ' +
            "For a Staff-level case that's usually required.",
        );
    });

    test('does not claim missing business impact when a win names revenue', () => {
        const wins = [
            fakeWin({ id: '1', title: 'Cut checkout p95 latency from 800ms to 180ms' }),
            fakeWin({ id: '2', title: 'Recovered 3 percent of failed-payment revenue', category: WinCategory.improved }),
            fakeWin({ id: '3', title: 'Ran the payments design review', category: WinCategory.influenced }),
        ];
        expect(observationFor(wins)?.kind).not.toBe('no_business_impact');
    });

    test('returns nothing rather than a generic line when every rule is satisfied', () => {
        const wins = [
            fakeWin({ id: '1', title: 'Cut cost per order from 40 cents to 12 cents', category: WinCategory.saved }),
            fakeWin({ id: '2', title: 'Grew 2 engineers onto the on-call rota', category: WinCategory.grew }),
            fakeWin({ id: '3', title: 'Ran 3 design reviews for the payments team', category: WinCategory.influenced }),
            fakeWin({ id: '4', title: 'Shipped 1 replay endpoint', category: WinCategory.shipped }),
        ];
        expect(observationFor(wins)).toBeNull();
    });

    test('every observation is specific: it carries a count or a category name', () => {
        const scenarios: ReviewWin[][] = [
            [fakeWin({ id: 'a' }), fakeWin({ id: 'b' }), fakeWin({ id: 'c' })],
            [
                fakeWin({ id: 'a', title: 'Cut latency 800ms to 180ms' }),
                fakeWin({ id: 'b', title: 'Cut runtime 40 minutes to 6 minutes' }),
                fakeWin({ id: 'c', title: 'Removed 4 cache layers' }),
            ],
        ];
        for (const wins of scenarios) {
            const observation = observationFor(wins);
            expect(observation).not.toBeNull();
            const text = observation?.text ?? '';
            // Specific means it points at something in THIS month: a count, a
            // category name, or the month itself. Never a mood.
            expect(/\d|`|this month/.test(text)).toBe(true);
            expect(text).not.toContain('!');
            expect(text.toLowerCase()).not.toContain('keep it up');
            expect(text.toLowerCase()).not.toContain('great');
        }
    });
});

// ═══════════════════════════════════════════════ the two grounding checks

describe('the entity check (PRD 01 §13 R1.4)', () => {
    const wins = [
        fakeWin({
            id: '1',
            title: 'Cut checkout p95 latency from 800ms to 180ms',
            narrative: 'Rewrote the pricing lookup in patronus/api.',
            collaborators: ['Priya'],
        }),
        fakeWin({ id: '2', title: 'Ran the payments design review on webhook retries' }),
    ];
    const source = buildSourceText(wins);

    test('finds the referring expressions and ignores grammar', () => {
        const entities = extractEntities(
            'The checkout work in patronus/api cut p95 latency. Priya reviewed it, and GraphQL was not involved.',
        );
        expect(entities).toContain('patronus/api');
        expect(entities).toContain('p95');
        expect(entities).toContain('Priya');
        expect(entities).toContain('GraphQL');
        expect(entities).not.toContain('The');
        expect(entities).not.toContain('checkout');
    });

    test('passes a paragraph built only from the supplied wins', () => {
        const paragraph =
            'The checkout latency work in patronus/api took p95 from 800ms to 180ms, and the ' +
            'payments design review you ran changed how that team handles webhook retries. Priya reviewed both.';
        const check = checkEntityGrounding(paragraph, source);
        expect(check.unsupported).toEqual([]);
        expect(check.ok).toBe(true);
    });

    test('fails on a system, a person and a company that were never supplied', () => {
        const check = checkEntityGrounding(
            'You migrated Kubernetes for Acme, with help from Dmitri.',
            source,
        );
        expect(check.ok).toBe(false);
        expect(check.unsupported).toContain('Kubernetes');
        expect(check.unsupported).toContain('Acme');
        expect(check.unsupported).toContain('Dmitri');
    });
});

describe('the digit check', () => {
    const source = buildSourceText([
        fakeWin({ id: '1', title: 'Cut checkout p95 latency from 800ms to 180ms' }),
    ]);

    test('passes digits that appear in the wins', () => {
        expect(checkDigitGrounding('p95 fell from 800ms to 180ms.', source).ok).toBe(true);
    });

    test('fails a derived percentage and an invented count', () => {
        const check = checkDigitGrounding('That is a 77% improvement across 12 services.', source);
        expect(check.ok).toBe(false);
        expect(check.unsupported).toContain('77');
        expect(check.unsupported).toContain('12');
    });

    test('is insensitive to thousands separators on either side', () => {
        const withComma = buildSourceText([fakeWin({ id: '1', title: 'Handled 1,200,000 requests' })]);
        expect(checkDigitGrounding('1200000 requests', withComma).ok).toBe(true);
        expect(checkDigitGrounding('1,200,000 requests', withComma).ok).toBe(true);
    });

    test('the computed counts are legitimate source material', () => {
        const wins = [fakeWin({ id: '1' }), fakeWin({ id: '2' }), fakeWin({ id: '3' })];
        const facts = buildFacts({ winCount: 3, quantifiedCount: 0, mix: countByCategory(wins) });
        expect(checkDigitGrounding('All 3 of them shipped.', buildSourceText(wins, facts)).ok).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════ composeMonthInReview

describe('composeMonthInReview', () => {
    const wins = [
        fakeWin({
            id: '1',
            title: 'Cut checkout p95 latency from 800ms to 180ms',
            narrative: 'Rewrote the pricing lookup as a batched query.',
            category: WinCategory.improved,
        }),
        fakeWin({ id: '2', title: 'Ran the payments design review on webhook retries', category: WinCategory.influenced }),
        fakeWin({ id: '3', title: 'Shipped the webhook replay endpoint', category: WinCategory.shipped }),
    ];

    test('the system prompt states the four constraints that matter', () => {
        const lowered = COMPOSE_MONTH_IN_REVIEW_SYSTEM.toLowerCase();
        expect(lowered).toContain('only the supplied wins exist');
        expect(lowered).toContain('never invent a number');
        expect(lowered).toContain('do not congratulate');
        expect(lowered).toContain('exclamation');
    });

    test('the prompt carries every win and defaults the voice to plain declarative prose', () => {
        const prompt = buildComposePrompt({ period: JULY, wins, facts: ['3 confirmed wins this month'] });
        for (const win of wins) expect(prompt).toContain(win.title);
        expect(prompt).toContain('plain declarative prose');
        expect(prompt.toLowerCase()).not.toContain('enthusiastic');
    });

    test('a grounded paragraph survives both checks', async () => {
        stubModel(
            'The checkout latency work took p95 from 800ms to 180ms, and the payments design ' +
            'review you ran changed how that team handles webhook retries.',
        );
        const result = await composeMonthInReview({ userId: user('compose'), period: JULY, wins });
        expect(result.entityCheck.ok).toBe(true);
        expect(result.digitCheck.ok).toBe(true);
        expect(result.degraded).toBe(false);
        expect(result.paragraph).toContain('800ms to 180ms');
    });

    test('a paragraph naming an unsupplied system is DROPPED, not repaired', async () => {
        stubModel('You migrated the platform to Kubernetes and cut p95 to 180ms.');
        const result = await composeMonthInReview({ userId: user('entity'), period: JULY, wins });
        expect(result.entityCheck.ok).toBe(false);
        expect(result.entityCheck.unsupported).toContain('Kubernetes');
        expect(result.paragraph).toBeNull();
        expect(result.degraded).toBe(true);
    });

    test('the digit check catches a figure the numeric guard is not asked to police', async () => {
        // The guard ignores four-digit years by default (`enforceYears: false`),
        // so a year the user never logged is exactly the fabrication that reaches
        // the digit check. It is why the digit check exists alongside the guard.
        stubModel('The checkout work finished the 2019 replatform and took p95 to 180ms.');
        const result = await composeMonthInReview({ userId: user('digit'), period: JULY, wins });
        expect(result.digitCheck.ok).toBe(false);
        expect(result.digitCheck.unsupported).toContain('2019');
        expect(result.paragraph).toBeNull();
        expect(result.degraded).toBe(true);
    });

    test('a derived percentage is stripped by the guard and never shipped as an empty paragraph', async () => {
        stubModel('The checkout work was a 77% improvement.');
        const result = await composeMonthInReview({ userId: user('pct'), period: JULY, wins });
        expect(result.paragraph).toBeNull();
        expect(result.degraded).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════ buildMonthInReview

describe('buildMonthInReview', () => {
    test('assembles the five blocks of §E from a real July', async () => {
        const userId = user('build');
        await seedJulyMonth(userId);
        const wins = await loadMonthWins(userId, JULY);
        for (const win of wins.slice(0, 5)) await groundWin(userId, win.id);

        stubModel(
            'The checkout latency work took p95 from 800ms to 180ms and removed the top source of ' +
            'payment support tickets, and the payments design review you ran changed how that team ' +
            'handles webhook retries.',
        );

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review).not.toBeNull();
        if (!review) return;

        expect(review.periodKey).toBe('2026-07');
        expect(review.label).toBe('July 2026');
        expect(review.winCount).toBe(8);
        expect(review.quantifiedCount).toBe(5);
        expect(review.withEvidence).toBe(5);
        expect(review.headline).toBe('8 wins, 5 with hard numbers');
        expect(review.subject).toBe('July: 8 wins, 5 with numbers');
        expect(review.mixSentence).toBe(
            'Four of eight wins were `improved`. Only one was `influenced`, and none were `grew`.',
        );
        expect(review.paragraph).toContain('800ms to 180ms');
        expect(review.observation?.kind).toBe('no_business_impact');
        expect(review.receipt).toBe(
            'This review drew on 8 wins from July, 5 with evidence. ' +
            'Your record now holds 8 wins, all from the last 90 days.',
        );
        expect(review.degraded).toBe(false);
    });

    test('a model outage costs the paragraph and nothing else', async () => {
        const userId = user('outage');
        await seedJulyMonth(userId);
        aiTesting.setObjectRunner(async () => {
            throw new Error('provider unavailable');
        });

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review?.paragraph).toBeNull();
        expect(review?.degraded).toBe(true);
        expect(review?.headline).toBe('8 wins, 5 with hard numbers');
        expect(review?.receipt).toContain('This review drew on 8 wins from July');
    });

    test('compose:false spends nothing and still produces every computed block', async () => {
        const userId = user('nocompose');
        await seedJulyMonth(userId);
        let calls = 0;
        aiTesting.setObjectRunner(async () => {
            calls += 1;
            return { object: { paragraph: 'x' }, inputTokens: 0, outputTokens: 0 };
        });

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW, compose: false });
        expect(calls).toBe(0);
        expect(review?.paragraph).toBeNull();
        expect(review?.mixSentence.length).toBeGreaterThan(0);
        expect(review?.costUsd).toBe(0);
    });

    test('a month with no confirmed wins has no review at all', async () => {
        const userId = user('empty');
        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review).toBeNull();
    });

    test('the threshold the job enforces is the specified one', () => {
        expect(MIN_WINS_FOR_REVIEW).toBe(3);
    });
});

// ═══════════════════════════════════════════════════════════ persistence

describe('the MonthlyReview row', () => {
    test('round-trips every block, nulls included', async () => {
        const userId = user('persist');
        await seedJulyMonth(userId);
        stubModel('The pricing lookup work took the path from 800ms to 180ms.');

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review).not.toBeNull();
        if (!review) return;

        await persistMonthInReview(userId, review);
        const stored = await loadPersistedReview(userId, '2026-07');

        expect(stored?.headline).toBe(review.headline);
        expect(stored?.paragraph).toBe(review.paragraph);
        expect(stored?.observation).toBe(review.observation?.text ?? null);
        expect(stored?.mixSentence).toBe(review.mixSentence);
        expect(stored?.receipt).toBe(review.receipt);
        expect(stored?.winCount).toBe(8);
        expect(stored?.quantifiedCount).toBe(5);
        expect(stored?.winIds.sort()).toEqual(review.wins.map((win) => win.id).sort());
        // Composing is not sending.
        expect(stored?.sentAt).toBeNull();
        expect(stored?.degraded).toBe(false);
    });

    test('a dropped paragraph persists as null and degraded, not as an empty string', async () => {
        const userId = user('persist-drop');
        await seedJulyMonth(userId);
        stubModel('You migrated the platform to Kubernetes.');

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review?.paragraph).toBeNull();
        expect(review?.dropped).toBe('entity');

        await persistMonthInReview(userId, review!);
        const stored = await loadPersistedReview(userId, '2026-07');
        expect(stored?.paragraph).toBeNull();
        expect(stored?.degraded).toBe(true);
        // Every computed block survived the drop.
        expect(stored?.headline).toBe('8 wins, 5 with hard numbers');
        expect(stored?.observation).toContain('business impact');
    });

    test('upserting twice leaves one row and never un-sends it', async () => {
        const userId = user('persist-twice');
        await seedJulyMonth(userId);
        stubModel('The pricing lookup work took the path from 800ms to 180ms.');

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        await persistMonthInReview(userId, review!);
        await markMonthInReviewSent(userId, '2026-07', new Date('2026-08-01T09:00:00.000Z'));

        await persistMonthInReview(userId, review!);
        await markMonthInReviewSent(userId, '2026-07', new Date('2026-08-01T18:00:00.000Z'));

        expect(await prisma.monthlyReview.count({ where: { userId } })).toBe(1);
        const stored = await loadPersistedReview(userId, '2026-07');
        expect(stored?.sentAt?.toISOString()).toBe('2026-08-01T09:00:00.000Z');
    });

    test('mixForWinIds counts the wins the review was built from', async () => {
        const userId = user('mix-ids');
        await seedJulyMonth(userId);
        const wins = await loadMonthWins(userId, JULY);

        const full = await mixForWinIds(userId, wins.map((win) => win.id));
        const byCategory = new Map(full.map((row) => [row.category, row.count]));
        expect(byCategory.get(WinCategory.improved)).toBe(4);
        expect(byCategory.get(WinCategory.shipped)).toBe(3);
        expect(byCategory.get(WinCategory.influenced)).toBe(1);
        expect(byCategory.get(WinCategory.grew)).toBe(0);

        // A win deleted since simply drops out; the bars never show a ghost row.
        const subset = await mixForWinIds(userId, [wins[0].id]);
        expect(subset.reduce((sum, row) => sum + row.count, 0)).toBe(1);
        expect(await mixForWinIds(userId, [])).toHaveLength(8);
    });
});

// ══════════════════════════════════════════════════════ drop instrumentation

describe('paragraph drops are visible, not inferred', () => {
    const wins = [
        fakeWin({ id: '1', title: 'Cut checkout p95 latency from 800ms to 180ms' }),
        fakeWin({ id: '2', title: 'Ran the payments design review on webhook retries' }),
        fakeWin({ id: '3', title: 'Shipped the webhook replay endpoint' }),
    ];

    test('dropReason distinguishes the three failure modes', () => {
        const ok = { ok: true, unsupported: [] };
        const bad = { ok: false, unsupported: ['x'] };
        expect(dropReason({ entityCheck: bad, digitCheck: ok, paragraph: 'x' })).toBe('entity');
        expect(dropReason({ entityCheck: ok, digitCheck: bad, paragraph: 'x' })).toBe('digit');
        expect(dropReason({ entityCheck: bad, digitCheck: bad, paragraph: 'x' })).toBe('entity_and_digit');
        // Both checks pass on '': the numeric guard already blanked the field.
        expect(dropReason({ entityCheck: ok, digitCheck: ok, paragraph: '' })).toBe('guard_stripped');
    });

    test('an entity drop writes one ai_guard_violation naming what was unsupported', async () => {
        const userId = user('track-entity');
        stubModel('You migrated the platform to Kubernetes for Acme.');
        const result = await composeMonthInReview({ userId, period: JULY, wins });

        expect(result.dropped).toBe('entity');

        const events = await prisma.funnelEvent.findMany({
            where: { userId, type: 'ai_guard_violation' },
            select: { payload: true },
        });
        expect(events).toHaveLength(1);
        const payload = events[0].payload as {
            feature: string; surface: string; reason: string; unsupportedEntities: string[];
        };
        expect(payload.feature).toBe('month_in_review');
        expect(payload.surface).toBe('paragraph');
        expect(payload.reason).toBe('entity');
        expect(payload.unsupportedEntities).toContain('Kubernetes');
        expect(payload.unsupportedEntities).toContain('Acme');
    });

    test('a digit drop is recorded with its reason', async () => {
        const userId = user('track-digit');
        stubModel('The checkout work finished the 2019 replatform and took p95 to 180ms.');
        const result = await composeMonthInReview({ userId, period: JULY, wins });

        expect(result.dropped).toBe('digit');
        const events = await prisma.funnelEvent.findMany({
            where: { userId, type: 'ai_guard_violation' },
            select: { payload: true },
        });
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({ reason: 'digit' });
        expect((events[0].payload as { unsupportedDigits: string[] }).unsupportedDigits).toContain('2019');
    });

    test('a grounded paragraph records nothing', async () => {
        const userId = user('track-clean');
        stubModel('The checkout work took p95 from 800ms to 180ms.');
        const result = await composeMonthInReview({ userId, period: JULY, wins });

        expect(result.dropped).toBeNull();
        expect(
            await prisma.funnelEvent.count({ where: { userId, type: 'ai_guard_violation' } }),
        ).toBe(0);
    });

    test('a model outage is reported as compose_failed, not as a check failure', async () => {
        const userId = user('track-outage');
        await seedJulyMonth(userId);
        aiTesting.setObjectRunner(async () => {
            throw new Error('provider unavailable');
        });

        const review = await buildMonthInReview({ userId, period: JULY, now: NOW });
        expect(review?.dropped).toBe('compose_failed');
        expect(review?.paragraph).toBeNull();
        expect(
            await prisma.funnelEvent.count({ where: { userId, type: 'ai_guard_violation' } }),
        ).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tone enforcement.
//
// Added after a journey test proved the rule was prompt-only: the entity and
// digit checks reason about facts, not about tone, so a paragraph could be
// entirely true and still congratulate the user — and be emailed verbatim.
// ---------------------------------------------------------------------------

describe('checkTone', () => {
    test('the exact paragraph that used to slip through is now caught', () => {
        // Verbatim from the journey report. Both grounding checks pass on it.
        const paragraph = 'You had a great month! The checkout lookup went from 800ms to 180ms.';
        const result = checkTone(paragraph);

        expect(result.ok).toBe(false);
        expect(result.unsupported).toContain('!');
        expect(result.unsupported).toContain('great month');
    });

    test('praise mid-sentence is caught, not only at the start', () => {
        // The accidental defence was the entity check rejecting a capitalised
        // opener it did not recognise. That never fired mid-sentence.
        expect(checkTone('The migration landed and that is impressive work.').ok).toBe(false);
        expect(checkTone('Shipped it, congrats to you.').ok).toBe(false);
    });

    test('an exclamation mark alone is enough', () => {
        expect(checkTone('You shipped the checkout rewrite!').ok).toBe(false);
    });

    test('plain declarative prose passes', () => {
        const paragraph =
            'July was your reliability month. The checkout latency work took p95 from 800ms ' +
            'to 180ms, and the payments design review changed how that team handles retries.';
        expect(checkTone(paragraph)).toEqual({ ok: true, unsupported: [] });
    });

    test('a factual word that merely contains a banned substring is not a false positive', () => {
        // "outstanding" is banned; "outstanding tickets" is a real status word.
        // Documents current behaviour: substring matching flags it. Fail-closed
        // costs a paragraph here, which is the direction we want to err.
        expect(checkTone('Cleared the outstanding tickets.').ok).toBe(false);
    });
});

describe('dropReason ranks tone below the factual checks', () => {
    const ok = { ok: true, unsupported: [] };
    const bad = { ok: false, unsupported: ['x'] };

    test('a factual failure outranks a tone failure', () => {
        expect(dropReason({ entityCheck: bad, digitCheck: ok, toneCheck: bad, paragraph: 'p' }))
            .toBe('entity');
        expect(dropReason({ entityCheck: ok, digitCheck: bad, toneCheck: bad, paragraph: 'p' }))
            .toBe('digit');
    });

    test('tone is reported when the facts are sound', () => {
        expect(dropReason({ entityCheck: ok, digitCheck: ok, toneCheck: bad, paragraph: 'p' }))
            .toBe('tone');
    });

    test('an empty paragraph is still guard_stripped', () => {
        expect(dropReason({ entityCheck: ok, digitCheck: ok, toneCheck: ok, paragraph: '' }))
            .toBe('guard_stripped');
    });
});
