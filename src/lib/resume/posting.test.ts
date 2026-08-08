/**
 * The skill filter.
 *
 * Every string in the "must be rejected" block below is a real value the old
 * pipeline put into a candidate's skills section during the 7 Aug audit run.
 * They are the specification.
 */

import { describe, expect, test } from 'bun:test';

import { cleanSkills, isPlausibleSkill, orderedRequirements, type PostingBrief } from './posting';

describe('what the audit found in a real skills section', () => {
    const shipped = [
        'Building backend systems at scale',
        'Measurable reliability or performance improvements',
        'Design and operate high-throughput services',
        'Reliability, latency and observability improvements',
    ];

    test.each(shipped)('rejects %p', (entry) => {
        expect(isPlausibleSkill(entry)).toBe(false);
    });
});

describe('real skills survive', () => {
    const real = [
        'Go',
        'PostgreSQL',
        'Kubernetes',
        'Kafka',
        'React Native',
        'Google Cloud Platform',
        'Figma',
        'SQL',
        'Terraform',
        'gRPC',
        'Adobe Illustrator',
        'financial modelling',
        'Distributed systems',
        'C++',
    ];

    test.each(real)('keeps %p', (entry) => {
        expect(isPlausibleSkill(entry)).toBe(true);
    });
});

describe('the shape of the test', () => {
    test('a single word passes even when it collides with a verb', () => {
        // "Design" is a discipline and "Scale" is a real product noun. The
        // sentence heuristics only make sense on phrases.
        expect(isPlausibleSkill('Design')).toBe(true);
        expect(isPlausibleSkill('Scala')).toBe(true);
    });

    test('length alone is not the rule — real names are often multi-word', () => {
        expect(isPlausibleSkill('Amazon Web Services')).toBe(true);
        expect(isPlausibleSkill('Building things')).toBe(false);
    });

    test('an empty or whitespace entry is not a skill', () => {
        expect(isPlausibleSkill('')).toBe(false);
        expect(isPlausibleSkill('   ')).toBe(false);
    });
});

describe('cleanSkills', () => {
    test('splits a comma-joined phrase before judging the pieces', () => {
        // The audit case: this arrived as ONE entry and rendered downstream as
        // two bogus skills. Splitting here means each fragment faces the filter.
        expect(cleanSkills(['Reliability, latency and observability improvements'])).toEqual([
            'Reliability',
        ]);
    });

    test('keeps the good half of a mixed list and drops the rest', () => {
        expect(
            cleanSkills(['Go', 'Building backend systems at scale', 'Kafka', 'PostgreSQL']),
        ).toEqual(['Go', 'Kafka', 'PostgreSQL']);
    });

    test('de-duplicates case-insensitively', () => {
        expect(cleanSkills(['Go', 'go', 'GO'])).toEqual(['Go']);
    });

    test('strips a trailing full stop', () => {
        expect(cleanSkills(['Kubernetes.'])).toEqual(['Kubernetes']);
    });

    test('an all-garbage list yields nothing rather than something', () => {
        // Dropping a real skill costs one line. Keeping a fake one costs the
        // reader's trust in the document, so the filter resolves downward.
        expect(cleanSkills(['Design and operate high-throughput services'])).toEqual([]);
    });
});

describe('requirement ordering', () => {
    const brief = {
        role: 'Senior Backend Engineer',
        company: 'Stripe',
        seniority: 'senior',
        domain: 'payments',
        skills: [],
        responsibilities: [],
        requirements: [
            { id: 'r1', text: 'Terraform', kind: 'nice' as const, category: 'skill' as const, satisfiedByTenure: false },
            { id: 'r2', text: '6+ years backend', kind: 'must' as const, category: 'experience' as const, satisfiedByTenure: true },
            { id: 'r3', text: 'Mentor engineers', kind: 'must' as const, category: 'behaviour' as const, satisfiedByTenure: false },
        ],
    } satisfies PostingBrief;

    test('must-haves lead', () => {
        expect(orderedRequirements(brief).map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
    });

    test('order within a kind is the posting’s own emphasis order', () => {
        // The model returns them ordered by emphasis; a stable sort preserves
        // that rather than imposing an alphabetical or categorical order we
        // have no basis for.
        expect(orderedRequirements(brief).slice(0, 2).map((r) => r.text)).toEqual([
            '6+ years backend',
            'Mentor engineers',
        ]);
    });
});
