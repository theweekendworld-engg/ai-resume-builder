/**
 * THESIS TEST 3 (PRD 08 §10, PRD 01 §8.1 + §13, ADR-6).
 *
 *   No drafted Win contains a number absent from its source text.
 *
 * The check below is deliberately *independent* of the guard's own quantity
 * parser: it pulls every digit sequence out of the produced draft with a dumb
 * regex and asserts each one appears verbatim in the source. If the guard's
 * notion of "a quantity" ever narrows, this test still catches the fabrication.
 *
 * The model is stubbed (ADR-6's seam), because what is under test is *our*
 * wiring — that `structureWin` declares the right source text and the right
 * guarded fields, and that a stripped `impact` collapses to `quantified:false`
 * rather than shipping an empty-string metric.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { WinCategory } from '@prisma/client';
import { __testing as aiTesting, type ObjectRunner } from '@/lib/ai/structured';
import {
    IMPACT_ANSWER_SYSTEM,
    NEAR_DUPLICATE_THRESHOLD,
    NEAR_DUPLICATE_WINDOW_DAYS,
    STRUCTURE_WIN_SYSTEM,
    buildImpactAnswerPrompt,
    buildStructureWinPrompt,
    mergeProposalCode,
    parseImpactAnswer,
    parseMergeProposalCode,
    resolveOccurredAt,
    selectNearDuplicate,
    statesAQuantity,
    structureWin,
    toStructuredDraft,
    type WinDraft,
} from '@/services/winDrafting';

const USER = 'test-worklog-drafting';

function draft(overrides: Partial<WinDraft> = {}): WinDraft {
    return {
        title: 'Cut checkout latency',
        narrative: 'Rewrote the pricing lookup as a batched query.',
        category: 'improved',
        occurredAtHint: 'today',
        explicitDate: null,
        skills: ['postgres'],
        collaborators: [],
        suggestedSensitivity: 'shareable',
        quantified: false,
        impact: null,
        quantifyPrompt: 'How much faster?',
        confidence: 0.8,
        ...overrides,
    };
}

function stubModel(output: WinDraft | ((attempt: number) => WinDraft)): void {
    let attempt = 0;
    const runner: ObjectRunner = async () => {
        const object = typeof output === 'function' ? output(attempt) : output;
        attempt += 1;
        return { object, inputTokens: 100, outputTokens: 50 };
    };
    aiTesting.setObjectRunner(runner);
}

beforeEach(() => {
    // Never touch ApiUsageLog from a unit test.
    aiTesting.setUsageLogger(async () => {});
});

afterEach(() => {
    aiTesting.reset();
});

/** Every digit run in the draft's free text and impact fields. */
function digitsIn(values: (string | null | undefined)[]): string[] {
    const out: string[] = [];
    for (const value of values) {
        if (!value) continue;
        for (const match of value.matchAll(/\d+(?:[.,]\d+)*/g)) out.push(match[0]);
    }
    return out;
}

function draftDigits(result: WinDraft): string[] {
    return digitsIn([
        result.title,
        result.narrative,
        result.impact?.metric,
        result.impact?.baseline,
        result.impact?.result,
        result.impact?.delta,
        result.impact?.scope,
        result.impact?.timeframe,
    ]);
}

// ─────────────────────────────────────────────────────────── the corpus
//
// Each entry is a source text plus what the model "returns" for it. Several
// entries fabricate on purpose — a corpus of only honest outputs proves nothing.

type Case = { name: string; source: string; modelOutput: WinDraft };

