/**
 * The title chooser.
 *
 * The model calls in this module are exercised by the eval; this file covers
 * the pure part, which is where the 7 Aug audit's top-line defect lived.
 */

import { describe, expect, test } from 'bun:test';

import { chooseTitle, mentionedTerms } from './write';

describe('the mangled title from the audit', () => {
    test('a posting headline with a department does not become the title', () => {
        // What shipped: "Senior Backend Engineer Payments Infrastructure" —
        // the posting's headline with its punctuation stripped, on line one of
        // the document.
        expect(
            chooseTitle({
                candidateTitle: 'Senior Software Engineer',
                postingRole: 'Senior Backend Engineer — Payments Infrastructure',
            }),
        ).toBe('Senior Backend Engineer');
    });

    test('a long department string falls back to the candidate’s own title', () => {
        expect(
            chooseTitle({
                candidateTitle: 'Senior Software Engineer',
                postingRole: 'Staff Engineer Platform Infrastructure and Developer Experience',
            }),
        ).toBe('Senior Software Engineer');
    });
});

describe('meeting the posting halfway', () => {
    test('a clean posting title is adopted — it is what the reader scans for', () => {
        expect(
            chooseTitle({ candidateTitle: 'Software Engineer', postingRole: 'Backend Engineer' }),
        ).toBe('Backend Engineer');
    });

    test('parenthetical noise is dropped', () => {
        expect(
            chooseTitle({ candidateTitle: 'Designer', postingRole: 'Product Designer (Remote)' }),
        ).toBe('Product Designer');
    });

    test('a comma-separated team is dropped', () => {
        expect(
            chooseTitle({ candidateTitle: 'Analyst', postingRole: 'Data Analyst, Growth' }),
        ).toBe('Data Analyst');
    });

    test('identical titles are left exactly as the candidate wrote them', () => {
        expect(
            chooseTitle({ candidateTitle: 'Senior Engineer', postingRole: 'senior engineer' }),
        ).toBe('Senior Engineer');
    });
});

describe('missing input', () => {
    test('no posting role keeps the candidate’s title', () => {
        expect(chooseTitle({ candidateTitle: 'Product Manager', postingRole: '' })).toBe(
            'Product Manager',
        );
    });

    test('no candidate title falls back to the cleaned posting role', () => {
        expect(
            chooseTitle({ candidateTitle: '', postingRole: 'Product Manager, Payments' }),
        ).toBe('Product Manager');
    });

    test('neither yields an empty string rather than a placeholder', () => {
        expect(chooseTitle({ candidateTitle: '', postingRole: '' })).toBe('');
    });
});

describe('the summary cannot claim a skill the candidate lacks', () => {
    // The first live v2 run wrote "Brings deep PostgreSQL and Kafka expertise"
    // for a candidate who has never mentioned PostgreSQL — lifted out of the
    // requirement "Deep experience with databases (PostgreSQL, Kafka)". The
    // numeric guard polices figures, not nouns, so this is the check for it.
    const gaps = ['Go', 'PostgreSQL', 'Terraform'];

    test('catches the exact sentence that shipped', () => {
        expect(
            mentionedTerms(
                'Brings deep PostgreSQL and Kafka expertise, Kubernetes migration experience.',
                gaps,
            ),
        ).toEqual(['PostgreSQL']);
    });

    test('a clean summary passes', () => {
        expect(
            mentionedTerms('Senior backend engineer who owns high-throughput services.', gaps),
        ).toEqual([]);
    });

    test('matches case-insensitively', () => {
        expect(mentionedTerms('worked with postgresql daily', gaps)).toEqual(['PostgreSQL']);
    });

    test('does not fire inside a longer word', () => {
        // "Go" must not match "Going" — the same trap the skills matcher has.
        expect(mentionedTerms('Going to scale the platform', gaps)).toEqual([]);
    });

    test('reports every offender, not just the first', () => {
        expect(mentionedTerms('Used Go and Terraform extensively', gaps)).toEqual([
            'Go',
            'Terraform',
        ]);
    });

    test('an empty forbidden list forbids nothing', () => {
        expect(mentionedTerms('Anything at all', [])).toEqual([]);
    });
});
