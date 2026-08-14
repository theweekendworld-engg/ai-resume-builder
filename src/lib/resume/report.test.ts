/**
 * The stored gap report.
 *
 * The interesting cases are all about degradation: a resume with no report, a
 * report written by an older version, and a report whose "answered" entry has
 * nothing on the page to point at.
 */

import { describe, expect, test } from 'bun:test';

import type { CoverageReport } from './coverage';
import { buildReport, openItems, parseReport, verdict, type ResumeCoverage } from './report';

const NOW = new Date('2026-08-07T12:00:00Z');

function req(
    text: string,
    kind: 'must' | 'nice' | 'responsibility' = 'must',
    satisfiedByTenure = false,
) {
    return { id: text, text, kind, category: 'experience' as const, satisfiedByTenure };
}

function coverage(patch: Partial<CoverageReport> = {}): CoverageReport {
    return {
        score: 80,
        mustScore: 75,
        answered: [],
        answeredByCut: [],
        unanswered: [],
        ...patch,
    };
}

function build(patch: Parameters<typeof buildReport>[0]) {
    return buildReport(patch, NOW);
}

describe('flattening for storage', () => {
    const report = build({
        brief: { role: 'Senior Backend Engineer', company: 'Stripe' },
        coverage: coverage({
            answered: [
                { requirement: req('Experience with Kubernetes'), bulletIds: ['e0:1'], via: 'page' as const },
                { requirement: req('6+ years backend'), bulletIds: [], via: 'dates' as const },
            ],
            unanswered: [req('Strong written communication'), req('Terraform', 'nice')],
        }),
        skillGaps: ['Go', 'Terraform'],
        advice: ['Nothing on your resume answers: “Strong written communication”'],
        dropped: [
            {
                id: 'e0:0',
                text: 'Rebuilt the freight billing service.',
                reason: 'cap',
                targetId: 'exp-1',
                targetKind: 'experience',
                targetLabel: 'Senior Software Engineer at Flexport',
            },
        ],
    });

    test('keeps the posting’s own wording', () => {
        expect(report.unanswered[0].text).toBe('Strong written communication');
    });

    test('carries no run-local requirement ids', () => {
        // Those only mean anything inside one generation. Persisting them would
        // put a meaningless key in a column read months later.
        expect(JSON.stringify(report)).not.toContain('"id":"r1"');
    });

    test('marks an entry the DATES answered', () => {
        // Empty bulletIds is the only signal `computeCoverage` gives for it,
        // and "answered" with nothing to point at reads like a bug unless the
        // UI can say where it came from.
        const byDates = report.answered.find((item) => item.text === '6+ years backend');
        expect(byDates?.byDates).toBe(true);
        expect(report.answered.find((i) => i.text.includes('Kubernetes'))?.byDates).toBe(false);
    });

    test('keeps the row a dropped line can be put back into', () => {
        expect(report.dropped[0].targetId).toBe('exp-1');
        expect(report.dropped[0].targetKind).toBe('experience');
    });

    test('round-trips through JSON', () => {
        expect(parseReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    });
});

describe('the gap list stays coherent with the requirements', () => {
    const base = {
        brief: { role: '', company: '' },
        advice: [],
        dropped: [],
    };

    test('a skill contradicted by an answered requirement is dropped', () => {
        // The first live run showed "Experience with cloud infrastructure
        // (AWS)" under ANSWERED and "AWS" under ASKED FOR, LEFT OFF at the
        // same time. Both defensible alone; together the panel looks broken.
        const report = build({
            ...base,
            coverage: coverage({
                answered: [
                    { requirement: req('Experience with cloud infrastructure (AWS)'), bulletIds: ['e0:1'], via: 'page' as const },
                ],
            }),
            skillGaps: ['AWS', 'Terraform'],
        });
        expect(report.skillGaps).toEqual(['Terraform']);
    });

    test('a skill already stated as its own unanswered row is dropped', () => {
        const report = build({
            ...base,
            coverage: coverage({ unanswered: [req('PostgreSQL')] }),
            skillGaps: ['PostgreSQL', 'Terraform'],
        });
        expect(report.skillGaps).toEqual(['Terraform']);
    });

    test('a genuinely additive gap survives', () => {
        const report = build({
            ...base,
            coverage: coverage({ answered: [{ requirement: req('Kubernetes'), bulletIds: ['e0:1'], via: 'page' as const }] }),
            skillGaps: ['Terraform'],
        });
        expect(report.skillGaps).toEqual(['Terraform']);
    });

    test('matching is word-boundary, not substring', () => {
        // "Go" must not be swallowed by "Google Cloud" in a requirement.
        const report = build({
            ...base,
            coverage: coverage({
                answered: [{ requirement: req('Experience with Google Cloud'), bulletIds: ['e0:1'], via: 'page' as const }],
            }),
            skillGaps: ['Go'],
        });
        expect(report.skillGaps).toEqual(['Go']);
    });
});

describe('reading a stored report back', () => {
    test('null for a resume that has none', () => {
        // Written by hand, imported, reused, or made before this existed. The
        // panel hides rather than showing an empty shell.
        expect(parseReport(null)).toBeNull();
        expect(parseReport(undefined)).toBeNull();
    });

    test('null for a shape we do not recognise', () => {
        expect(parseReport({ version: 99, nonsense: true })).toBeNull();
        expect(parseReport('a string')).toBeNull();
        expect(parseReport({ score: 80 })).toBeNull();
    });

    test('a valid report survives', () => {
        const report = build({
            brief: { role: 'Designer', company: 'Monzo' },
            coverage: coverage(),
            skillGaps: [],
            advice: [],
            dropped: [],
        });
        expect(parseReport(report)?.role).toBe('Designer');
    });
});

describe('what leads the panel', () => {
    const report = build({
        brief: { role: '', company: '' },
        coverage: coverage({
            unanswered: [req('Terraform', 'nice'), req('Kubernetes'), req('Kafka')],
        }),
        skillGaps: [],
        advice: [],
        dropped: [],
    });

    test('musts before bonuses', () => {
        expect(openItems(report).map((i) => i.kind)).toEqual(['must', 'must', 'nice']);
    });
});

describe('the verdict line', () => {
    const withMissing = (n: number) =>
        build({
            brief: { role: '', company: '' },
            coverage: coverage({
                unanswered: Array.from({ length: n }, (_, i) => req(`missing ${i}`)),
            }),
            skillGaps: [],
            advice: [],
            dropped: [],
        });

    test('says nothing congratulatory when everything is answered', () => {
        // A candidate at 95% does not need a tool telling them they are
        // impressive. They need to know whether to send it.
        expect(verdict(withMissing(0))).toBe('Every stated requirement is answered.');
    });

    test('counts what is open, and reads as English at one', () => {
        expect(verdict(withMissing(1))).toBe('1 stated requirement is unanswered.');
        expect(verdict(withMissing(3))).toBe('3 stated requirements are unanswered.');
    });

    test('an unscoreable posting says so rather than showing zero', () => {
        const report: ResumeCoverage = {
            ...withMissing(0),
            score: null,
            mustScore: null,
        };
        expect(verdict(report)).toContain('could not read requirements');
    });

    test('bonuses do not count against the verdict', () => {
        const report = build({
            brief: { role: '', company: '' },
            coverage: coverage({ unanswered: [req('Terraform', 'nice')] }),
            skillGaps: [],
            advice: [],
            dropped: [],
        });
        expect(verdict(report)).toBe('Every stated requirement is answered.');
    });
});
