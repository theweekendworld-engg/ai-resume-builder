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
import { computeCoverage, gapAdvice, reconcileSkillGaps, yearsAskedFor } from './coverage';

function req(
    id: string,
    text: string,
    kind: JobRequirement['kind'] = 'must',
    satisfiedByTenure = false,
): JobRequirement {
    return { id, text, kind, category: 'experience', satisfiedByTenure };
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

    test('it opens with where they stand, not with a rejection', () => {
        // Every gap report in the 8 Aug audit was 100% negative — five lines
        // of "nothing answers" with no summary and no next action. For a
        // career switcher that is the whole advice block, and it is the
        // version nobody shares.
        const report = computeCoverage(requirements, []);
        expect(gapAdvice(report, [])[0]).toBe('You answer 0 of 1 must-haves on this posting.');
    });

    test('unanswered musts come next, quoted in the posting’s own words', () => {
        const report = computeCoverage(requirements, []);
        const advice = gapAdvice(report, []);
        expect(advice[1]).toContain('6+ years building backend systems at scale');
    });

    test('a posting that states no must-haves invents no denominator', () => {
        const bonusOnly = [req('r1', 'Experience with Terraform', 'nice')];
        const advice = gapAdvice(computeCoverage(bonusOnly, []), []);
        expect(advice.some((line) => line.includes('must-haves'))).toBe(false);
    });

    test('unevidenced skills are explained, not silently dropped', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        const advice = gapAdvice(report, ['Terraform', 'gRPC']);
        expect(advice.some((line) => line.includes('Terraform, gRPC'))).toBe(true);
        expect(advice.some((line) => line.includes('left off'))).toBe(true);
    });

    test('singular reads as English', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        const advice = gapAdvice(report, ['Terraform']);
        expect(advice.some((line) => line.includes('does not mention it'))).toBe(true);
    });

    test('a fully answered posting says so, and says nothing negative', () => {
        const report = computeCoverage(requirements, [bullet('b1', ['r1']), bullet('b2', ['r2'])]);
        expect(gapAdvice(report, [])).toEqual(['You answer 1 of 1 must-haves on this posting.']);
    });

    test('a line we cut is offered back before anything is called a gap', () => {
        // The single most damaging thing this product did: cut the candidate's
        // own evidence for space, then report the requirement as unanswered.
        // "You have this and it did not fit" is both true and the most useful
        // sentence available — the editor can restore it in one click.
        const report = computeCoverage(
            requirements,
            { kept: [], cut: [bullet('b9', ['r1'])] },
        );
        const advice = gapAdvice(report, []);
        expect(advice[1]).toContain('You have this and it did not fit');
        expect(advice[1]).toContain('6+ years building backend systems at scale');
        expect(advice.some((line) => line.startsWith('Nothing on your resume answers'))).toBe(
            false,
        );
    });

    test('bonuses come after musts', () => {
        const report = computeCoverage(requirements, []);
        const advice = gapAdvice(report, []);
        expect(advice[advice.length - 1]).toContain('Bonus');
    });
});

describe('the dates answer a tenure requirement', () => {
    // `satisfiedByTenure: true` — the posting-reader judged that time served is
    // the whole of what this asks for. Without that flag no date credit is
    // given, however many years the resume shows.
    const sixYears = req('r1', '6+ years building backend systems at scale', 'must', true);

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

    test('a requirement that merely CONTAINS a year count gets no credit', () => {
        // The defect this flag exists for. A live free-score run returned
        //   { text: "2+ years owning a paid budget over $1M", byDates: true }
        // for a resume with no budget figure anywhere in it — the old regex
        // matched "2+ years" and credited the rest for free. The product told
        // a stranger they met a $1M budget-ownership bar on the strength of
        // having been employed for two years.
        const budget = req('r1', '2+ years owning a paid budget over $1M', 'must', false);
        const report = computeCoverage([budget], [], 20);
        expect(report.unanswered).toEqual([budget]);
        expect(report.answered).toEqual([]);
    });

    test('it fails closed — an unflagged tenure requirement is a gap, not a gift', () => {
        // If the posting-reader does not make the call, we do not make it for
        // them. Under-crediting costs a line in the gap report; over-crediting
        // tells someone they are qualified when they are not.
        const unflagged = req('r1', '6+ years building backend systems', 'must', false);
        expect(computeCoverage([unflagged], [], 30).unanswered).toEqual([unflagged]);
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

describe('skill gaps the requirement list already covers', () => {
    // This lived in report.ts and `/score` did not use it, so the free checker
    // showed "Experience with cloud infrastructure (AWS)" as ANSWERED and
    // "AWS" as missing at the same time. Two copies of a rule is one copy of a
    // rule and one bug, so it lives here where both consumers reach it.
    const requirements = [
        req('r1', 'Experience with cloud infrastructure (AWS)'),
        req('r2', 'Deep experience with distributed systems'),
    ];

    test('a skill named inside a requirement is dropped', () => {
        expect(reconcileSkillGaps(['AWS'], requirements)).toEqual([]);
    });

    test('regardless of whether that requirement was answered', () => {
        // Contradiction and restatement are both redundancy; the requirement
        // row says it either way, in the employer's fuller words.
        expect(reconcileSkillGaps(['Distributed systems'], requirements)).toEqual([]);
    });

    test('a skill no requirement mentions survives — that is the useful case', () => {
        expect(reconcileSkillGaps(['Terraform', 'gRPC'], requirements)).toEqual([
            'Terraform',
            'gRPC',
        ]);
    });

    test('matching is word-boundary, not substring', () => {
        // "Go" must not be swallowed by "Google Cloud".
        expect(reconcileSkillGaps(['Go'], [req('r1', 'Experience with Google Cloud')])).toEqual([
            'Go',
        ]);
    });

    test('case does not matter', () => {
        expect(reconcileSkillGaps(['aws'], requirements)).toEqual([]);
    });

    test('no requirements means every gap survives', () => {
        expect(reconcileSkillGaps(['Terraform'], [])).toEqual(['Terraform']);
    });

    test('an empty entry is dropped rather than matching everything', () => {
        expect(reconcileSkillGaps(['', '   '], requirements)).toEqual([]);
    });
});