const CORPUS: Case[] = [
    {
        name: 'honest: numbers copied verbatim',
        source: 'fixed the checkout timeout thing, p95 went from 800ms to 180ms',
        modelOutput: draft({
            title: 'Cut checkout p95 latency from 800ms to 180ms',
            narrative: 'Reduced checkout p95 from 800ms to 180ms.',
            quantified: true,
            impact: {
                metric: 'checkout p95 latency',
                baseline: '800ms',
                result: '180ms',
                delta: null,
                scope: null,
                timeframe: null,
            },
        }),
    },
    {
        name: 'fabricated: a derived percentage that is nowhere in the source',
        source: 'fixed the checkout timeout thing, p95 went from 800ms to 180ms',
        modelOutput: draft({
            title: 'Cut checkout p95 latency by 77%',
            narrative: 'A 77% reduction in checkout p95 latency.',
            quantified: true,
            impact: {
                metric: 'checkout p95 latency',
                baseline: '800ms',
                result: '180ms',
                delta: '-77%',
                scope: null,
                timeframe: null,
            },
        }),
    },
    {
        name: 'fabricated: an invented scope',
        source: 'rewrote the pricing lookup as a batched query',
        modelOutput: draft({
            title: 'Rewrote the pricing lookup as a batched query',
            narrative: 'Rewrote the pricing lookup as a batched query.',
            quantified: true,
            impact: {
                metric: 'requests served',
                baseline: null,
                result: null,
                delta: null,
                scope: '2M requests/day',
                timeframe: null,
            },
        }),
    },
    {
        name: 'fabricated: a plausible-sounding team size',
        source: 'ran the migration project for the payments team',
        modelOutput: draft({
            title: 'Led the payments migration across a team of 6',
            narrative: 'Owned the migration for the payments team of 6 engineers.',
            category: 'led',
            quantified: false,
            impact: null,
        }),
    },
    {
        name: 'honest: no numbers at all',
        source: 'unblocked the payments team on webhook retries in a design review',
        modelOutput: draft({
            title: 'Unblocked the payments team on webhook retries',
            narrative: 'A design review comment changed their retry approach.',
            category: 'influenced',
            quantified: false,
            impact: null,
            quantifyPrompt: 'How many teams?',
        }),
    },
    {
        name: 'fabricated: a rounded-up figure',
        source: 'onboarding used to take 11 days, now it takes 7',
        modelOutput: draft({
            title: 'Cut onboarding from 12 days to 7',
            narrative: 'Onboarding dropped from 12 days to 7 days.',
            quantified: true,
            impact: {
                metric: 'onboarding time',
                baseline: '12 days',
                result: '7 days',
                delta: null,
                scope: null,
                timeframe: null,
            },
        }),
    },
    {
        name: 'honest: currency copied verbatim',
        source: 'killed the unused staging cluster, saves about $4,200 a month',
        modelOutput: draft({
            title: 'Removed the unused staging cluster',
            narrative: 'Decommissioning saves $4,200 a month.',
            category: 'saved',
            quantified: true,
            impact: {
                metric: 'infrastructure spend',
                baseline: null,
                result: '$4,200 a month',
                delta: null,
                scope: null,
                timeframe: null,
            },
        }),
    },
    {
        name: 'fabricated: an invented multiplier',
        source: 'added a read-through cache in front of the pricing service',
        modelOutput: draft({
            title: 'Made pricing lookups 3x faster with a read-through cache',
            narrative: 'A read-through cache made pricing lookups 3x faster.',
            quantified: true,
            impact: null,
        }),
    },
];

