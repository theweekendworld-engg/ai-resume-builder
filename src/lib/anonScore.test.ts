/**
 * The anonymous scorer.
 *
 * `/score` is the only model call in the product a stranger can reach, and the
 * strings it produces are formatted to be pasted into a real resume. These
 * tests pin the two properties that follow from that: nothing it suggests may
 * contain a figure the candidate's own resume does not, and the spend is
 * attributable.
 *
 * The model and the usage-log write are both injected seams — no network, no
 * database.
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { __testing, type ObjectRunner } from '@/lib/ai/structured';
import { ANON_USER_ID, scoreResumeText } from './anonScore';
import type { AnonScoreModel } from './anonScoreSchema';

const RESUME = `Jane Doe — Staff Engineer
Rebuilt the checkout service; cut p95 latency from 800ms to 180ms.
Led a team of 6 through the migration.
Built an API. Owned the billing rewrite.`;

type Logged = { userId: string; operation: string; metadata?: Record<string, unknown> };

let logged: Logged[] = [];
let prompts: string[] = [];

/** Every response the fake model will give, in order. */
function useResponses(responses: AnonScoreModel[]) {
    let index = 0;
    const runner: ObjectRunner = async ({ prompt }) => {
        prompts.push(prompt);
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return { object: response, inputTokens: 1000, outputTokens: 500 };
    };
    __testing.setObjectRunner(runner);
}

function report(fixes: AnonScoreModel['fixes']): AnonScoreModel {
    return {
        overall: 72,
        dimensions: [
            { key: 'keywords', label: 'Keywords', score: 70, note: 'Covers the usual backend terms.' },
            { key: 'impact_metrics', label: 'Impact & Metrics', score: 65, note: 'Two of four roles carry a figure.' },
        ],
        fixes,
    };
}

const goodFix = {
    priority: 'high' as const,
    title: 'Quantify the API bullet',
    problem: '"Built an API." carries no scope or outcome.',
    suggestion: 'Built an API serving [N] requests/day, cutting p99 latency by [X]%.',
};

beforeEach(() => {
    logged = [];
    prompts = [];
    __testing.setUsageLogger(async (input) => {
        logged.push(input as Logged);
    });
});

afterAll(() => {
    __testing.reset();
});

describe('fabricated figures in a suggested rewrite', () => {
    test('an invented metric is corrected on retry', async () => {
        const fabricated = {
            ...goodFix,
            suggestion: 'Built an API serving 2M requests/day, cutting p99 latency by 40%.',
        };
        useResponses([report([fabricated]), report([goodFix])]);

        const result = await scoreResumeText(RESUME);

        expect(result.fixes).toHaveLength(1);
        expect(result.fixes[0].suggestion).toBe(goodFix.suggestion);
        // The corrective prompt must name the offending figures, not just scold.
        expect(prompts[1]).toContain('2m');
        expect(prompts[1]).toContain('40%');
    });

    test('a fix that stays fabricated is dropped, not shipped hollow', async () => {
        // stripViolations blanks the offending string in place, which would
        // leave a card reading "Suggested rewrite" over empty space.
        const fabricated = {
            ...goodFix,
            suggestion: 'Built an API serving 2M requests/day.',
        };
        useResponses([report([fabricated])]);

        const result = await scoreResumeText(RESUME);
        expect(result.fixes).toEqual([]);
    });

    test('a figure the resume actually contains survives', async () => {
        const grounded = {
            ...goodFix,
            title: 'Lead with the latency win',
            problem: 'The 800ms to 180ms result is buried in the third line.',
            suggestion: 'Cut checkout p95 latency from 800ms to 180ms across a team of 6.',
        };
        useResponses([report([grounded])]);

        const result = await scoreResumeText(RESUME);
        expect(result.fixes).toHaveLength(1);
        expect(result.fixes[0].suggestion).toContain('180ms');
        expect(prompts).toHaveLength(1); // no corrective round-trip was needed
    });

    test('a percentage derived from two real numbers is still fabricated', async () => {
        // 800ms -> 180ms is a 77.5% cut, and both endpoints are in the resume.
        // Deriving the percentage is exactly the move the guard exists to stop.
        const derived = { ...goodFix, suggestion: 'Cut checkout p95 latency by 77%.' };
        useResponses([report([derived])]);

        const result = await scoreResumeText(RESUME);
        expect(result.fixes).toEqual([]);
    });

    test('commentary that counts the document is left alone', async () => {
        // "four roles" and "8 bullets" are true statements ABOUT the resume that
        // do not appear IN it. Guarding this class would flag correct analysis
        // and buy a corrective round-trip on nearly every score, so `problem`
        // and the dimension notes are deliberately outside the guard.
        const counted = {
            ...goodFix,
            problem: 'Only 3 of your 8 bullets carry a metric.',
        };
        useResponses([report([counted])]);

        const result = await scoreResumeText(RESUME);
        expect(prompts).toHaveLength(1);
        expect(result.fixes[0].problem).toBe(counted.problem);
        expect(result.dimensions[1].note).toBe('Two of four roles carry a figure.');
    });

    test('a figure from the target job description is allowed', async () => {
        // A candidate legitimately echoes the posting. Flagging it would spend
        // a retry arguing with a true statement.
        const echoed = {
            ...goodFix,
            suggestion: 'Reframe the migration bullet against the 5+ years of Kubernetes the role asks for.',
        };
        useResponses([report([echoed])]);

        const result = await scoreResumeText(RESUME, 'We want 5+ years of Kubernetes.');
        expect(result.fixes).toHaveLength(1);
    });
});

describe('accounting', () => {
    test('anonymous spend is logged under a single attributable id', async () => {
        useResponses([report([goodFix])]);
        await scoreResumeText(RESUME);

        expect(logged).toHaveLength(1);
        expect(logged[0].userId).toBe(ANON_USER_ID);
        expect(logged[0].operation).toBe('ai.atsScore');
        // The per-feature cost tripwire (PRD 08 §4.3) groups by this.
        expect(logged[0].metadata?.feature).toBe('resume');
    });

    test('a guard retry is billed too — both calls land on one log line', async () => {
        useResponses([
            report([{ ...goodFix, suggestion: 'Served 2M requests/day.' }]),
            report([goodFix]),
        ]);
        await scoreResumeText(RESUME);

        expect(logged).toHaveLength(1);
        expect(logged[0].metadata?.calls).toBe(2);
    });
});

describe('the report itself', () => {
    test('the band is derived server-side, never asked of the model', async () => {
        useResponses([{ ...report([goodFix]), overall: 84 }]);
        const result = await scoreResumeText(RESUME);
        expect(result.band).toBe('strong');
    });

    test('jobMatch is dropped when no job description was supplied', async () => {
        useResponses([
            {
                ...report([goodFix]),
                jobMatch: { matchedKeywords: ['api'], missingKeywords: ['terraform'] },
            },
        ]);
        const result = await scoreResumeText(RESUME);
        expect(result.jobMatch).toBeUndefined();
    });

    test('text too short to score is rejected before any model call', async () => {
        useResponses([report([goodFix])]);
        await expect(scoreResumeText('too short')).rejects.toThrow(/too short/i);
        expect(prompts).toHaveLength(0);
    });
});
