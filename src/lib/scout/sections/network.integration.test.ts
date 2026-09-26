import { afterAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { importConnectionsCsv } from '@/lib/contacts/import';
import { CONNECTIONS_FIXTURE } from '@/lib/contacts/linkedinExport.fixture';
import type { ClassifyData, IngestData, JdData } from '@/lib/scout/types';
import { fakeContext, okSection } from '@/lib/scout/fit/testContext.test-utils';
import { contactRank, networkSection, peopleSearchUrl, sameCompany } from './network';

const USER = `itest-network-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMPTY = `${USER}-empty`;

afterAll(async () => {
    for (const userId of [USER, EMPTY]) {
        await prisma.contact.deleteMany({ where: { userId } });
        await prisma.userExperience.deleteMany({ where: { userId } });
        await prisma.userEducation.deleteMany({ where: { userId } });
    }
});

const jd = (company: string): JdData => ({
    role: 'Backend Engineer', company, seniority: '', domain: 'payments', location: null, workMode: 'unknown',
    employmentType: null, compensationText: null, experienceText: null, applyUrl: null,
    requirements: [], skills: [], responsibilities: [],
});

const ingest: IngestData = {
    sourceUrl: 'https://www.linkedin.com/posts/x', linkKind: 'linkedin_post', fetchVia: 'public_html',
    title: null, author: 'Kavya Rao', authorUrl: 'https://www.linkedin.com/in/kavya', companyName: 'Stripe',
    location: null, postedAt: null, applicantsText: null, text: 'We are hiring', truncated: false,
};
const hiring: ClassifyData = { kind: 'hiring_post', confidence: 0.9, companies: ['Stripe'], roleTitle: 'Backend Engineer', reason: '' };

describe('networkSection', () => {
    test('poster first, then 1st-degree contacts at the company with the recruiter on top', async () => {
        await importConnectionsCsv(USER, CONNECTIONS_FIXTURE);
        await prisma.userExperience.create({
            data: { userId: USER, company: 'Flipkart', role: 'SDE', startDate: '2020', endDate: '2022', current: false, location: '', description: '', highlights: [] },
        });
        await prisma.userEducation.create({ data: { userId: USER, institution: 'IIT Madras', degree: 'B.Tech', fieldOfStudy: 'CS', startDate: '2014', endDate: '2018', current: false } });

        const outcome = await networkSection(fakeContext({
            userId: USER,
            sections: { ingest: okSection<'ingest'>(ingest), classify: okSection<'classify'>(hiring), jd: okSection<'jd'>(jd('Stripe')) },
        }));
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;

        expect(outcome.data.hasContactsImported).toBe(true);
        expect(outcome.data.targets[0]).toMatchObject({ tier: 'poster', fullName: 'Kavya Rao' });
        const first = outcome.data.targets.filter((t) => t.tier === 'first_degree');
        expect(first.map((t) => t.fullName)).toEqual(['Priya Sharma']);
        expect(first[0].why).toContain('Technical Recruiter');
        expect(first[0].why).toContain('connected Mar 2024');

        const labels = outcome.data.searchLinks.map((link) => link.label);
        expect(labels).toContain('IIT Madras alumni at Stripe');
        expect(labels).toContain('Ex-Flipkart people now at Stripe');
        expect(outcome.data.searchLinks.every((link) => link.url.startsWith('https://www.linkedin.com/search/results/people/'))).toBe(true);
    });

    test('with no contacts imported, it says so and still gives search links', async () => {
        const outcome = await networkSection(fakeContext({ userId: EMPTY, sections: { jd: okSection<'jd'>(jd('Amazon')) } }));
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.hasContactsImported).toBe(false);
        expect(outcome.data.targets).toEqual([]);
        expect(outcome.data.searchLinks.length).toBeGreaterThanOrEqual(3);
    });

    test('no company, no network', async () => {
        const outcome = await networkSection(fakeContext({ userId: EMPTY }));
        expect(outcome.status).toBe('unavailable');
    });
});

describe('helpers', () => {
    test('sameCompany treats subsidiaries written as parent + suffix as the parent', () => {
        expect(sameCompany('Amazon Web Services (AWS)', 'Amazon')).toBe(true);
        expect(sameCompany('Stripe, Inc.', 'Stripe')).toBe(true);
        expect(sameCompany('Amazonia Foods', 'Amazon')).toBe(false);
    });

    test('contactRank: recruiters, then people who can hire, then same function', () => {
        expect(contactRank('Senior Technical Recruiter', [])).toBe(0);
        expect(contactRank('Engineering Manager, Payments', [])).toBe(1);
        expect(contactRank('Backend Engineer', ['backend'])).toBe(2);
        expect(contactRank('Account Executive', ['backend'])).toBe(3);
    });

    test('peopleSearchUrl encodes keywords and the network filter', () => {
        const url = new URL(peopleSearchUrl('Stripe', ['S']));
        expect(url.searchParams.get('keywords')).toBe('Stripe');
        expect(url.searchParams.get('network')).toBe('["S"]');
    });
});
