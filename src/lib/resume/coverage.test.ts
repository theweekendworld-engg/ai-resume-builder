/**
 * Requirement coverage.
 *
 * The property that matters most is the one the old ATS score failed: this
 * number must go DOWN when the resume gets worse, and must not move at all
 * when someone adds keywords.
 */

import { describe, expect, test } from 'bun:test';

import type { JobRequirement } from './posting';
import type { ScoredBullet } from './select';
import { computeCoverage, gapAdvice, yearsAskedFor } from './coverage';

function req(id: string, text: string, kind: 'must' | 'nice' = 'must'): JobRequirement {
    return { id, text, kind, category: 'experience' };
}

function bullet(id: string, answers: string[]): ScoredBullet {
    return { id, groupId: 'e1', text: `line ${id}`, answers, strength: 4 };
}

describe('the score responds to the thing it is measuring', () => {
    const requirements = [req('r1', 'Kubernetes'), req('r2', 'Kafka'), req('r3', 'Mentoring')];

    test('answering everything is 100', () => {
        const kept = [bullet('b1', ['r1']), bullet('b2', ['r2']), bullet('b3', ['r3'])];
        expect(computeCoverage(requirements, kept).score).toBe(100);
    });

    test('answering nothing is 0', () => {
        expect(computeCoverage(requirements, [bullet('b1', [])]).score).toBe(0);
    });

    test('dropping the bullet that answered a requirement lowers the score', () => {
        // The whole point. The old score could not do this — it was measuring
        // word overlap, so losing a bullet barely moved it.
        const full = [bullet('b1', ['r1']), bullet('b2', ['r2']), bullet('b3', ['r3'])];
        const without = full.slice(0, 2);
        expect(computeCoverage(requirements, without).score).toBeLessThan(
            computeCoverage(requirements, full).score!,
        );
    });

    test('adding keywords cannot move it', () => {
        // A bullet answering nothing contributes nothing, however many of the
        // posting's words it contains. This is what makes the number safe to
        // optimise against.
        const kept = [bullet('b1', ['r1'])];
        const stuffed = [
            ...kept,
            bullet('keyword-soup-1', []),
            bullet('keyword-soup-2', []),
            bullet('keyword-soup-3', []),
        ];
        expect(computeCoverage(requirements, stuffed).score).toBe(
            computeCoverage(requirements, kept).score,
        );
    });
});

describe('musts outweigh nice-to-haves', () => {
    const requirements = [req('r1', 'Kubernetes', 'must'), req('r2', 'Terraform', 'nice')];

    test('answering the must scores higher than answering the bonus', () => {
        const must = computeCoverage(requirements, [bullet('b1', ['r1'])]).score!;
        const nice = computeCoverage(requirements, [bullet('b1', ['r2'])]).score!;
        expect(must).toBeGreaterThan(nice);
    });

    test('mustScore ignores bonuses entirely', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r2'])]);
        expect(report.mustScore).toBe(0);
        expect(report.score).toBeGreaterThan(0);
    });

    test('mustScore is null when the posting states no musts', () => {
        const report = computeCoverage([req('r1', 'Terraform', 'nice')], []);
        expect(report.mustScore).toBeNull();
    });
});

describe('refusing to score', () => {
    test('no requirements yields null, not zero', () => {
        // "We could not read this posting" and "this resume answers nothing"
        // are different facts. Reporting 0 for the first is the same class of
        // lie the old score told.
        const report = computeCoverage([], [bullet('b1', [])]);
        expect(report.score).toBeNull();
        expect(report.mustScore).toBeNull();
    });
});

describe('what the candidate is told', () => {
    const requirements = [
        req('r1', '6+ years building backend systems at scale'),
        req('r2', 'Experience with Terraform', 'nice'),
    ];

    test('unanswered musts lead, quoted in the posting’s own words', () => {
        const report = computeCoverage(requirements, []);
        const advice = gapAdvice(report, []);
        expect(advice[0]).toContain('6+ years building backend systems at scale');
    });

    test('unevidenced skills are explained, not silently dropped', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        const advice = gapAdvice(report, ['Terraform', 'gRPC']);
        expect(advice).toHaveLength(1);
        expect(advice[0]).toContain('Terraform, gRPC');
        expect(advice[0]).toContain('left off');
    });

    test('singular reads as English', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        expect(gapAdvice(report, ['Terraform'])[0]).toContain('does not mention it');
    });

    test('a fully answered posting with nothing missing says nothing', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        expect(gapAdvice(report, [])).toEqual([]);
    });

    test('bonuses come after musts', () => {
        const report = computeCoverage(requirements, []);
        const advice = gapAdvice(report, []);
        expect(advice[advice.length - 1]).toContain('Bonus');
    });
});

describe('the dates answer a tenure requirement', () => {
    const sixYears = req('r1', '6+ years building backend systems at scale');

    test('no bullet says it, and the date range does', () => {
        // The first live v2 run told a candidate with eight years of listed
        // roles that nothing answered a six-year requirement. Both wrong, and
        // the kind of wrong that makes someone distrust the rest of the tool.
        const report = computeCoverage([sixYears], [], 8);
        expect(report.unanswered).toEqual([]);
        expect(report.score).toBe(100);
    });

    test('the entry carries no bullet ids — nothing on the page says it', () => {
        const report = computeCoverage([sixYears], [], 8);
        expect(report.answered[0].bulletIds).toEqual([]);
    });

    test('short tenure is still a real gap', () => {
        const report = computeCoverage([sixYears], [], 3);
        expect(report.unanswered).toEqual([sixYears]);
    });

    test('exactly meeting the bar counts', () => {
        expect(computeCoverage([sixYears], [], 6).unanswered).toEqual([]);
    });

    test('a requirement with no years is untouched by tenure', () => {
        const report = computeCoverage([req('r1', 'Experience with Kubernetes')], [], 20);
        expect(report.unanswered).toHaveLength(1);
    });

    test.each([
        ['6+ years building backend systems', 6],
        ['5 years of experience', 5],
        ['at least 10 yrs in the field', 10],
        ['Experience with Kubernetes', null],
        ['Kafka', null],
    ])('reads %p as %p', (text, expected) => {
        expect(yearsAskedFor(req('r1', text))).toBe(expected as number | null);
    });
});

describe('answered requirements carry their evidence', () => {
    test('every answered entry names the bullets behind it', () => {
        // The editor uses this to show why a line is on the page, which is the
        // same hover-to-source affordance packets have.
        const report = computeCoverage(
            [req('r1', 'Kubernetes')],
            [bullet('b1', ['r1']), bullet('b2', ['r1'])],
        );
        expect(report.answered[0].bulletIds).toEqual(['b1', 'b2']);
    });
});
