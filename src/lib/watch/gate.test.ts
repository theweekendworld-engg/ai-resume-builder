import { describe, expect, test } from 'bun:test';
import { ALERT_MAX_AGE_DAYS, alertGate, type GateInput } from './gate';

const NOW = new Date('2026-10-11T03:00:00Z');

function input(over: Omit<Partial<GateInput>, 'fit' | 'coverage'> & { fit?: Partial<GateInput['fit']>; coverage?: Partial<GateInput['coverage']> } = {}): GateInput {
    return {
        matchedVia: 'model',
        questionOpen: false,
        postedAt: new Date('2026-10-09T00:00:00Z'),
        closed: false,
        now: NOW,
        ...over,
        fit: {
            score: 91,
            verdict: 'strong',
            matched: [],
            gaps: [{ requirementId: 'r6', text: 'Kafka', severity: 'minor' }],
            preferenceChecks: [{ key: 'location', status: 'match', detail: 'Bengaluru' }],
            notFitReasons: [],
            softRequirements: [],
            ...over.fit,
        },
        coverage: { mustCovered: 5, mustTotal: 5, mustRatio: 1, niceRatio: 0.5, uncoveredMusts: 0, ...over.coverage },
    };
}

describe('alertGate', () => {
    test('a strong, fully evidenced, fresh match at 85+ qualifies', () => {
        expect(alertGate(input())).toEqual({ qualifies: true });
        expect(alertGate(input({ fit: { score: 85 } }))).toEqual({ qualifies: true });
    });

    test('84 is held, with the score in the reason', () => {
        const result = alertGate(input({ fit: { score: 84 } }));
        expect(result.qualifies).toBe(false);
        if (!result.qualifies) expect(result.reason).toContain('84');
    });

    test('fails closed on everything unknown or unverified', () => {
        expect(alertGate(input({ matchedVia: 'fallback' })).qualifies).toBe(false);
        expect(alertGate(input({ questionOpen: true })).qualifies).toBe(false);
        expect(alertGate(input({ fit: { score: null } })).qualifies).toBe(false);
        expect(alertGate(input({ fit: { verdict: 'unknown' } })).qualifies).toBe(false);
    });

    test('a deterministic match (nothing needed the model) can qualify', () => {
        expect(alertGate(input({ matchedVia: 'deterministic' })).qualifies).toBe(true);
    });

    test('a preference conflict holds it, and the conflict is the reason', () => {
        const result = alertGate(input({ fit: { preferenceChecks: [{ key: 'work_mode', status: 'conflict', detail: 'Onsite in Pune; you prefer remote' }] } }));
        expect(result).toEqual({ qualifies: false, reason: 'Onsite in Pune; you prefer remote' });
    });

    test('a posting with too few musts cannot score its way in', () => {
        expect(alertGate(input({ fit: { score: 100 }, coverage: { mustCovered: 2, mustTotal: 2 } })).qualifies).toBe(false);
    });

    test('weak must coverage or a blocking gap holds it even at a high score', () => {
        expect(alertGate(input({ coverage: { mustCovered: 3, mustTotal: 5, mustRatio: 0.6 } })).qualifies).toBe(false);
        expect(alertGate(input({ fit: { gaps: [{ requirementId: 'r2', text: 'Active security clearance', severity: 'blocking' }] } })).qualifies).toBe(false);
    });

    test('closed and stale postings are not news', () => {
        expect(alertGate(input({ closed: true })).qualifies).toBe(false);
        const old = new Date(NOW.getTime() - (ALERT_MAX_AGE_DAYS + 1) * 86_400_000);
        expect(alertGate(input({ postedAt: old })).qualifies).toBe(false);
        expect(alertGate(input({ postedAt: null })).qualifies).toBe(true);
    });

    test('an eligibility conflict holds it whatever the score, and says why (QA 2026-11-07)', () => {
        const detail = 'You may not be eligible: requires HHS Public Trust, which generally needs US citizenship or residency. Your profile puts you in Bengaluru, India.';
        const result = alertGate(input({ fit: { score: 97, preferenceChecks: [{ key: 'eligibility', status: 'conflict', detail }] } }));
        expect(result).toEqual({ qualifies: false, reason: detail });
    });

    test('unknown eligibility is a hold, never a pass', () => {
        const result = alertGate(input({ fit: { preferenceChecks: [{ key: 'eligibility', status: 'unknown', detail: 'Requires US citizenship. Your work authorization is not on your profile.' }] } }));
        expect(result.qualifies).toBe(false);
        if (!result.qualifies) expect(result.reason).toStartWith('Eligibility unclear');
        // Eligibility is checked before the open-question reason: it is the one to fix.
        const both = alertGate(input({ questionOpen: true, fit: { preferenceChecks: [{ key: 'eligibility', status: 'unknown', detail: 'x' }] } }));
        if (!both.qualifies) expect(both.reason).toStartWith('Eligibility unclear');
    });

    test('a matched eligibility check does not hold it', () => {
        expect(alertGate(input({ fit: { preferenceChecks: [{ key: 'eligibility', status: 'match', detail: 'Requires US citizenship; you said "US citizen".' }] } }))).toEqual({ qualifies: true });
    });

    test('a remote role scoped to a region the user may be outside of is held when unclear', () => {
        const scoped = alertGate(input({ fit: { preferenceChecks: [{ key: 'location', status: 'unknown', detail: 'Remote within the US (Remote - US); could not tell whether Atlantis is inside it' }] } }));
        expect(scoped.qualifies).toBe(false);
        const scopedConflict = alertGate(input({ fit: { preferenceChecks: [{ key: 'location', status: 'conflict', detail: 'Remote within the US (DMV preferred); you are based in Bengaluru, India' }] } }));
        expect(scopedConflict).toEqual({ qualifies: false, reason: 'Remote within the US (DMV preferred); you are based in Bengaluru, India' });
        // Any other unknown location behaves as before.
        expect(alertGate(input({ fit: { preferenceChecks: [{ key: 'location', status: 'unknown', detail: 'The posting does not state a location' }] } })).qualifies).toBe(true);
    });
});
