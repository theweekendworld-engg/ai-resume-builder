import { describe, expect, test } from 'bun:test';
import { orderStrengths, topStrength } from './strength';
import { isBaselineRequirement } from './match';

describe('topStrength', () => {
    test('shipped work beats a degree, even when the degree is listed first', () => {
        const pick = topStrength([
            { requirementId: 'r1', text: "Bachelor's degree in CS", evidence: 'B.Tech, Engineering and Computational Mechanics, IIT Delhi', strength: 'direct' },
            { requirementId: 'r2', text: 'Scalable backend services', evidence: 'Developed 5 microservices for notifications and RBAC', strength: 'direct' },
        ]);
        expect(pick?.requirementId).toBe('r2');
    });

    test('a partial work match beats a direct degree match', () => {
        expect(topStrength([
            { requirementId: 'r1', text: 'Degree', evidence: 'B.Tech', strength: 'direct' },
            { requirementId: 'r2', text: 'Kafka', evidence: 'Airflow pipelines', strength: 'partial' },
        ])?.requirementId).toBe('r2');
    });

    test('with only a degree, it is still shown; with nothing, null', () => {
        expect(topStrength([{ requirementId: 'r1', text: 'Degree', evidence: 'B.Tech', strength: 'direct' }])?.requirementId).toBe('r1');
        expect(topStrength([])).toBeNull();
    });

    test('tenure never leads: "3 years of experience" was the top strength for an engineer with an agent platform (QA 2026-11-07)', () => {
        const matched = [
            { requirementId: 'r1', text: '3+ years in engineering', evidence: 'About 4 years full-time (from your role dates)', strength: 'direct' as const },
            { requirementId: 'r2', text: 'Client-facing delivery', evidence: 'Delivered client-facing deployments for enterprise customers', strength: 'partial' as const },
            { requirementId: 'r3', text: "Bachelor's degree", evidence: 'B.Tech, VIT', strength: 'direct' as const },
        ];
        expect(topStrength(matched)?.requirementId).toBe('r2');
        expect(orderStrengths(matched).map((m) => m.requirementId)).toEqual(['r2', 'r3', 'r1']);
        // Only tenure and a degree: the degree, then tenure as the last resort.
        expect(topStrength([matched[0], matched[2]])?.requirementId).toBe('r3');
        expect(topStrength([{ ...matched[0], evidence: '5 years of experience (stated on your profile)' }])?.requirementId).toBe('r1');
    });

    test('orderStrengths puts the degree last', () => {
        const ordered = orderStrengths([
            { requirementId: 'r1', text: "Bachelor's degree", evidence: 'B.Tech', strength: 'direct' },
            { requirementId: 'r2', text: 'Go', evidence: 'Search engine in Go', strength: 'direct' },
        ]);
        expect(ordered.map((m) => m.requirementId)).toEqual(['r2', 'r1']);
    });
});

describe('isBaselineRequirement', () => {
    test.each([
        'Experience with version control systems, such as Git',
        'Familiarity with Agile/Scrum methodologies',
        'Working knowledge of Linux and the command line',
        'Git',
        'Understanding of object-oriented programming',
        'Understanding of programming fundamentals',
        'Strong knowledge of data structures and algorithms',
    ])('"%s" is baseline tooling, not a gap', (text) => expect(isBaselineRequirement(text)).toBe(true));

    test.each([
        'Familiarity with orchestration tools like Kubernetes',
        'Strong background in PHP',
        'Experience with Git and Kafka',
        '5+ years of backend development',
        'Object-oriented programming in C++ for embedded systems',
    ])('"%s" stays a real requirement', (text) => expect(isBaselineRequirement(text)).toBe(false));
});
