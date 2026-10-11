import { describe, expect, test } from 'bun:test';
import { alertItem, alertSubject, renderChatAlert, type AlertItem } from './alert';

const item = (over: Partial<AlertItem> = {}): AlertItem => ({
    matchId: 'm1',
    title: 'Senior Backend Engineer',
    company: 'Stripe',
    location: 'Bengaluru',
    url: 'https://boards.greenhouse.io/stripe/jobs/1',
    score: 91,
    mustCovered: 5,
    mustTotal: 5,
    strongest: { requirement: 'Production Go services', evidence: 'Built the billing ledger in Go' },
    gap: 'Kafka',
    person: { name: 'Priya Rao', why: '1st-degree · Recruiter at Stripe · recruiting', url: null },
    searchLink: null,
    compensation: null,
    ...over,
});

describe('alertItem', () => {
    test('leads with a direct match and the first person; search link only without one', () => {
        const built = alertItem({
            matchId: 'm1', title: 'T', company: 'C', location: null, url: 'u', score: 90, compensation: null,
            coverage: { mustCovered: 4, mustTotal: 4 },
            fit: {
                matched: [
                    { requirementId: 'r1', text: 'Kubernetes', evidence: 'Ran EKS', strength: 'partial' },
                    { requirementId: 'r2', text: 'Go', evidence: 'Wrote Go services', strength: 'direct' },
                ],
                gaps: [],
            },
            people: { targets: [], searchLinks: [{ label: 'Recruiters at C', url: 'https://linkedin/search' }], hasContactsImported: false },
        });
        expect(built.strongest).toEqual({ requirement: 'Go', evidence: 'Wrote Go services' });
        expect(built.person).toBeNull();
        expect(built.searchLink?.label).toBe('Recruiters at C');
    });
});

describe('renderChatAlert', () => {
    test('every number is a computed one, and the page link closes it', () => {
        const text = renderChatAlert([item()], 'https://app/watch');
        expect(text).toContain('A new job you match 85% or more:');
        expect(text).toContain('Match 91 · evidence for 5 of 5 must-haves');
        expect(text).toContain('Why: "Production Go services" ← Built the billing ledger in Go');
        expect(text).toContain('Talk to: Priya Rao');
        expect(text.trim().endsWith('https://app/watch')).toBe(true);
    });

    test('three shown, the rest counted', () => {
        const items = [1, 2, 3, 4, 5].map((i) => item({ matchId: `m${i}`, title: `Role ${i}` }));
        const text = renderChatAlert(items, 'https://app/watch');
        expect(text).toContain('5 new jobs');
        expect(text).toContain('Role 3');
        expect(text).not.toContain('Role 4');
        expect(text).toContain('+2 more');
    });

    test('subject names the one job, or counts them', () => {
        expect(alertSubject([item()])).toBe('Senior Backend Engineer at Stripe: match 91');
        expect(alertSubject([item(), item()])).toBe('2 new jobs you match 85% or more');
    });
});
