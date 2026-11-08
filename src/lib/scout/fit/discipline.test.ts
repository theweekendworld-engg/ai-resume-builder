import { describe, expect, test } from 'bun:test';
import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import type { JdData } from '@/lib/scout/types';
import { detectGaps } from '@/services/channelGenerate';
import { disciplineOf, lineShowsDiscipline, roleShowsDiscipline, rolesAnswerDiscipline } from './discipline';
import { buildFitRecord, disciplineTenure, evaluateFit, type RecordInput } from './evaluate';
import { planMatching, tenureRequirement } from './match';

const NOW = new Date('2026-11-08');

/** The owner's record (live test 2026-11-08): two SWE I roles, both backend work, and two internships. */
const OWNER_ROLES: RecordInput['experiences'] = [
    {
        company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', endDate: '', current: true, description: '',
        highlights: [
            'Optimized the voice media path (RTP handling, kernel and socket tuning, codec/transcoding hot paths, GC and memory-pressure reduction) and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls.',
            'Built an agentic AI support platform using RAG over production logs, internal docs and microservice codebases, with Slack and CLI workflows that automate support triage.',
            'Developed internal engineering automation integrating Kubernetes, Jenkins, GitHub, Slack and deploy pipelines, cutting staging validation and deployment time by 70%.',
        ],
    },
    {
        company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', current: false, description: '',
        highlights: [
            'Built and ran 5 microservices (notifications, RBAC, scheduling, config) handling 100K+ events a day.',
            'Moved read-heavy screens to CQRS, with writes in MongoDB and Postgres and reads served from Elasticsearch views kept in sync by events.',
            'Cut API response times by 40% with missing indexes, rewrites of the slowest queries and schema fixes.',
        ],
    },
    { company: '2Sigma School', role: 'SDE Intern', startDate: 'Mar 2024', endDate: 'May 2024', current: false, description: '', highlights: ['Built a remote and in-browser code execution engine on Cloud Run'] },
    { company: 'Swachh.io', role: 'SDE Intern', startDate: 'May 2023', endDate: 'Jul 2023', current: false, description: '', highlights: ['Built a Flutter affiliate app on Shopify'] },
];

/** Four-plus years of frontend work and nothing else. */
const FRONTEND_ROLES: RecordInput['experiences'] = [
    {
        company: 'Acme', role: 'Frontend Engineer', startDate: 'Jan 2022', endDate: '', current: true, description: '',
        highlights: ['Built React and TypeScript dashboards used by 20K users', 'Integrated REST APIs into the React app with React Query', 'Cut bundle size 40% with code splitting'],
    },
    {
        company: 'Globex', role: 'Software Engineer', startDate: 'Jan 2020', endDate: 'Dec 2021', current: false, description: '',
        highlights: ['Built the design system in React and Storybook', 'Integrated REST APIs into the React checkout'],
    },
];

const record = (experiences: RecordInput['experiences']) => buildFitRecord({
    profile: { location: 'Bengaluru', defaultTitle: 'Software Engineer', defaultSummary: '', yearsExperience: '' },
    experiences,
    projects: [],
    now: NOW,
});

function jd(text: string): JdData {
    return {
        role: 'Backend Engineer', company: 'Acme', seniority: 'mid', domain: 'saas', location: 'Bengaluru', workMode: 'onsite',
        employmentType: null, compensationText: null, experienceText: null,
        requirements: [{ id: 'r1', text, kind: 'must' }], skills: [], responsibilities: [], applyUrl: null,
    };
}

function judge(text: string, experiences: RecordInput['experiences'], cite: string | null) {
    const r = record(experiences);
    const posting = jd(text);
    const judgements = new Map();
    if (cite) {
        const index = r.lines.findIndex((line) => line.text.includes(cite));
        judgements.set('r1', { requirementId: 'r1', lineIndex: index, strength: 'direct', source: 'model' });
    }
    const result = evaluateFit({
        jd: posting, jdText: text, record: r,
        prefs: { ...defaultUserGenerationPreferences, preferredWorkModes: ['onsite'] },
        answers: {}, plan: planMatching(posting, r), judgements,
    });
    return { matched: result.fit.matched.find((m) => m.requirementId === 'r1') ?? null, gap: result.fit.gaps.find((g) => g.requirementId === 'r1') ?? null };
}

describe('naming a discipline', () => {
    test('a years requirement whose qualifier is only a discipline', () => {
        expect(tenureRequirement('2+ years of backend engineering')?.discipline).toBe('backend');
        expect(tenureRequirement('3+ years of experience in back-end development')?.discipline).toBe('backend');
        expect(tenureRequirement('3+ years of server-side development')?.discipline).toBe('backend');
        expect(tenureRequirement('2+ years building distributed systems')?.discipline).toBe('distributed_systems');
        expect(tenureRequirement('4+ years of platform engineering')?.discipline).toBe('platform');
        expect(tenureRequirement('2+ recent years of backend engineering')?.discipline).toBe('backend');
    });

    test('anything narrower is not a discipline: the extra condition still needs its own evidence', () => {
        expect(tenureRequirement('3+ years backend experience with Go')?.discipline).toBeNull();
        expect(tenureRequirement('2+ recent years building GenAI solutions')?.discipline).toBeNull();
        expect(tenureRequirement('2+ years owning a paid budget over $1M')?.discipline).toBeNull();
        // Pure tenure stays pure tenure.
        expect(tenureRequirement('3+ years of professional software development')).toEqual({ minYears: 3, qualified: false, discipline: null });
        expect(disciplineOf('software engineering')).toBeNull();
    });

    test('a role is in the discipline by its title, or by a general title and its own lines', () => {
        expect(roleShowsDiscipline({ title: 'Senior Backend Engineer', lines: [] }, 'backend')).toBe(true);
        expect(roleShowsDiscipline({ title: 'Software Engineer I', lines: ['Built and ran 5 microservices'] }, 'backend')).toBe(true);
        expect(roleShowsDiscipline({ title: 'Software Engineer I', lines: ['Built React dashboards'] }, 'backend')).toBe(false);
        // A frontend title never counts toward backend, whatever its lines say.
        expect(roleShowsDiscipline({ title: 'Frontend Engineer', lines: ['Moved reads to PostgreSQL'] }, 'backend')).toBe(false);
        expect(roleShowsDiscipline({ title: 'Product Manager', lines: ['Specified the payments API'] }, 'backend')).toBe(false);
        // Consuming an API from React is frontend work.
        expect(lineShowsDiscipline('Integrated REST APIs into the React app', 'backend')).toBe(false);
        expect(lineShowsDiscipline('Cut API response times by 40% with missing indexes', 'backend')).toBe(true);
    });
});

