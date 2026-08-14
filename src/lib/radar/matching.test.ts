/**
 * Batch matching.
 *
 * `rankCandidates` is pure, so these run without a database. The two rules
 * with real weight — the sparsity floor and the five-match cap — were both
 * written after watching the ranking misbehave on live postings.
 */

import { describe, expect, test } from 'bun:test';
import { MATCH_LIMIT, rankCandidates, type MatchCandidate, type MatchInput } from './matching';

const CORPUS =
    'senior backend engineer payments postgresql kubernetes typescript python distributed_systems observability aws';

function input(patch: Partial<MatchInput> = {}): MatchInput {
    return {
        corpus: CORPUS,
        geoBuckets: [],
        seniorities: [],
        roleFamilies: [],
        excludeCompanies: [],
        ...patch,
    };
}

function candidate(patch: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
        postingId: crypto.randomUUID(),
        title: 'Senior Backend Engineer',
        companyName: 'Acme',
        absoluteUrl: 'https://example.test/1',
        geoBucket: 'sf_bay',
        seniority: 'senior',
        postedAt: new Date(Date.now() - 2 * 86_400_000),
        compAnnualLow: 200_000,
        compAnnualHigh: 260_000,
        compCurrency: 'USD',
        skills: ['postgresql', 'kubernetes', 'typescript'],
        ...patch,
    };
}

describe('the sparsity floor', () => {
    test('a posting naming one lucky skill does not outrank a real fit', () => {
        // The live failure: "Growth - Lifecycle Lead" topped a backend
        // engineer's matches at 90, on a single `observability` mention,
        // because 1/1 is a perfect ratio.
        const lucky = candidate({ title: 'Growth - Lifecycle Lead', skills: ['observability'] });
        const real = candidate({
            title: 'Staff Backend Engineer',
            skills: ['postgresql', 'kubernetes', 'typescript', 'python', 'aws', 'rust'],
        });

        const ranked = rankCandidates([lucky, real], input());
        expect(ranked.map((m) => m.posting.title)).toEqual(['Staff Backend Engineer']);
    });

    test('exactly at the floor is matchable', () => {
        expect(rankCandidates([candidate({ skills: ['postgresql', 'kubernetes', 'typescript'] })], input()))
            .toHaveLength(1);
    });

    test('below the floor is dropped, not scored low', () => {
        // Scoring it low would still let it surface when little else matches.
        expect(rankCandidates([candidate({ skills: ['postgresql', 'kubernetes'] })], input())).toEqual([]);
        expect(rankCandidates([candidate({ skills: [] })], input())).toEqual([]);
    });
});

describe('ranking', () => {
    test('fit dominates recency', () => {
        const strongOld = candidate({
            title: 'Strong but older',
            skills: ['postgresql', 'kubernetes', 'typescript', 'python'],
            postedAt: new Date(Date.now() - 28 * 86_400_000),
        });
        const weakNew = candidate({
            title: 'Weak but fresh',
            skills: ['rust', 'elixir', 'php', 'scala'],
            postedAt: new Date(),
        });

        expect(rankCandidates([weakNew, strongOld], input())[0].posting.title).toBe('Strong but older');
    });

    test('recency breaks a tie between equal fits', () => {
        const older = candidate({ title: 'Older', postedAt: new Date(Date.now() - 20 * 86_400_000) });
        const newer = candidate({ title: 'Newer', postedAt: new Date() });
        expect(rankCandidates([older, newer], input())[0].posting.title).toBe('Newer');
    });

    test('never returns more than five — more reads as a job board', () => {
        const many = Array.from({ length: 30 }, (_, i) => candidate({ title: `Role ${i}` }));
        expect(rankCandidates(many, input())).toHaveLength(MATCH_LIMIT);
    });

    test('a posting matching nothing is not shown at all', () => {
        // computeFitScore floors at 20, so a total mismatch still returns a
        // number. Rendering it would tell someone "you'd likely win this" on
        // zero evidence. An empty panel is the honest answer.
        expect(rankCandidates([candidate({ skills: ['php', 'scala', 'elixir'] })], input())).toEqual([]);
    });

    test('a partial fit still surfaces — the bar is evidence, not perfection', () => {
        const [match] = rankCandidates(
            [candidate({ skills: ['postgresql', 'kubernetes', 'php', 'scala'] })],
            input(),
        );
        expect(match).toBeDefined();
        expect(match.matched).toContain('postgresql');
        expect(match.missing).toContain('php');
    });
});

describe('the reason shown to a user', () => {
    test('matched skills are reported, so the match is explainable', () => {
        const [match] = rankCandidates([candidate()], input());
        expect(match.matched).toContain('postgresql');
        expect(match.matched).toContain('kubernetes');
    });

    test('missing skills are reported too — that is the gap', () => {
        const [match] = rankCandidates(
            [candidate({ skills: ['postgresql', 'kubernetes', 'rust'] })],
            input(),
        );
        expect(match.missing).toContain('rust');
    });

    test('age is exposed for the UI', () => {
        const [match] = rankCandidates(
            [candidate({ postedAt: new Date(Date.now() - 5 * 86_400_000) })],
            input(),
        );
        expect(match.ageDays).toBe(5);
    });

    test('a posting with no date is treated as oldest, not newest', () => {
        // Unknown must never be rewarded as fresh.
        const [match] = rankCandidates([candidate({ postedAt: null })], input());
        expect(match.ageDays).toBeGreaterThan(0);
    });
});

describe('determinism', () => {
    test('the same candidates always rank the same way', () => {
        const list = [
            candidate({ title: 'A', skills: ['postgresql', 'kubernetes', 'typescript'] }),
            candidate({ title: 'B', skills: ['postgresql', 'python', 'aws'] }),
            candidate({ title: 'C', skills: ['rust', 'php', 'scala'] }),
        ];
        const runs = Array.from({ length: 4 }, () =>
            rankCandidates(list, input()).map((m) => m.posting.title).join(','),
        );
        expect(new Set(runs).size).toBe(1);
    });
});
