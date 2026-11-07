import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SourceSet } from '@/lib/agent/sources';
import { __testing as cacheTesting, createMemoryStore } from '@/lib/research/cache';
import { __testing as providerTesting } from '@/lib/research/providers';
import type { SearchArgs, SearchResult } from '@/lib/research/types';
import { findPeopleOnWeb, isProfileUrl, personFromResult } from './people';

const DAY = '2026-10-11';
const at = (url: string, title: string) => personFromResult({ url, title }, 'Stripe', DAY);

describe('personFromResult', () => {
    test('reads name, headline and role from the profile title', () => {
        expect(at('https://in.linkedin.com/in/priya-rao', 'Priya Rao - Technical Recruiter - Stripe | LinkedIn')).toMatchObject({
            fullName: 'Priya Rao', headline: 'Technical Recruiter', role: 'recruiter', foundAt: DAY,
        });
        expect(at('https://www.linkedin.com/in/arjun', 'Arjun Mehta – Engineering Manager, Payments at Stripe | LinkedIn')).toMatchObject({
            fullName: 'Arjun Mehta', headline: 'Engineering Manager, Payments', role: 'hiring_manager',
        });
        expect(at('https://linkedin.com/in/x', 'Priya Rao, PHR - Talent Acquisition Partner - Stripe | LinkedIn')?.fullName).toBe('Priya Rao');
    });

    test('the company must be in the title, exactly: a snippet mention or a lookalike is not enough', () => {
        expect(at('https://linkedin.com/in/a', 'Priya Rao - Technical Recruiter - Razorpay | LinkedIn')).toBeNull();
        expect(personFromResult({ url: 'https://linkedin.com/in/b', title: 'Asha K - Recruiter - Zeta Global | LinkedIn' }, 'Zeta', DAY)).toBeNull();
    });

    test('only personal profiles, only recruiters and managers, only plausible names', () => {
        expect(at('https://www.linkedin.com/company/stripe', 'Stripe - Recruiter - Stripe | LinkedIn')).toBeNull();
        expect(at('https://www.linkedin.com/jobs/view/1', 'Recruiter - Stripe | LinkedIn')).toBeNull();
        expect(at('https://linkedin.com/in/c', 'Priya Rao - Software Engineer - Stripe | LinkedIn')).toBeNull();
        expect(at('https://linkedin.com/in/d', 'Stripe Jobs 2026 - Recruiter - Stripe | LinkedIn')).toBeNull();
        expect(at('https://linkedin.com/in/e', 'Priya - Recruiter - Stripe | LinkedIn')).toBeNull();
    });

    test('isProfileUrl', () => {
        expect(isProfileUrl('https://in.linkedin.com/in/priya-rao/')).toBe(true);
        expect(isProfileUrl('https://linkedin.com.evil.test/in/priya')).toBe(false);
        expect(isProfileUrl('https://www.linkedin.com/in/priya/details/experience')).toBe(false);
    });
});

describe('findPeopleOnWeb', () => {
    let queries: string[] = [];
    const results: Record<'recruiter' | 'manager', SearchResult[]> = {
        recruiter: [
            { url: 'https://linkedin.com/in/priya', title: 'Priya Rao - Technical Recruiter - Stripe | LinkedIn', content: 'Hiring engineers', rawContent: null, publishedDate: null, score: 1 },
            { url: 'https://linkedin.com/in/old', title: 'Old Hand - Recruiter - Razorpay | LinkedIn', content: 'ex-Stripe', rawContent: null, publishedDate: null, score: 1 },
        ],
        manager: [
            { url: 'https://linkedin.com/in/generic', title: 'Dev Shah - Engineering Manager - Stripe | LinkedIn', content: '', rawContent: null, publishedDate: null, score: 1 },
            { url: 'https://linkedin.com/in/arjun', title: 'Arjun Mehta - Engineering Manager, Payments - Stripe | LinkedIn', content: '', rawContent: null, publishedDate: null, score: 1 },
        ],
    };

    beforeEach(() => {
        queries = [];
        cacheTesting.setStore(createMemoryStore());
        providerTesting.setProvider({
            name: 'fake',
            async search(args: SearchArgs) {
                queries.push(args.query);
                return { kind: 'ok', results: /recruiter/.test(args.query) ? results.recruiter : results.manager, costUsd: 0.008 };
            },
        } as never);
    });
    afterEach(() => {
        cacheTesting.setStore(null);
        providerTesting.setProvider(undefined);
    });

    const step = () => ({ sources: new SourceSet(), signal: AbortSignal.timeout(5_000), addCost: () => {}, log: () => {} });

    test('verified people only, team-relevant managers first, every one a fetched page', async () => {
        const s = step();
        const people = await findPeopleOnWeb({ step: s, company: 'Stripe', role: 'Senior Backend Engineer', team: 'Payments' });
        expect(people.map((p) => p.fullName)).toEqual(['Priya Rao', 'Arjun Mehta', 'Dev Shah']);
        for (const person of people) expect(s.sources.has(person.profileUrl)).toBe(true);
        expect(queries[1]).toContain('"Payments"');
    });

    test('cached for the next user: no second search', async () => {
        await findPeopleOnWeb({ step: step(), company: 'Stripe', role: 'Backend Engineer', team: null });
        const before = queries.length;
        const again = await findPeopleOnWeb({ step: step(), company: 'Stripe', role: 'Backend Engineer', team: null });
        expect(queries.length).toBe(before);
        expect(again.map((p) => p.fullName)).toContain('Priya Rao');
    });

    test('research off: nobody, no error', async () => {
        providerTesting.setProvider(null);
        expect(await findPeopleOnWeb({ step: step(), company: 'Stripe', role: 'Backend Engineer' })).toEqual([]);
    });
});
