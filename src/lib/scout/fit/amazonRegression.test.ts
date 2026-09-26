/**
 * Regression: the Amazon SDE II, Alexa Connections posting, run
 * cmue7pqf7000065wvgw2qkkoe (2026-09-23).
 *
 * That run returned verdict 'strong' at score 87 beside a summary that said
 * "evidence for 2 of 12 stated requirements"; listed "hustle" and
 * "customer-centric" as missing must-haves; called "Experience programming
 * with at least one software programming language" a gap for a working
 * full-stack engineer; and evidenced "2+ years of design or architecture" with
 * "2 years of experience (stated on your profile)".
 *
 * Built from the real page (`ingest/__fixtures__/linkedin-guest-job.html`), the
 * requirement list that run's JD section produced, and a record shaped like
 * the real user's. Each test pins one of those failures.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { parseLinkedInGuestJob } from '@/lib/scout/ingest/linkedin';
import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import type { JdData } from '@/lib/scout/types';
import { fakeContext, okSection } from '@/lib/scout/fit/testContext.test-utils';
import { __testing as fitTesting, fitSection } from '@/lib/scout/sections/fit';
import {
    STRONG_MIN_MUST_COVERAGE,
    buildFitRecord,
    evaluateFit,
    summaryAgrees,
} from './evaluate';
import { detectWorkMode, extractExperienceText } from './jdSignals';
import { isSoftRequirement, planMatching, resolveModelJudgements, tenureRequirement, type Judgement } from './match';

const HTML = readFileSync(join(import.meta.dir, '../ingest/__fixtures__/linkedin-guest-job.html'), 'utf8');
const parsed = parseLinkedInGuestJob(HTML);
if (!parsed.ok) throw new Error('fixture no longer parses');
const PAGE = parsed.data;

/** Exactly what the JD section produced for this posting in the bad run. */
const REQUIREMENTS: JdData['requirements'] = [
    { id: 'r1', kind: 'must', text: '3+ years of non-internship professional software development experience' },
    { id: 'r2', kind: 'must', text: '2+ years of non-internship design or architecture (design patterns, reliability and scaling) of new and existing systems experience' },
    { id: 'r3', kind: 'must', text: 'Experience programming with at least one software programming language' },
    { id: 'r4', kind: 'must', text: 'practical experience building large-scale distributed systems' },
    { id: 'r5', kind: 'must', text: 'a sound understanding of the fundamentals of Computer Science' },
    { id: 'r6', kind: 'must', text: 'strong communication skills (to both business and technical partners)' },
    { id: 'r7', kind: 'must', text: 'A commitment to teamwork' },
    { id: 'r8', kind: 'must', text: 'hustle' },
    { id: 'r9', kind: 'must', text: 'exceptional technical expertise' },
    { id: 'r10', kind: 'must', text: 'customer-centric' },
    { id: 'r11', kind: 'nice', text: '3+ years of full software development life cycle, including coding standards, code reviews, source control management, build processes, testing, and operations experience' },
    { id: 'r12', kind: 'nice', text: "Bachelor's degree in computer science or equivalent" },
    { id: 'd1', kind: 'responsibility', text: 'designing and building highly scalable distributed backend systems' },
];

const SOFT_IDS = ['r6', 'r7', 'r8', 'r9', 'r10'];

const JD: JdData = {
    role: PAGE.title ?? 'Software Dev Engineer II, Alexa Connections',
    company: PAGE.companyName ?? 'Amazon',
    seniority: 'mid',
    domain: 'voice assistants',
    location: PAGE.location,
    workMode: detectWorkMode({ location: PAGE.location, title: PAGE.title, text: PAGE.text }),
    employmentType: 'Full-time',
    compensationText: null,
    experienceText: extractExperienceText(PAGE.text),
    requirements: REQUIREMENTS,
    skills: [],
    responsibilities: [],
    applyUrl: null,
};

