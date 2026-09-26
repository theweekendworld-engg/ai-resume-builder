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
    ])('"%s" is baseline tooling, not a gap', (text) => expect(isBaselineRequirement(text)).toBe(true));

    test.each([
        'Familiarity with orchestration tools like Kubernetes',
        'Strong background in PHP',
        'Experience with Git and Kafka',
        '5+ years of backend development',
    ])('"%s" stays a real requirement', (text) => expect(isBaselineRequirement(text)).toBe(false));
});
