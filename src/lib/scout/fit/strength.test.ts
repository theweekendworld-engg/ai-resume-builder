import { describe, expect, test } from 'bun:test';
import { topStrength } from './strength';

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
});
