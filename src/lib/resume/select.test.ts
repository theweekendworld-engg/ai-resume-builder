/**
 * Selection.
 *
 * Pure, so none of this needs a model. The first test is the 7 Aug audit
 * failure written down: the posting said "mentor engineers", the candidate had
 * a mentoring line, and the old pipeline dropped it because five bullets did
 * not fit in four slots and nothing knew which one mattered.
 */

import { describe, expect, test } from 'bun:test';

import type { JobRequirement } from './posting';
import {
    MIN_STRENGTH,
    keptForGroup,
    keptGroups,
    selectBullets,
    type ScoredBullet,
} from './select';

const CAPS = { maxPerGroup: 4, maxGroups: 4 };

function req(id: string, text: string, kind: 'must' | 'nice' = 'must'): JobRequirement {
    return { id, text, kind, category: 'experience' };
}

function bullet(patch: Partial<ScoredBullet> & { id: string }): ScoredBullet {
    return {
        groupId: 'e1',
        text: patch.text ?? `line ${patch.id}`,
        answers: [],
        strength: 3,
        ...patch,
    };
}

describe('the audit failure — a stated requirement beats raw strength', () => {
    // Flexport had five bullets and four slots. The mentoring line is the
    // weakest of the five, and the only one answering a requirement the
    // posting states outright.
    const requirements = [req('r1', 'Mentor engineers and raise the technical bar')];
    const bullets = [
        bullet({ id: 'b1', strength: 5, text: 'cut p95 4.2s → 900ms' }),
        bullet({ id: 'b2', strength: 5, text: 'migrated 9 services to Kubernetes' }),
        bullet({ id: 'b3', strength: 4, text: 'MTTR 45min → 8min' }),
        bullet({ id: 'b4', strength: 4, text: 'rebuilt the billing service' }),
        bullet({ id: 'b5', strength: 3, text: 'mentored 3 engineers', answers: ['r1'] }),
    ];

    test('the mentoring bullet survives the cap', () => {
        const result = selectBullets(bullets, requirements, CAPS);
        expect(result.kept.map((b) => b.id)).toContain('b5');
        expect(result.kept).toHaveLength(4);
    });

    test('and it displaces the weakest NON-answering line, not a strong one', () => {
        const result = selectBullets(bullets, requirements, CAPS);
        expect(result.kept.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3', 'b5']);
        expect(result.dropped.map((d) => d.bullet.id)).toEqual(['b4']);
        expect(result.dropped[0].reason).toBe('cap');
    });

    test('with nothing to cover, pure strength wins', () => {
        const result = selectBullets(bullets, [], CAPS);
        expect(result.kept.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
    });
});

describe('coverage is greedy but not greedy twice', () => {
    test('one bullet covering two requirements does not consume two slots', () => {
        const requirements = [req('r1', 'Kubernetes'), req('r2', 'AWS')];
        const bullets = [
            bullet({ id: 'b1', strength: 5, answers: ['r1', 'r2'] }),
            bullet({ id: 'b2', strength: 4 }),
            bullet({ id: 'b3', strength: 4 }),
            bullet({ id: 'b4', strength: 4 }),
            bullet({ id: 'b5', strength: 1 }),
        ];
        const result = selectBullets(bullets, requirements, CAPS);
        expect(result.kept).toHaveLength(4);
        expect(result.uncovered).toEqual([]);
    });

    test('the strongest answering bullet is the one taken', () => {
        const requirements = [req('r1', 'Kafka')];
        const bullets = [
            bullet({ id: 'weak', strength: 2, answers: ['r1'] }),
            bullet({ id: 'strong', strength: 5, answers: ['r1'] }),
        ];
        const result = selectBullets(bullets, requirements, { maxPerGroup: 1, maxGroups: 4 });
        expect(result.kept.map((b) => b.id)).toEqual(['strong']);
    });

    test('nice-to-haves do not get a reserved slot', () => {
        // Only musts earn the covering pass. A "nice" requirement competes on
        // strength like anything else, or a bonus item could push out a line
        // answering something required.
        const requirements = [req('r1', 'Terraform', 'nice')];
        const bullets = [
            bullet({ id: 'b1', strength: 5 }),
            bullet({ id: 'b2', strength: 2, answers: ['r1'] }),
        ];
        const result = selectBullets(bullets, requirements, { maxPerGroup: 1, maxGroups: 4 });
        expect(result.kept.map((b) => b.id)).toEqual(['b1']);
    });
});

describe('filler never ships', () => {
    test(`strength below ${MIN_STRENGTH} is dropped even with slots free`, () => {
        const bullets = [bullet({ id: 'b1', strength: 5 }), bullet({ id: 'b2', strength: 1 })];
        const result = selectBullets(bullets, [], CAPS);
        expect(result.kept.map((b) => b.id)).toEqual(['b1']);
        expect(result.dropped[0]).toMatchObject({ reason: 'weak' });
    });

    test('a weak bullet is not rescued by answering a requirement', () => {
        // "Responsible for the billing service" answers a billing requirement
        // and is still not worth a line. Covering a requirement badly is worse
        // than reporting it as a gap.
        const bullets = [bullet({ id: 'b1', strength: 1, answers: ['r1'] })];
        const result = selectBullets(bullets, [req('r1', 'Own billing')], CAPS);
        expect(result.kept).toEqual([]);
        expect(result.uncovered).toEqual(['r1']);
    });
});

describe('gaps are reported, not hidden', () => {
    test('an unanswerable requirement comes back as uncovered', () => {
        const requirements = [req('r1', 'Kafka'), req('r2', 'Rust')];
        const bullets = [bullet({ id: 'b1', strength: 5, answers: ['r1'] })];
        const result = selectBullets(bullets, requirements, CAPS);
        expect(result.uncovered).toEqual(['r2']);
    });

    test('a requirement whose only evidence was cut counts as uncovered', () => {
        // Honest, and the interesting case: the candidate HAS the evidence, it
        // just did not make the page. The editor can then offer to swap it in
        // rather than silently claiming coverage the document does not have.
        const requirements = [req('r1', 'Kubernetes'), req('r2', 'Kafka')];
        const bullets = [
            bullet({ id: 'b1', strength: 5, answers: ['r1'] }),
            bullet({ id: 'b2', strength: 5, answers: ['r1'] }),
            bullet({ id: 'b3', strength: 4, answers: ['r2'], groupId: 'e2' }),
        ];
        const result = selectBullets(bullets, requirements, { maxPerGroup: 2, maxGroups: 1 });
        expect(result.kept.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
        expect(result.uncovered).toEqual(['r2']);
    });
});

describe('which roles make the page', () => {
    test('a group is judged on its best two lines, not its best one', () => {
        // One lucky line should not carry an otherwise empty role onto a resume
        // ahead of a role with consistent substance.
        const bullets = [
            bullet({ id: 'a1', groupId: 'lucky', strength: 5 }),
            bullet({ id: 'a2', groupId: 'lucky', strength: 2 }),
            bullet({ id: 'b1', groupId: 'solid', strength: 4 }),
            bullet({ id: 'b2', groupId: 'solid', strength: 4 }),
        ];
        const result = selectBullets(bullets, [], { maxPerGroup: 4, maxGroups: 1 });
        expect(keptGroups(result)).toEqual(['solid']);
    });

    test('groups beyond the cap contribute nothing', () => {
        const bullets = [
            bullet({ id: 'a1', groupId: 'g1', strength: 5 }),
            bullet({ id: 'b1', groupId: 'g2', strength: 4 }),
            bullet({ id: 'c1', groupId: 'g3', strength: 3 }),
        ];
        const result = selectBullets(bullets, [], { maxPerGroup: 4, maxGroups: 2 });
        expect(keptGroups(result).sort()).toEqual(['g1', 'g2']);
        expect(result.dropped.map((d) => d.bullet.id)).toEqual(['c1']);
    });
});

describe('the same input always makes the same resume', () => {
    test('ties break deterministically', () => {
        // A candidate who regenerates and gets a different document stops
        // trusting the tool. Worth more than any marginal ordering gain.
        const bullets = [
            bullet({ id: 'z', strength: 4 }),
            bullet({ id: 'a', strength: 4 }),
            bullet({ id: 'm', strength: 4 }),
        ];
        const runs = Array.from({ length: 5 }, () =>
            selectBullets(bullets, [], { maxPerGroup: 2, maxGroups: 4 })
                .kept.map((b) => b.id)
                .join(','),
        );
        expect(new Set(runs).size).toBe(1);
        expect(runs[0]).toBe('a,m');
    });
});

describe('helpers', () => {
    test('keptForGroup returns that group, strongest first', () => {
        const bullets = [
            bullet({ id: 'b1', groupId: 'e1', strength: 3 }),
            bullet({ id: 'b2', groupId: 'e1', strength: 5 }),
            bullet({ id: 'b3', groupId: 'e2', strength: 4 }),
        ];
        const result = selectBullets(bullets, [], CAPS);
        expect(keptForGroup(result, 'e1').map((b) => b.id)).toEqual(['b2', 'b1']);
    });

    test('an empty history is not an error', () => {
        const result = selectBullets([], [req('r1', 'Kafka')], CAPS);
        expect(result.kept).toEqual([]);
        expect(result.uncovered).toEqual(['r1']);
    });
});
