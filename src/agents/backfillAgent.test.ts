/**
 * The conversation rules, as unit tests.
 *
 * PRD 07 §3.3 calls these "the difference between a thoughtful colleague and a
 * chatbot survey". They are enforced by pure functions precisely so they can be
 * tested exhaustively and cheaply here, rather than sampled by eye in QA — the
 * end-to-end proof that they hold over whole conversations lives in
 * `backfill.eval.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity } from '@prisma/client';
import {
    BACKFILL_TOPICS,
    HARD_CAP_QUESTIONS,
    MIN_QUESTIONS,
    TARGET_QUESTIONS,
    backfillOccurredAt,
    buildReanchor,
    carriesFigure,
    checkQuestion,
    closingLines,
    detectSensitivity,
    estimateProgress,
    fallbackQuestion,
    isVagueAnswer,
    planNextTopic,
    saysDontRemember,
    statesAQuantity,
    strictestSensitivity,
    type PlannerState,
    type TopicPlan,
} from '@/agents/backfillAgent';
import type { CapturedWin, GraphGaps, SessionSnapshot, SubjectContext } from '@/agents/tools/backfill';

// ───────────────────────────────────────────────────────────────── fixtures

function context(overrides: Partial<SubjectContext> = {}): SubjectContext {
    return {
        subjectType: 'employer',
        subjectId: 'exp-1',
        subjectLabel: 'Acme',
        role: 'Senior Engineer',
        highlights: [],
        description: '',
        periodStart: new Date('2023-01-01T00:00:00.000Z'),
        periodEnd: new Date('2025-01-01T00:00:00.000Z'),
        existingWins: [],
        existingWinCount: 0,
        hasPriorContext: true,
        ...overrides,
    };
}

function gaps(overrides: Partial<GraphGaps> = {}): GraphGaps {
    return {
        missingCategories: [],
        unquantifiedWins: [],
        unscopedWins: [],
        quantifiedCount: 0,
        totalCount: 0,
        ...overrides,
    };
}

function captured(overrides: Partial<CapturedWin> = {}): CapturedWin {
    return {
        winId: 'win-1',
        title: 'Led the payments migration',
        category: WinCategory.led,
        sensitivity: WinSensitivity.shareable,
        quantified: false,
        metricLabel: null,
        questionIndex: 1,
        capturedAt: new Date().toISOString(),
        ...overrides,
    };
}

function plannerState(overrides: Partial<PlannerState> = {}): PlannerState {
    return {
        questionCount: 1,
        askedTopics: ['anchor'],
        captured: [],
        gaps: gaps(),
        context: context(),
        consecutiveVague: 0,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════ the hard gate: leading numbers

describe('checkQuestion — never lead a number', () => {
    // PRD 07 §8's launch gate, verbatim. These three patterns are the ones the
    // spec names; the rest are the same failure wearing a different hat.
    const LEADING = [
        'Would you say around 30%?',
        'Was it roughly 40% faster?',
        'Did that save about 20% of the budget?',
        'Something like 500 users?',
        'Any ballpark for that?',
        'Maybe 15% better?',
        'Was it ~200 requests a second?',
        'Were there 50ish people involved?',
        'Order of magnitude on that?',
        'Did it cut the queue by 3 days?',
        'Was that a 2x improvement?',
        'Did it reach 10,000 customers?',
    ];

    for (const question of LEADING) {
        test(`rejects "${question}"`, () => {
            expect(checkQuestion(question, { sourceText: 'we made checkout faster' })).not.toEqual([]);
        });
    }

    test('accepts the same question asked without a number', () => {
        const clean = [
            'Any sense of the size of that change?',
            'How much did that move?',
            'Do you know the number?',
            'Was that just your own team, or wider?',
            "Whose work changed because of something you did there?",
        ];
        for (const question of clean) {
            expect(checkQuestion(question, { sourceText: 'we made checkout faster' })).toEqual([]);
        }
    });

    test('a number the USER already said may be repeated', () => {
        // Reflecting their own figure back is how you confirm you heard it. The
        // rule is about the agent introducing figures, not about echoing them.
        const transcriptSoFar = 'we cut checkout p95 from 800ms to 180ms last spring';
        expect(
            checkQuestion('You said 800ms to 180ms — was that every region?', {
                sourceText: transcriptSoFar,
            }),
        ).toEqual([]);
    });

    test('a number the user did NOT say is a violation even in a plain question', () => {
        const violations = checkQuestion('Did that cover all 12 regions?', {
            sourceText: 'we cut checkout latency',
        });
        expect(violations.some((violation) => violation.rule === 'leading_number')).toBe(true);
    });

    test('"would you say" is banned even with no number attached', () => {
        const violations = checkQuestion('Would you say that was the biggest one?', {
            sourceText: '',
        });
        expect(violations.some((violation) => violation.rule === 'banned_phrase')).toBe(true);
    });

    test('years and dates are not treated as led quantities', () => {
        expect(checkQuestion('What changed for you in 2024?', { sourceText: '' })).toEqual([]);
    });
});

describe('checkQuestion — one question at a time', () => {
    test('rejects two question marks', () => {
        const violations = checkQuestion('How big was it? Who else was involved?', { sourceText: '' });
        expect(violations.some((violation) => violation.rule === 'multi_part')).toBe(true);
    });

    test('rejects a second interrogative clause joined by "and"', () => {
        const violations = checkQuestion('How many people were waiting and who owned it?', {
            sourceText: '',
        });
        expect(violations.some((violation) => violation.rule === 'multi_part')).toBe(true);
    });

    test('allows a simple "or" alternative, which is one question', () => {
        expect(checkQuestion('Was that just your own team, or wider?', { sourceText: '' })).toEqual([]);
    });

    test('rejects a statement with no question mark', () => {
        const violations = checkQuestion('Tell me about the migration.', { sourceText: '' });
        expect(violations.some((violation) => violation.rule === 'not_a_question')).toBe(true);
    });
});

describe('checkQuestion — never flatter', () => {
    const FLATTERING = [
        "That's impressive! What came next?",
        'Great work. How did it land?',
        'Wow, how did that go?',
        'Amazing — what happened after?',
        'Nice one, what else?',
        'Well done. Who noticed?',
    ];

    for (const question of FLATTERING) {
        test(`rejects "${question}"`, () => {
            const violations = checkQuestion(question, { sourceText: '' });
            expect(violations.some((violation) => violation.rule === 'flattery')).toBe(true);
        });
    }

    test('an exclamation mark alone is a violation', () => {
        const violations = checkQuestion('What happened next!?', { sourceText: '' });
        expect(violations.some((violation) => violation.rule === 'flattery')).toBe(true);
    });
});

describe('every scripted fallback passes its own gate', () => {
    // The fallbacks are what the user sees when the model cannot produce a clean
    // question twice. If one of them violated a rule, the gate would have no
    // floor and "zero violations" would be unachievable by construction.
    const plans: TopicPlan[] = [
        { topic: 'anchor', key: 'anchor' },
        { topic: 'quantify', key: 'quantify:last:1' },
        { topic: 'scope', key: 'scope:win-1' },
        { topic: 'rarity', key: 'rarity:influenced', targetCategory: WinCategory.influenced },
        { topic: 'rarity', key: 'rarity:grew', targetCategory: WinCategory.grew },
        { topic: 'rarity', key: 'rarity:saved', targetCategory: WinCategory.saved },
        { topic: 'evidence', key: 'evidence' },
        { topic: 'sweep', key: 'sweep' },
    ];

    for (const plan of plans) {
        test(`${plan.key}`, () => {
            const question = fallbackQuestion(plan, 'Acme');
            expect(checkQuestion(question, { sourceText: 'Acme' })).toEqual([]);
        });
    }

    test('covers every topic in the ladder', () => {
        const covered = new Set(plans.map((plan) => plan.topic));
        for (const topic of BACKFILL_TOPICS) expect(covered.has(topic)).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════ the planner

describe('planNextTopic', () => {
    test('opens with the anchor, and only once', () => {
        expect(planNextTopic(plannerState({ questionCount: 0, askedTopics: [] }))?.topic).toBe('anchor');
        expect(planNextTopic(plannerState({ askedTopics: ['anchor'] }))?.topic).not.toBe('anchor');
    });

    test('quantifies what the user just described when it carried no figure', () => {
        const plan = planNextTopic(
            plannerState({ lastAnswer: 'I led the payments migration end to end', lastTopic: 'anchor' }),
        );
        expect(plan?.topic).toBe('quantify');
        expect(plan?.refersToLastAnswer).toBe(true);
    });

    test('does not ask for a figure the user already gave', () => {
        const plan = planNextTopic(
            plannerState({
                lastAnswer: 'we cut p95 from 800ms to 180ms',
                lastTopic: 'anchor',
                gaps: gaps({ missingCategories: [WinCategory.influenced] }),
            }),
        );
        expect(plan?.topic).not.toBe('quantify');
    });

    test('never asks the same topic key twice, which is what makes a resume safe', () => {
        const state = plannerState({
            askedTopics: ['anchor', 'quantify:win-1'],
            captured: [captured({ winId: 'win-1' })],
            gaps: gaps({ unquantifiedWins: [{ id: 'win-1', title: 'Led the payments migration' }] }),
        });
        const plan = planNextTopic(state);
        expect(plan?.key).not.toBe('quantify:win-1');
    });

    test('two vague answers in a row change the subject rather than pressing', () => {
        const pressing = plannerState({
            captured: [captured()],
            lastAnswer: 'not really',
            lastTopic: 'anchor',
            gaps: gaps({ missingCategories: [WinCategory.grew] }),
            consecutiveVague: 2,
        });
        const plan = planNextTopic(pressing);
        expect(plan?.topic).not.toBe('quantify');
        expect(plan?.topic).not.toBe('scope');
    });

    test('probes the rare categories the record is missing', () => {
        const plan = planNextTopic(
            plannerState({
                askedTopics: ['anchor', 'quantify:last:1', 'scope:done'],
                lastAnswer: 'we cut p95 from 800ms to 180ms',
                gaps: gaps({ missingCategories: [WinCategory.influenced, WinCategory.grew] }),
            }),
        );
        expect(plan?.topic).toBe('rarity');
        expect(plan?.targetCategory).toBe(WinCategory.influenced);
    });

    test('a topic the answer already covered is not re-asked', () => {
        const plan = planNextTopic(
            plannerState({
                lastAnswer: 'I led the migration',
                lastTopic: 'anchor',
                coveredTopics: ['quantify', 'scope'],
                gaps: gaps({ missingCategories: [WinCategory.saved] }),
            }),
        );
        expect(plan?.topic).toBe('rarity');
    });

    test('winds down with the sweep, and stops after it', () => {
        const nearEnd = plannerState({ questionCount: TARGET_QUESTIONS - 1, askedTopics: ['anchor'] });
        expect(planNextTopic(nearEnd)?.topic).toBe('sweep');
        expect(planNextTopic({ ...nearEnd, askedTopics: ['anchor', 'sweep'] })).toBeNull();
    });

    test('stops at the hard cap no matter what is left unasked', () => {
        expect(
            planNextTopic(
                plannerState({
                    questionCount: HARD_CAP_QUESTIONS,
                    askedTopics: ['anchor'],
                    gaps: gaps({ missingCategories: [WinCategory.grew, WinCategory.saved] }),
                }),
            ),
        ).toBeNull();
    });

    test('a full run lands inside the 8-12 target', () => {
        // Drive the planner the way a real session drives it and count. The
        // length target is the reason the feature is finishable at all, so it is
        // a property of the planner, not of the prompt.
        let asked: string[] = [];
        let count = 0;
        const state = () =>
            plannerState({
                questionCount: count,
                askedTopics: asked,
                captured: [captured({ winId: 'w1' }), captured({ winId: 'w2', title: 'Cut checkout p95' })],
                gaps: gaps({
                    missingCategories: [WinCategory.influenced, WinCategory.grew, WinCategory.saved],
                    unquantifiedWins: [
                        { id: 'w1', title: 'Led the payments migration' },
                        { id: 'w2', title: 'Cut checkout p95' },
                    ],
                    unscopedWins: [{ id: 'w1', title: 'Led the payments migration' }],
                }),
                lastAnswer: 'we did a lot of work on the platform that year',
                consecutiveVague: 0,
            });

        for (let i = 0; i < HARD_CAP_QUESTIONS + 5; i += 1) {
            const plan = planNextTopic(state());
            if (!plan) break;
            asked = [...asked, plan.key];
            count += 1;
        }

        expect(count).toBeGreaterThanOrEqual(MIN_QUESTIONS);
        expect(count).toBeLessThanOrEqual(TARGET_QUESTIONS);
    });
});

// ═══════════════════════════════════════════════════════════ answer reading

describe('reading an answer', () => {
    test('recognises the ways people say they do not remember', () => {
        for (const answer of ["I don't remember", 'no idea', "can't remember", 'not sure']) {
            expect(saysDontRemember(answer)).toBe(true);
        }
        expect(saysDontRemember('we cut latency by half')).toBe(false);
    });

    test('a short non-answer is vague; a short answer with a number is not', () => {
        expect(isVagueAnswer('not really')).toBe(true);
        expect(isVagueAnswer('')).toBe(true);
        expect(isVagueAnswer('about 40% faster')).toBe(false);
        expect(
            isVagueAnswer(
                'I rewrote the pricing lookup as one batched query and it made the checkout page usable again',
            ),
        ).toBe(false);
    });

    test('statesAQuantity ignores bare years', () => {
        expect(statesAQuantity('this was in 2024')).toBe(false);
        expect(statesAQuantity('it went from 800ms to 180ms')).toBe(true);
    });

    test('carriesFigure rejects a metric whose figures were stripped', () => {
        expect(carriesFigure({ baseline: '800ms', result: '180ms', delta: null })).toBe(true);
        expect(carriesFigure({ baseline: '', result: '', delta: '' })).toBe(false);
        expect(carriesFigure({ baseline: null, result: null, delta: null })).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════ confidential detection

describe('detectSensitivity', () => {
    test('flags unreleased product as confidential and says so', () => {
        const finding = detectSensitivity('this was an unreleased product we never shipped');
        expect(finding?.sensitivity).toBe(WinSensitivity.confidential);
        // Naming the protection out loud is the requirement, not just setting it.
        expect(finding?.message).toContain('confidential');
    });

    test('flags internal financials as internal-only and explains the consequence', () => {
        const finding = detectSensitivity('we grew ARR substantially that year');
        expect(finding?.sensitivity).toBe(WinSensitivity.internal_only);
        expect(finding?.message).toContain('internal-only');
        expect(finding?.message).toContain("won't go on a resume");
    });

    test('flags personnel and security matters', () => {
        expect(detectSensitivity('I handled the layoffs comms')?.sensitivity).toBe(
            WinSensitivity.confidential,
        );
        expect(detectSensitivity('I led the response to a security incident')?.sensitivity).toBe(
            WinSensitivity.confidential,
        );
    });

    test('leaves ordinary work alone', () => {
        expect(detectSensitivity('I rewrote the pricing lookup as a batched query')).toBeNull();
    });

    test('the strictest proposal wins', () => {
        expect(
            strictestSensitivity(WinSensitivity.shareable, WinSensitivity.confidential),
        ).toBe(WinSensitivity.confidential);
        expect(
            strictestSensitivity(WinSensitivity.internal_only, WinSensitivity.shareable),
        ).toBe(WinSensitivity.internal_only);
        expect(strictestSensitivity(undefined, null)).toBe(WinSensitivity.shareable);
    });
});

// ═══════════════════════════════════════════════════════════ progress & dates

describe('honest progress', () => {
    test('counts questions from one and never promises zero minutes', () => {
        expect(estimateProgress(0)).toMatchObject({ questionNumber: 1, cap: HARD_CAP_QUESTIONS });
        expect(estimateProgress(3).questionNumber).toBe(4);
        expect(estimateProgress(3).minutesLeft).toBeGreaterThan(0);
        expect(estimateProgress(50).minutesLeft).toBeGreaterThanOrEqual(1);
    });

    test('the estimate shrinks as the conversation goes on', () => {
        expect(estimateProgress(8).minutesLeft).toBeLessThan(estimateProgress(2).minutesLeft);
    });
});

describe('backfillOccurredAt', () => {
    test('dates a recovered win inside its period, never today', () => {
        const now = new Date('2026-08-02T00:00:00.000Z');
        const at = backfillOccurredAt(context(), now);
        expect(at.getTime()).toBeGreaterThan(new Date('2023-01-01').getTime());
        expect(at.getTime()).toBeLessThan(new Date('2025-01-02').getTime());
    });

    test('falls back to today only when the subject has no period at all', () => {
        const now = new Date('2026-08-02T00:00:00.000Z');
        expect(
            backfillOccurredAt(context({ periodStart: null, periodEnd: null }), now).getTime(),
        ).toBe(now.getTime());
    });

    test('an open-ended current role never dates a win into the future', () => {
        const now = new Date('2026-08-02T00:00:00.000Z');
        const at = backfillOccurredAt(
            context({ periodStart: new Date('2025-01-01T00:00:00.000Z'), periodEnd: null }),
            now,
        );
        expect(at.getTime()).toBeLessThanOrEqual(now.getTime());
    });
});

// ═══════════════════════════════════════════════════════════ resume & closing

describe('buildReanchor', () => {
    function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
        return {
            id: 'sess-1',
            userId: 'user-1',
            subjectType: 'employer',
            subjectId: 'exp-1',
            subjectLabel: 'Acme',
            status: 'active',
            transcript: [
                { role: 'agent', content: 'What are you known for?', at: '2026-07-01T00:00:00.000Z' },
                { role: 'user', content: 'the payments migration', at: '2026-07-01T00:01:00.000Z' },
            ],
            askedTopics: ['anchor'],
            captured: [],
            questionCount: 1,
            costUsd: 0,
            startedAt: new Date('2026-07-01T00:00:00.000Z'),
            lastActiveAt: new Date('2026-07-01T00:01:00.000Z'),
            completedAt: null,
            expiresAt: new Date('2026-07-31T00:00:00.000Z'),
            ...overrides,
        };
    }

    test('re-anchors after a gap instead of restarting', () => {
        const line = buildReanchor(snapshot(), new Date('2026-07-22T00:00:00.000Z'));
        expect(line).toContain('Acme');
        expect(line).toContain('payments migration');
    });

    test('says nothing when the user only stepped away for a moment', () => {
        expect(buildReanchor(snapshot(), new Date('2026-07-01T00:05:00.000Z'))).toBeNull();
    });
});

describe('closingLines', () => {
    const summary = {
        winsCaptured: 9,
        quantifiedCount: 6,
        crossTeamCount: 3,
        confidentialCount: 1,
        questionsAsked: 11,
        durationSec: 540,
        priorWinCount: 0,
        priorHighlightCount: 3,
        subjectLabel: 'Acme',
        proposedHighlightDiffs: [],
    };

    test('states real counts and the before/after comparison', () => {
        const lines = closingLines(summary);
        expect(lines[0]).toBe('You just recovered 9 wins from Acme.');
        expect(lines[1]).toBe('6 have hard numbers. 3 are cross-team.');
        expect(lines[2]).toBe('Before this, your Acme record was 3 resume bullets.');
    });

    test('does not claim a comparison it cannot make', () => {
        const lines = closingLines({ ...summary, priorHighlightCount: 0, priorWinCount: 4 });
        expect(lines.some((line) => line.includes('Before this'))).toBe(false);
    });

    test('singularises rather than writing "1 wins"', () => {
        const lines = closingLines({
            ...summary,
            winsCaptured: 1,
            quantifiedCount: 0,
            crossTeamCount: 0,
            priorHighlightCount: 1,
        });
        expect(lines[0]).toBe('You just recovered 1 win from Acme.');
        expect(lines[1]).toBe('Before this, your Acme record was 1 resume bullet.');
    });
});