/** Shaped like the real user: 2 stated years, two roles, projects, a degree. */
function record(yearsExperience = '2') {
    return buildFitRecord({
        profile: {
            location: 'Bengaluru, India',
            defaultTitle: 'Software Engineer',
            defaultSummary: 'Full-stack Software Engineer focused on building scalable, reliable systems, with strong interest in blockchain and distributed systems.',
            yearsExperience,
        },
        experiences: [
            {
                company: 'Plivo Inc.', role: 'Software Engineer I', startDate: 'Sept 2025', endDate: 'Present', current: true, description: '',
                highlights: [
                    'Fixed production issues and optimized backend APIs for onboarding, invoicing, billing and payments reducing P95 latency on critical endpoints by 25%.',
                    'Built an internal multi-agent AI system with Slack integration, RAG pipelines over internal docs and logs, and Elastic-based observability.',
                ],
            },
            {
                company: 'Hyperbots Inc.', role: 'Software Engineer I', startDate: 'June 2024', endDate: 'Aug 2025', current: false, description: '',
                highlights: [
                    'Developed 5 microservices for scalable, template-driven notifications, RBAC, job scheduling and Config management processing 100K+ events/day.',
                    'Implemented CQRS (Elasticsearch for reads, MongoDB/PostgreSQL for writes) to boost query throughput by 60%.',
                ],
            },
        ],
        projects: [{ name: 'AI Search Engine', description: 'Search engine with a web crawler', technologies: ['Go', 'Elasticsearch', 'PostgreSQL'] }],
        education: [{ institution: 'Indian Institute of Technology Delhi', degree: 'B.Tech', fieldOfStudy: 'Engineering and Computational Mechanics' }],
        now: new Date('2026-09-23'),
    });
}

const prefs = { ...defaultUserGenerationPreferences, willingToRelocate: 'yes' as const };

function lineIndex(fragment: string, r = record()): number {
    const index = r.lines.findIndex((line) => line.text.includes(fragment));
    if (index < 0) throw new Error(`no record line contains "${fragment}"`);
    return index;
}

function judged(entries: Record<string, { fragment: string | null; strength?: 'direct' | 'partial' }>): Map<string, Judgement> {
    const out = new Map<string, Judgement>();
    for (const [id, entry] of Object.entries(entries)) {
        out.set(id, {
            requirementId: id,
            lineIndex: entry.fragment === null ? null : lineIndex(entry.fragment),
            strength: entry.fragment === null ? null : entry.strength ?? 'direct',
            source: 'model',
        });
    }
    return out;
}

afterEach(() => fitTesting.reset());

describe('the posting itself', () => {
    test('experienceText is a complete phrase, not "3+ years of"', () => {
        expect(JD.experienceText).toBe('3+ years');
    });

    test('the traits in this posting are soft; the knowledge requirements are not', () => {
        for (const id of SOFT_IDS) {
            const requirement = REQUIREMENTS.find((r) => r.id === id)!;
            expect({ id, soft: isSoftRequirement(requirement.text) }).toEqual({ id, soft: true });
        }
        for (const id of ['r3', 'r4', 'r5', 'r12']) {
            const requirement = REQUIREMENTS.find((r) => r.id === id)!;
            expect({ id, soft: isSoftRequirement(requirement.text) }).toEqual({ id, soft: false });
        }
    });

    test('pure-tenure and qualified-tenure requirements are told apart', () => {
        expect(tenureRequirement(REQUIREMENTS[0].text)).toEqual({ minYears: 3, qualified: false });
        expect(tenureRequirement(REQUIREMENTS[1].text)).toEqual({ minYears: 2, qualified: true });
        expect(tenureRequirement(REQUIREMENTS[10].text)).toEqual({ minYears: 3, qualified: true });
    });
});