describe('"2+ years of backend engineering" across roles (live test 2026-11-08)', () => {
    test('the owner\'s two SWE roles are summed: about 2 years of backend work, met, internships apart', () => {
        const found = disciplineTenure(record(OWNER_ROLES), 'backend');
        expect(found.roles).toEqual(['Software Engineer I at Plivo', 'Software Engineer I at Hyperbots']);
        expect(found.months).toBeGreaterThan(28);
        expect(found.months).toBeLessThan(30);

        // The model cited the Hyperbots line (14 months alone): the dates of both roles decide it.
        const { matched, gap } = judge('2+ years of backend engineering', OWNER_ROLES, 'microservices (notifications');
        expect(gap).toBeNull();
        expect(matched).toEqual({
            requirementId: 'r1',
            text: '2+ years of backend engineering',
            evidence: 'About 2 years of backend work across Software Engineer I at Plivo and Software Engineer I at Hyperbots (from your role dates)',
            strength: 'direct',
        });
    });

    test('met even when the model cites nothing', () => {
        expect(judge('2+ years of backend engineering', OWNER_ROLES, null).matched?.strength).toBe('direct');
    });

    test('3+ years is not met by the same record: partial, and the evidence says it is short', () => {
        const { matched } = judge('3+ years of backend engineering', OWNER_ROLES, 'microservices (notifications');
        expect(matched?.strength).toBe('partial');
    });

    test('"recent" counts only roles current or ended within a year', () => {
        const found = disciplineTenure(record(OWNER_ROLES), 'backend', true);
        expect(found.roles).toEqual(['Software Engineer I at Plivo']);
        expect(judge('2+ recent years of backend engineering', OWNER_ROLES, 'microservices (notifications').matched?.strength).toBe('partial');
    });

    test('a frontend-only record does not meet "3+ years backend", for all its years', () => {
        expect(disciplineTenure(record(FRONTEND_ROLES), 'backend').roles).toEqual([]);
        const cited = judge('3+ years of backend engineering', FRONTEND_ROLES, 'Integrated REST APIs into the React app');
        expect(cited.matched?.strength ?? null).not.toBe('direct');
        const uncited = judge('3+ years of backend engineering', FRONTEND_ROLES, null);
        expect(uncited.matched).toBeNull();
        expect(uncited.gap?.severity).toBe('blocking');
        // A model that cites a frontend line in a general-titled role that spans the years: still not direct.
        expect(judge('1+ years of backend engineering', FRONTEND_ROLES, 'Integrated REST APIs into the React checkout').matched?.strength).toBe('partial');
        // ...and its own discipline is summed the same way.
        expect(judge('3+ years of frontend development', FRONTEND_ROLES, null).matched?.strength).toBe('direct');
    });
});

test('a backend line the lexicon does not know, cited by the matcher in a role that spans the years, is still direct', () => {
    const roles: RecordInput['experiences'] = [{
        company: 'Fintech Co', role: 'Software Engineer', startDate: 'Jan 2021', endDate: '', current: true, description: '',
        highlights: ['Built the payments ledger in Go'],
    }];
    expect(disciplineTenure(record(roles), 'backend').roles).toEqual([]);
    expect(judge('3+ years of backend engineering', roles, 'payments ledger').matched?.strength).toBe('direct');
});

describe('tailoring\'s clarification questions', () => {
    const roles = (experiences: RecordInput['experiences']) => experiences.map((e) => ({ title: e.role, lines: e.highlights }));

    test('"Backend engineering" is not asked of someone whose roles were backend work', () => {
        expect(rolesAnswerDiscipline('Backend engineering', roles(OWNER_ROLES))).toBe(true);
        expect(rolesAnswerDiscipline('Distributed systems', roles(OWNER_ROLES))).toBe(true);
        expect(rolesAnswerDiscipline('Software development', roles(OWNER_ROLES))).toBe(true);
        const gaps = detectGaps({
            requiredSkills: ['Backend engineering', 'Kafka', 'Software Engineering'],
            contextText: OWNER_ROLES.map((role) => `${role.role} ${role.company} ${role.highlights.join(' ')}`).join('\n'),
            roles: roles(OWNER_ROLES),
        });
        expect(gaps).toEqual(['Kafka']);
    });

    test('a frontend-only record is still asked', () => {
        expect(rolesAnswerDiscipline('Backend engineering', roles(FRONTEND_ROLES))).toBe(false);
        const gaps = detectGaps({ requiredSkills: ['Backend engineering'], contextText: 'Frontend Engineer React dashboards', roles: roles(FRONTEND_ROLES) });
        expect(gaps).toEqual(['Backend engineering']);
    });
});
