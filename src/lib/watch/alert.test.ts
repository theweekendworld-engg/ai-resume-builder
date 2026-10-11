import { describe, expect, test } from 'bun:test';
import { alertItem, alertKeyboard, alertSubject, decodeWatchAction, encodeWatchAction, renderChatAlert, withoutSpentWatchButtons, type AlertItem } from './alert';

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

describe('chat buttons', () => {
    test('encode and decode round-trip within Telegram\'s 64 bytes; junk decodes to null', () => {
        const id = 'cmv3v1duy000765olaq80taji';
        for (const kind of ['track', 'outreach', 'pass'] as const) {
            const data = encodeWatchAction(kind, id);
            expect(data.length).toBeLessThanOrEqual(64);
            expect(decodeWatchAction(data)).toEqual({ kind, matchId: id });
        }
        expect(decodeWatchAction('jw:z:abc')).toBeNull();
        expect(decodeWatchAction('sc:t:abc')).toBeNull();
        expect(decodeWatchAction('jw:t:../../etc')).toBeNull();
    });

    test('one row per shown job, numbered only when there are several', () => {
        expect(alertKeyboard([item()])[0].map((b) => b.text)).toEqual(['✓ Track', '✉ Outreach', '✕ Not for me']);
        const many = alertKeyboard([1, 2, 3, 4].map((i) => item({ matchId: `m${i}` })));
        expect(many).toHaveLength(3);
        expect(many[1][0].text).toBe('✓ Track 2');
    });

    test('tracking spends Track and Not-for-me; passing spends the row; outreach spends nothing', () => {
        const rows = alertKeyboard([item({ matchId: 'a' }), item({ matchId: 'b' })]);
        expect(withoutSpentWatchButtons(rows, { kind: 'track', matchId: 'a' })[0].map((b) => b.text)).toEqual(['✉ Outreach 1']);
        expect(withoutSpentWatchButtons(rows, { kind: 'pass', matchId: 'a' })).toHaveLength(1);
        expect(withoutSpentWatchButtons(rows, { kind: 'outreach', matchId: 'a' })).toEqual(rows);
    });

    test('with buttons, the text points at them instead of the page actions', () => {
        expect(renderChatAlert([item()], 'https://app/watch', { buttons: true })).toContain('Tap below');
    });
});