describe('soft traits are never gaps and never scored', () => {
    test('with the keyword fallback', () => {
        const result = evaluateFit({ jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {} });
        const scoredIds = [...result.fit.gaps, ...result.fit.matched].map((entry) => entry.requirementId);
        for (const id of SOFT_IDS) expect(scoredIds).not.toContain(id);
        expect(result.softRequirements).toContain('hustle');
        expect(result.softRequirements).toContain('customer-centric');
    });

    test('with a model that also flags one as soft', () => {
        const plan = planMatching(JD, record());
        const { softIds } = resolveModelJudgements(
            { judgements: plan.toAsk.map((_, i) => ({ requirement: i + 1, soft: plan.toAsk[i].id === 'r5', evidence: null, strength: null })) },
            plan.toAsk,
            record().lines.length,
        );
        // Knowledge requirements the model calls "soft" are honoured as the
        // model's call — but years are never soft, whatever the model says.
        expect(softIds.has('r5')).toBe(true);
        const years = resolveModelJudgements({ judgements: [{ requirement: 1, soft: true, evidence: null, strength: null }] }, [REQUIREMENTS[1]], 10);
        expect(years.softIds.size).toBe(0);
    });
});

describe('years are never evidenced by tenure alone', () => {
    test('a qualified years requirement with no qualifying line is a gap, even with the years', () => {
        const result = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record('5'), prefs, answers: {},
            judgements: judged({ r2: { fragment: null }, r3: { fragment: 'Developed 5 microservices' } }),
        });
        expect(result.fit.gaps.map((gap) => gap.requirementId)).toContain('r2');
        for (const entry of result.fit.matched) {
            if (entry.requirementId === 'r2' || entry.requirementId === 'r11') {
                expect(entry.evidence).not.toMatch(/years of experience/);
            }
        }
    });

    test('with a qualifying line, the evidence is the line, never a tenure sentence', () => {
        const result = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {},
            judgements: judged({ r2: { fragment: 'Developed 5 microservices' } }),
        });
        const r2 = result.fit.matched.find((entry) => entry.requirementId === 'r2');
        expect(r2?.evidence).toContain('Developed 5 microservices');
    });

    test('a pure tenure requirement is judged from years in code', () => {
        const short = evaluateFit({ jd: JD, jdText: PAGE.text, record: record('2'), prefs, answers: {} });
        expect(short.fit.gaps.map((gap) => gap.requirementId)).toContain('r1');
        const enough = evaluateFit({ jd: JD, jdText: PAGE.text, record: record('4'), prefs, answers: {} });
        expect(enough.fit.matched.find((entry) => entry.requirementId === 'r1')?.evidence).toBe('4 years of experience (stated on your profile)');
    });
});

describe('score, verdict and summary agree with coverage', () => {
    test('never strong with less than half the hard musts covered', () => {
        // Only r3 of the five hard musts (r1–r5) is evidenced.
        const result = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record('5'), prefs, answers: {},
            judgements: judged({ r2: { fragment: null }, r3: { fragment: 'Developed 5 microservices' }, r4: { fragment: null }, r5: { fragment: null } }),
        });
        expect(result.coverage.mustTotal).toBe(5);
        expect(result.coverage.mustCovered).toBeLessThan(result.coverage.mustTotal / 2);
        expect(result.fit.verdict).not.toBe('strong');
        expect(result.fit.verdict).not.toBe('possible');
        expect(result.fit.score).toBeLessThan(60);
    });

    test('the keyword fallback on this posting is not strong either', () => {
        const result = evaluateFit({ jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {} });
        expect(result.coverage.mustRatio!).toBeLessThan(STRONG_MIN_MUST_COVERAGE);
        expect(result.fit.verdict).not.toBe('strong');
    });

    test('a recruiter-style match of this record is a possible fit, short on years', () => {
        const result = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {},
            judgements: judged({
                r2: { fragment: 'Developed 5 microservices' },
                r3: { fragment: 'Developed 5 microservices' },
                r4: { fragment: 'processing 100K+ events/day', strength: 'partial' },
                r5: { fragment: 'B.Tech' },
                r11: { fragment: 'Fixed production issues', strength: 'partial' },
                r12: { fragment: 'B.Tech', strength: 'partial' },
            }),
        });
        expect(result.coverage).toMatchObject({ mustCovered: 4, mustTotal: 5 });
        expect(result.fit.gaps.map((gap) => gap.requirementId)).toEqual(['r1']);
        expect(result.fit.verdict).toBe('possible');
    });

    test('a profile summary line never settles a requirement', () => {
        const result = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {},
            judgements: judged({ r4: { fragment: 'strong interest in blockchain', strength: 'direct' } }),
        });
        const withSummary = result.coverage.mustRatio!;
        const withBullet = evaluateFit({
            jd: JD, jdText: PAGE.text, record: record(), prefs, answers: {},
            judgements: judged({ r4: { fragment: 'processing 100K+ events/day', strength: 'direct' } }),
        }).coverage.mustRatio!;
        expect(withSummary).toBeLessThan(withBullet);
    });

    test('summaryAgrees rejects the summary that shipped', () => {
        const coverage = { mustCovered: 4, mustTotal: 5, mustRatio: 0.7, niceRatio: 0.5, uncoveredMusts: 1 };
        expect(summaryAgrees('A strong fit for this role.', 'possible', coverage)).toBe(false);
        expect(summaryAgrees('A possible fit: evidence for 2 of 12 stated requirements.', 'possible', coverage)).toBe(false);
        expect(summaryAgrees('This is not a fit.', 'strong', coverage)).toBe(false);
        expect(summaryAgrees('Possible fit: you cover 4 of 5 must-have requirements.', 'possible', coverage)).toBe(true);
    });

    test('out-of-range line numbers from the model are dropped, not trusted', () => {
        const plan = planMatching(JD, record());
        const { judgements } = resolveModelJudgements(
            { judgements: [{ requirement: 1, soft: false, evidence: 999, strength: 'direct' }, { requirement: 2, soft: false, evidence: 0, strength: 'direct' }] },
            plan.toAsk,
            record().lines.length,
        );
        expect([...judgements.values()].every((judgement) => judgement.lineIndex === null)).toBe(true);
    });
});

