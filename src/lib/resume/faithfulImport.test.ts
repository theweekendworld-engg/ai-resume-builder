import { describe, expect, test } from 'bun:test';

import { ParsedResumeSchema } from '@/lib/aiSchemas';
import { dedupeContained, reconcileWithSource, withoutHeader } from './faithfulImport';

const SOURCE = `PRIYA RAMAN
Senior Software Engineer

EXPERIENCE
Flexport (freight forwarding) San Francisco
Senior Software Engineer | Go, Postgres 2021 – Present
• Cut invoice generation p95 from 4.2s to 900ms with a batched
query and a covering index.
• Led the migration of 9 services from EC2 to Kubernetes.
Instacart, Software Engineer. Built the order settlement pipeline processing 1.2M orders per day. 2018 – 2021

PROJECTS
Searchlight | Rust, Tantivy
• Wrote a full-text search engine.
• Indexed 40GB of logs in 6 minutes.

SKILLS
Languages: Go, Rust, SQL
Data: Postgres, Kafka`;

function parse(value: unknown) {
    return ParsedResumeSchema.parse(value);
}

describe('reconcileWithSource', () => {
    const proposed = parse({
        personalInfo: { fullName: 'Priya Raman', title: 'Senior Software Engineer', summary: 'Results-driven engineer passionate about scale.' },
        experiences: [
            {
                company: 'Flexport',
                role: 'Senior Software Engineer',
                description: 'Led backend engineering for a freight forwarding platform.',
                highlights: ['Cut invoice generation p95 from 4.2s to 900ms.'],
            },
            {
                company: 'Instacart',
                role: 'Software Engineer',
                description: 'Built the order settlement pipeline.',
                highlights: ['Built the order settlement pipeline processing 1.2M orders per day.'],
            },
            { company: 'Stripe', role: 'Staff Engineer', highlights: ['Scaled payments to 10x.'] },
        ],
        projects: [{ name: 'Searchlight', description: 'A search engine in Rust that indexed 40GB of logs.', technologies: ['Rust', 'Elasticsearch'] }],
        education: [{ institution: 'University of Bristol', degree: 'BSc' }],
        skills: ['Go', 'Observability'],
    });
    const { data, audit } = reconcileWithSource(proposed, SOURCE);

    test('marked bullets come from the source, whole, and the model\'s are ignored', () => {
        expect(data.experiences[0].highlights).toEqual([
            'Cut invoice generation p95 from 4.2s to 900ms with a batched query and a covering index.',
            'Led the migration of 9 services from EC2 to Kubernetes.',
        ]);
    });

    test('a role summary is never stored, and an invented one is reported', () => {
        expect(data.experiences.every((item) => item.description === '')).toBe(true);
        expect(audit.rejected.map((entry) => entry.text)).toContain('Led backend engineering for a freight forwarding platform.');
    });

    test('a one-line role keeps one bullet: the longer, complete one', () => {
        expect(data.experiences[1].highlights).toEqual(['Built the order settlement pipeline processing 1.2M orders per day.']);
    });

    test('an employer the resume never names is dropped', () => {
        expect(data.experiences.map((item) => item.company)).toEqual(['Flexport', 'Instacart']);
    });

    test('tag line and stack are kept out of the bullets and in their own fields', () => {
        expect(data.experiences[0].companyNote).toBe('freight forwarding');
        expect(data.experiences[0].stack).toBe('Go, Postgres');
    });

    test('project bullets are lines; technologies are what the project line prints', () => {
        expect(data.projects[0].description).toBe('Wrote a full-text search engine.\nIndexed 40GB of logs in 6 minutes.');
        expect(data.projects[0].technologies).toEqual(['Rust', 'Tantivy']);
    });

    test('skills are the resume\'s rows, and a skill it never lists does not appear', () => {
        expect(data.skillGroups).toEqual([
            { label: 'Languages', items: ['Go', 'Rust', 'SQL'] },
            { label: 'Data', items: ['Postgres', 'Kafka'] },
        ]);
        expect(data.skills).not.toContain('Observability');
    });

    test('an invented summary is removed; a real headline stays', () => {
        expect(data.personalInfo.summary).toBe('');
        expect(data.personalInfo.title).toBe('Senior Software Engineer');
    });

    test('education naming nothing in the source is dropped', () => {
        expect(data.education).toEqual([]);
    });

    test('running it twice changes nothing', () => {
        expect(reconcileWithSource(data, SOURCE).data).toEqual(data);
    });
});

describe('reconcileWithSource without skills rows or bullets', () => {
    test('flat skills are kept only when the resume says them', () => {
        const { data } = reconcileWithSource(
            parse({ personalInfo: {}, skills: ['Go', 'Haskell'] }),
            'EXPERIENCE\nAcme, Engineer. Wrote Go services. 2020 – 2022\nTools I use: Go',
        );
        expect(data.skills).toEqual(['Go']);
    });

    test('a paragraph role takes the model\'s lines only once found in its region', () => {
        const { data, audit } = reconcileWithSource(
            parse({
                personalInfo: {},
                experiences: [{ company: 'Acme', role: 'Engineer', highlights: ['Wrote Go services', 'Mentored four engineers.'] }],
            }),
            'EXPERIENCE\nAcme Engineer 2020 – 2022\nWrote Go services for billing. Mentored two engineers.',
        );
        expect(data.experiences[0].highlights).toEqual(['Wrote Go services for billing.']);
        expect(audit.rejected.map((entry) => entry.text)).toContain('Mentored four engineers.');
    });
});

describe('dedupeContained', () => {
    test('drops a line whose words sit inside a longer one, and exact repeats', () => {
        expect(dedupeContained(['Built X', 'Built X, cutting cost 70%.', 'Built X, cutting cost 70%.', 'Other'])).toEqual([
            'Built X, cutting cost 70%.',
            'Other',
        ]);
    });
});

describe('withoutHeader', () => {
    test('a one-line role loses its "Company, Title." prefix and its dates, nothing else', () => {
        expect(withoutHeader('2Sigma School, SDE Intern. Built an engine, cutting cost 70%.', ['2Sigma School', 'SDE Intern', ''])).toBe('Built an engine, cutting cost 70%.');
        expect(withoutHeader('Swachh.io, SDE Intern. Built a Flutter app. May – Jul 2023', ['Swachh.io', 'SDE Intern'])).toBe('Built a Flutter app.');
    });

    test('a first sentence with any word of its own is kept', () => {
        expect(withoutHeader('Led Acme payments. Shipped it.', ['Acme', 'Engineer'])).toBe('Led Acme payments. Shipped it.');
    });
});

describe('completeStartYear', () => {
    test('a bare start month takes the end year', async () => {
        const { completeStartYear } = await import('./faithfulImport');
        expect(completeStartYear('Mar', 'May 2024')).toBe('Mar 2024');
        expect(completeStartYear('May', 'Jul 2023')).toBe('May 2023');
    });
    test('a range across new year starts the year before', async () => {
        const { completeStartYear } = await import('./faithfulImport');
        expect(completeStartYear('Nov', 'Feb 2024')).toBe('Nov 2023');
    });
    test('anything already dated, or not a month, is left alone', async () => {
        const { completeStartYear } = await import('./faithfulImport');
        expect(completeStartYear('Sep 2025', 'Present')).toBe('Sep 2025');
        expect(completeStartYear('Mar', 'Present')).toBe('Mar');
        expect(completeStartYear('', 'May 2024')).toBe('');
    });
});