describe('THESIS 3 — no drafted Win contains a number absent from its source', () => {
    for (const entry of CORPUS) {
        test(entry.name, async () => {
            stubModel(entry.modelOutput);
            const result = await structureWin({ userId: USER, text: entry.source });

            for (const digits of draftDigits(result.draft)) {
                expect(entry.source).toContain(digits);
            }
        });
    }

    test('the whole corpus, in one assertion', async () => {
        const offenders: string[] = [];
        for (const entry of CORPUS) {
            stubModel(entry.modelOutput);
            const result = await structureWin({ userId: USER, text: entry.source });
            for (const digits of draftDigits(result.draft)) {
                if (!entry.source.includes(digits)) offenders.push(`${entry.name}: "${digits}"`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('a stripped impact collapses to quantified:false, not an empty metric', async () => {
        const entry = CORPUS[1]; // the derived -77%
        stubModel(entry.modelOutput);
        const result = await structureWin({ userId: USER, text: entry.source });

        expect(result.degraded).toBe(true);
        expect(result.draft.impact).toBeNull();
        expect(result.draft.quantified).toBe(false);
        // Rule 4: when there is no number, we ask for one.
        expect(result.draft.quantifyPrompt).not.toBeNull();
        expect((result.draft.quantifyPrompt ?? '').split(/\s+/).length).toBeLessThanOrEqual(8);
    });

    test('quantified:true with impact:null is normalized to quantified:false (rule 1)', async () => {
        stubModel(draft({ quantified: true, impact: null }));
        const result = await structureWin({ userId: USER, text: 'shipped the thing' });
        expect(result.draft.quantified).toBe(false);
        expect(result.draft.impact).toBeNull();
    });

    test('a title blanked by the guard falls back to the source text, never to empty', async () => {
        stubModel(draft({ title: 'Saved 40% of the budget', narrative: 'Saved 40%.', quantified: false, impact: null }));
        const result = await structureWin({ userId: USER, text: 'trimmed some spend on the reporting job' });
        expect(result.draft.title.length).toBeGreaterThan(0);
        expect(draftDigits(result.draft)).toEqual([]);
    });

    test('the guard is actually wired with the source text and the three fields', async () => {
        // A corrective retry only happens when the guard fires, so observing a
        // second call proves the guard ran against our declared source.
        let calls = 0;
        aiTesting.setObjectRunner(async () => {
            calls += 1;
            return { object: CORPUS[1].modelOutput, inputTokens: 10, outputTokens: 10 };
        });
        await structureWin({ userId: USER, text: CORPUS[1].source });
        expect(calls).toBeGreaterThan(1);
    });
});

// ─────────────────────────────────────────────────────────── prompt + shaping

describe('the structureWin contract (PRD 01 §8.1)', () => {
    test('the system prompt states all five non-negotiable rules', () => {
        const lowered = STRUCTURE_WIN_SYSTEM.toLowerCase();
        expect(lowered).toContain('never invent a number');
        expect(lowered).toContain('never invent a scope');
        expect(lowered).toContain('successfully');
        expect(lowered).toContain('five words');
        expect(lowered).toContain('0.3');
    });

    test('the prompt carries the raw text and the reference date', () => {
        const prompt = buildStructureWinPrompt({
            text: 'fixed the checkout timeout',
            now: new Date('2026-08-01T12:00:00.000Z'),
        });
        expect(prompt).toContain('fixed the checkout timeout');
        expect(prompt).toContain('2026-08-01');
    });

    test('date hints resolve to the work date, not the logging date', () => {
        const now = new Date('2026-08-01T12:00:00.000Z'); // a Saturday
        expect(resolveOccurredAt(draft({ occurredAtHint: 'today' }), now).toISOString().slice(0, 10))
            .toBe('2026-08-01');
        expect(resolveOccurredAt(draft({ occurredAtHint: 'yesterday' }), now).toISOString().slice(0, 10))
            .toBe('2026-07-31');
        expect(
            resolveOccurredAt(draft({ occurredAtHint: 'explicit', explicitDate: '2026-07-14' }), now)
                .toISOString()
                .slice(0, 10),
        ).toBe('2026-07-14');
        // An explicit date in the future is not a work date.
        expect(
            resolveOccurredAt(draft({ occurredAtHint: 'explicit', explicitDate: '2027-01-01' }), now)
                .toISOString()
                .slice(0, 10),
        ).toBe('2026-08-01');
    });

    test('confidence below 0.3 keeps the raw text as the title (rule 5)', async () => {
        stubModel(draft({ confidence: 0.1, title: 'Something happened', narrative: '' }));
        const result = await structureWin({ userId: USER, text: 'idk, tuesday was weird but productive' });
        expect(result.draft.confidence).toBeLessThan(0.3);
        expect(result.draft.title).toBe('idk, tuesday was weird but productive');
    });

    test('the category is always one of the eight', async () => {
        stubModel(draft({ category: 'grew' }));
        const result = await structureWin({ userId: USER, text: 'mentored someone' });
        expect(Object.values(WinCategory)).toContain(result.draft.category as WinCategory);
    });
});

// ─────────────────────────────────────────────────── the un-persisted draft

describe('toStructuredDraft (quick capture writes nothing until submit)', () => {
    test('resolves the date and drops impact when nothing was quantified', () => {
        const now = new Date('2026-08-01T12:00:00.000Z');
        const structured = toStructuredDraft(
            draft({ occurredAtHint: 'yesterday', quantified: false, impact: null }),
            now,
        );
        expect(structured.occurredAt.toISOString().slice(0, 10)).toBe('2026-07-31');
        expect(structured.impact).toBeNull();
        expect(structured.quantified).toBe(false);
        expect(structured.quantifyPrompt).toBe('How much faster?');
    });

    test('carries the impact through when a real quantity was captured', () => {
        const structured = toStructuredDraft(
            draft({
                quantified: true,
                impact: {
                    metric: 'checkout p95 latency',
                    baseline: '800ms',
                    result: '180ms',
                    delta: null,
                    scope: null,
                    timeframe: null,
                },
            }),
            new Date('2026-08-01T12:00:00.000Z'),
        );
        expect(structured.impact?.baseline).toBe('800ms');
        expect(structured.suggestedSensitivity).toBe('shareable');
    });
});

// ─────────────────────────────────────────────────── the quantify answer

describe('parseImpactAnswer — the no-invention rule at full force', () => {
    const win = {
        title: 'Cut checkout p95 latency',
        narrative: 'Rewrote the pricing lookup as a batched query.',
    };

    function stubImpact(output: Record<string, string | null>): { calls: () => number } {
        let calls = 0;
        aiTesting.setObjectRunner(async () => {
            calls += 1;
            return { object: output, inputTokens: 10, outputTokens: 10 };
        });
        return { calls: () => calls };
    }

    test('an answer with no figure never reaches the model', async () => {
        const probe = stubImpact({ metric: 'x', baseline: null, result: null, delta: null, scope: null, timeframe: null });
        const result = await parseImpactAnswer({ userId: USER, answer: 'quite a lot faster', win });

        expect(result.kind).toBe('no_quantity');
        // The strongest guarantee available: nothing to hallucinate from.
        expect(probe.calls()).toBe(0);
    });

    test('an honest answer becomes an impact with the user\'s own figures', async () => {
        stubImpact({
            metric: 'checkout p95 latency',
            baseline: '800ms',
            result: '180ms',
            delta: null,
            scope: null,
            timeframe: null,
        });
        const result = await parseImpactAnswer({
            userId: USER,
            answer: 'went from 800ms to 180ms',
            win,
        });

        expect(result.kind).toBe('impact');
        if (result.kind !== 'impact') return;
        expect(result.impact).toMatchObject({ baseline: '800ms', result: '180ms', delta: null });
    });

    test('a derived percentage is stripped; the honest figures survive', async () => {
        stubImpact({
            metric: 'checkout p95 latency',
            baseline: '800ms',
            result: '180ms',
            delta: '-77%',
            scope: null,
            timeframe: null,
        });
        const result = await parseImpactAnswer({
            userId: USER,
            answer: 'went from 800ms to 180ms',
            win,
        });

        expect(result.kind).toBe('impact');
        if (result.kind !== 'impact') return;
        expect(result.impact.delta).toBeNull();
        expect(result.impact.baseline).toBe('800ms');
        expect(result.degraded).toBe(true);

        for (const value of Object.values(result.impact)) {
            if (typeof value !== 'string') continue;
            for (const digits of value.matchAll(/\d+(?:[.,]\d+)*/g)) {
                expect(`went from 800ms to 180ms\n${win.title}\n${win.narrative}`).toContain(digits[0]);
            }
        }
    });

    test('when the guard strips every figure, nothing is written at all', async () => {
        // The model answers with a figure that is nowhere in the source.
        stubImpact({
            metric: 'requests served',
            baseline: null,
            result: '2M per day',
            delta: null,
            scope: null,
            timeframe: null,
        });
        const result = await parseImpactAnswer({
            userId: USER,
            answer: 'it handles a lot more now, roughly 3 times the load',
            win,
        });

        // "3 times" is in the answer, "2M per day" is not — and the model
        // returned only the latter, so there is no honest metric left.
        expect(result.kind).toBe('no_quantity');
    });

    test('the metric name may come from the win, whose figures were already vetted', async () => {
        stubImpact({
            metric: 'checkout p95 latency',
            baseline: null,
            result: '180ms',
            delta: null,
            scope: null,
            timeframe: null,
        });
        const result = await parseImpactAnswer({ userId: USER, answer: 'about 180ms now', win });
        expect(result.kind).toBe('impact');
        if (result.kind !== 'impact') return;
        expect(result.impact.metric).toBe('checkout p95 latency');
    });

    test('the prompt and system message name the rule and the source', () => {
        expect(IMPACT_ANSWER_SYSTEM.toLowerCase()).toContain('never invent a number');
        expect(IMPACT_ANSWER_SYSTEM.toLowerCase()).toContain('derived percentage is a fabricated number');
        const prompt = buildImpactAnswerPrompt({ answer: '40% faster', title: 'T', narrative: 'N' });
        expect(prompt).toContain('40% faster');
        expect(prompt).toContain('T');
    });

    test('statesAQuantity is the cheap pre-gate', () => {
        expect(statesAQuantity('about 40% faster')).toBe(true);
        expect(statesAQuantity('from 11 days to 7')).toBe(true);
        expect(statesAQuantity('$4,200 a month')).toBe(true);
        expect(statesAQuantity('a lot faster')).toBe(false);
        expect(statesAQuantity('')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────── near duplicates

describe('near-duplicate detection (PRD 01 §12)', () => {
    const occurredAt = new Date('2026-07-14T00:00:00.000Z');

    test('>0.92 within ±14 days is a merge proposal', () => {
        const proposal = selectNearDuplicate(
            [
                {
                    id: 'point-1',
                    score: 0.95,
                    payload: { sourceId: 'win-1', title: 'Cut checkout latency', occurredAt: '2026-07-10T00:00:00.000Z' },
                },
            ],
            occurredAt,
        );
        expect(proposal).toEqual({
            existingWinId: 'win-1',
            similarity: 0.95,
            title: 'Cut checkout latency',
            occurredAt: new Date('2026-07-10T00:00:00.000Z'),
        });
    });

    test('at or below the threshold is a genuinely new win', () => {
        expect(
            selectNearDuplicate(
                [{ id: 'p', score: NEAR_DUPLICATE_THRESHOLD, payload: { sourceId: 'win-1', occurredAt: '2026-07-14T00:00:00.000Z' } }],
                occurredAt,
            ),
        ).toBeNull();
    });

    test('outside the ±14 day window is a genuinely new win', () => {
        const outside = new Date(occurredAt.getTime() - (NEAR_DUPLICATE_WINDOW_DAYS + 1) * 86_400_000);
        expect(
            selectNearDuplicate(
                [{ id: 'p', score: 0.99, payload: { sourceId: 'win-1', occurredAt: outside.toISOString() } }],
                occurredAt,
            ),
        ).toBeNull();
    });

    test('the merge proposal round-trips through the Result code', () => {
        const code = mergeProposalCode('win-abc');
        expect(parseMergeProposalCode(code)).toBe('win-abc');
        expect(parseMergeProposalCode('some_other_code')).toBeNull();
        expect(parseMergeProposalCode(undefined)).toBeNull();
    });
});