describe('the fit section end to end, with a scripted model', () => {
    test('code maps indices to the user\'s real lines, and a warmer summary is replaced', async () => {
        const r = record();
        fitTesting.setLoader(async () => ({ record: r, prefs }));
        const calls: string[] = [];
        const ctx = fakeContext({
            sections: { jd: okSection<'jd'>(JD), ingest: okSection<'ingest'>({
                ...PAGE, sourceUrl: 'https://www.linkedin.com/jobs/view/4455902670', linkKind: 'linkedin_job', fetchVia: 'guest_job_api', truncated: false,
            }) },
            ai: (async (opts: { system: string; prompt: string }) => {
                if (opts.system.includes('recruiter screening')) {
                    calls.push('match');
                    // Requirements are numbered in the prompt; find them by text.
                    const numbered = [...opts.prompt.matchAll(/^(\d+)\. (.+)$/gm)];
                    const reqNumber = (fragment: string) => Number(numbered.find((m) => m[2].includes(fragment))![1]);
                    const lineNumber = (fragment: string) => lineIndex(fragment, r) + 1;
                    return {
                        data: {
                            judgements: [
                                { requirement: reqNumber('design or architecture'), soft: false, evidence: lineNumber('Developed 5 microservices'), strength: 'direct' },
                                { requirement: reqNumber('at least one software programming language'), soft: false, evidence: lineNumber('Developed 5 microservices'), strength: 'direct' },
                                { requirement: reqNumber('fundamentals of Computer Science'), soft: false, evidence: lineNumber('B.Tech'), strength: 'direct' },
                                { requirement: reqNumber('large-scale distributed systems'), soft: false, evidence: lineNumber('100K+ events/day'), strength: 'partial' },
                            ],
                        },
                        degraded: false,
                    };
                }
                calls.push('summary');
                return { data: { summary: 'This is a strong fit — apply today.' }, degraded: false };
            }) as never,
        });

        const outcome = await fitSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(calls).toEqual(['match', 'summary']);
        expect(outcome.data.verdict).toBe('possible');
        expect(outcome.data.summary).not.toContain('strong fit');
        expect(outcome.data.summary).toContain('4 of 5');
        const programming = outcome.data.matched.find((m) => m.requirementId === 'r3');
        expect(programming?.evidence).toContain('Developed 5 microservices');
        for (const id of SOFT_IDS) expect(outcome.data.gaps.map((gap) => gap.requirementId)).not.toContain(id);
    });
});
