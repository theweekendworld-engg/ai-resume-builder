/**
 * Generation, end to end, with a scripted model.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Every rule in `src/lib/resume` is unit-tested in isolation, and the v2
 * rebuild was still verified by probes run by hand and then deleted. That is
 * exactly the gap that let the original defects ship: `improveResumeForLowAts`
 * had unit tests too, and none of them ran the pipeline.
 *
 * So these run the real `tailorResume` — real selection, real skill gating,
 * real guard, real assembly — against a scripted model.
 *
 * ── Why the scripts misbehave ───────────────────────────────────────────────
 *
 * A cooperative model proves nothing. Every safety property in this module
 * exists because a model will, sooner or later, propose a skill the candidate
 * lacks or invent a number that reads well. So most of these fixtures script a
 * model that does exactly that, and assert the system refuses it.
 *
 * The stages are told apart by distinctive text in their prompts. If a prompt
 * is reworded so a matcher stops firing, the fixture falls through to a
 * catch-all that fails loudly rather than silently scripting nothing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import { installMocks, mocks, resetMocks, uninstallMocks } from '@/__mocks__';
import type { ExperienceItem, ProjectItem, ResumeData } from '@/types/resume';
import { tailorResume, type TailorResult } from './tailor';

// ─────────────────────────────────────────────────────────── prompt markers

const IS_POSTING = 'Read this job posting';
const IS_SELECT = "THE CANDIDATE'S OWN LINES:";
const IS_WRITE = 'Rewrite each line so a hiring manager';
const IS_SUMMARY = 'Write the opening summary';

// ─────────────────────────────────────────────────────────── fixtures

const BACKEND_LINES = [
    'Rebuilt the freight billing service that issues customer invoices.',
    'Cut invoice generation p95 from 4.2s to 900ms by replacing N+1 lookups with a batched query and a read-through cache.',
    'Led the migration of 9 services from EC2 to Kubernetes with zero customer-visible downtime.',
    'Introduced structured logging and traces across the billing domain, cutting mean time to diagnose from 45 minutes to 8.',
    'Mentored 3 engineers; two were promoted within the year.',
];

const SETTLEMENT_LINES = [
    'Built and owned the order settlement pipeline processing 1.2M orders per day.',
    'Reduced settlement failures from 2.4% to 0.3% over two quarters by adding idempotent retries.',
    'Wrote the Kafka consumer framework adopted by 6 teams.',
];

function experience(patch: Partial<ExperienceItem> & { id: string }): ExperienceItem {
    return {
        company: 'Flexport',
        role: 'Senior Software Engineer',
        startDate: '2021-03',
        endDate: '',
        current: true,
        location: 'San Francisco, CA',
        description: BACKEND_LINES.join('\n'),
        ...patch,
    };
}

const BACKEND_INPUT = {
    jobDescription: 'Senior Backend Engineer at Stripe. Kubernetes, Kafka, mentoring.',
    profile: {
        fullName: 'Priya Raman',
        title: 'Senior Software Engineer',
        email: 'p@example.com',
        phone: '',
        location: 'San Francisco, CA',
        website: '',
        linkedin: '',
        github: '',
        summary: 'Backend engineer working on payments.',
    },
    experiences: [
        experience({ id: 'exp-flexport' }),
        experience({
            id: 'exp-instacart',
            company: 'Instacart',
            role: 'Software Engineer',
            startDate: '2018-06',
            endDate: '2021-02',
            current: false,
            description: SETTLEMENT_LINES.join('\n'),
        }),
    ],
    projects: [] as ProjectItem[],
    education: [],
    candidateSkills: [] as string[],
    sectionOrder: ['experience', 'projects', 'skills', 'education'] as ResumeData['sectionOrder'],
    userId: 'eval-user',
};

/** The posting, as a well-behaved reader would return it. */
const BACKEND_BRIEF = {
    role: 'Senior Backend Engineer',
    company: 'Stripe',
    seniority: 'senior',
    domain: 'payments',
    requirements: [
        { text: 'Experience with Kubernetes', kind: 'must', category: 'skill' },
        { text: 'Mentor engineers and raise the technical bar', kind: 'must', category: 'behaviour' },
        { text: '6+ years building backend systems', kind: 'must', category: 'experience' },
        { text: 'Experience with Terraform', kind: 'nice', category: 'skill' },
    ],
    skills: ['Kubernetes', 'Kafka', 'Terraform', 'Go'],
    responsibilities: ['Own critical payment services'],
};

/**
 * Score bullets so that the mentoring line answers the mentoring requirement
 * and is the WEAKEST of Flexport's five. That is the audit's exact shape: it
 * only survives if coverage beats strength.
 */
function scoreBackend(prompt: string) {
    const ids = [...prompt.matchAll(/^(e\d+:\d+) \|/gm)].map((m) => m[1]);
    return {
        bullets: ids.map((id) => {
            const [group, index] = id.split(':');
            const isFlexport = group === 'e0';
            if (isFlexport && index === '4') return { id, answers: ['r2'], strength: 3 };
            if (isFlexport && index === '2') return { id, answers: ['r1'], strength: 5 };
            if (isFlexport && index === '0') return { id, answers: [], strength: 4 };
            return { id, answers: [], strength: isFlexport ? 5 : 4 };
        }),
    };
}

/** Echo the candidate's lines back unchanged — an honest writer. */
function echoWrite(prompt: string) {
    const pairs = [...prompt.matchAll(/^(e\d+:\d+) \| (.+)$/gm)];
    return { bullets: pairs.map((m) => ({ id: m[1], text: m[2] })) };
}

/** The mock hands handlers the whole call, not just the prompt. */
type CallArgs = { prompt: string };

type Script = {
    posting?: unknown;
    select?: (prompt: string) => unknown;
    write?: (prompt: string) => unknown;
    summary?: unknown;
};

function script(overrides: Script = {}) {
    const openai = mocks().openai;
    openai.onObject(IS_POSTING, () => overrides.posting ?? BACKEND_BRIEF);
    openai.onObject(IS_SELECT, (args: CallArgs) => (overrides.select ?? scoreBackend)(args.prompt));
    openai.onObject(IS_WRITE, (args: CallArgs) => (overrides.write ?? echoWrite)(args.prompt));
    openai.onObject(IS_SUMMARY, () =>
        overrides.summary ?? { summary: 'Backend engineer who owns payment services end to end.' },
    );
    // Anything unmatched means a prompt was reworded and a matcher above went
    // stale. Fail loudly rather than scripting nothing.
    openai.onObject(/./, () => {
        throw new Error('eval: an unrecognised model call reached the mock — a prompt marker is stale');
    });
}

async function run(overrides: Script = {}, input = BACKEND_INPUT): Promise<TailorResult> {
    script(overrides);
    return tailorResume(input);
}

function allText(resume: ResumeData): string {
    return [
        resume.personalInfo.summary,
        ...resume.experience.flatMap((e) => e.description.split('\n')),
        ...resume.projects.map((p) => p.description),
    ].join('\n');
}

beforeAll(() => installMocks({ only: ['openai'] }));
afterEach(() => resetMocks());
afterAll(() => uninstallMocks());

// ═══════════════════════════════════════════════════════ the audit failures

describe('the 7 Aug audit failures, end to end', () => {
    test('a bullet answering a stated must survives the cap', async () => {
        const result = await run();
        // Five source lines, four slots, and the mentoring line is the weakest.
        // It is on the page because the posting asked for mentoring.
        expect(allText(result.resume)).toContain('Mentored 3 engineers');
    });

    test('no skill ships that the candidate cannot evidence', async () => {
        const result = await run();
        // The posting wants Terraform and Go. Neither appears in their history.
        expect(result.resume.skills).not.toContain('Terraform');
        expect(result.resume.skills).not.toContain('Go');
        expect(result.skillGaps).toContain('Terraform');
        expect(result.skillGaps).toContain('Go');
    });

    test('the strongest lines are not lost', async () => {
        const result = await run();
        const text = allText(result.resume);
        expect(text).toContain('1.2M orders per day');
        expect(text).toContain('adopted by 6 teams');
    });

    test('the title is the job title, not the posting headline', async () => {
        const result = await run({
            posting: { ...BACKEND_BRIEF, role: 'Senior Backend Engineer — Payments Infrastructure' },
        });
        expect(result.resume.personalInfo.title).toBe('Senior Backend Engineer');
    });

    test('the score reflects what is answered, and names what is not', async () => {
        const result = await run();
        expect(result.coverage.score).toBeGreaterThan(0);
        // Terraform is a nice-to-have nothing answers.
        expect(result.coverage.unanswered.map((r) => r.text)).toContain('Experience with Terraform');
    });
});

// ═══════════════════════════════════════════════════════ adversarial models

describe('when the model misbehaves', () => {
    test('a skill it invents in the summary is refused', async () => {
        // The exact sentence the first live v2 run produced.
        const result = await run({
            summary: { summary: 'Brings deep PostgreSQL and Terraform expertise to payments work.' },
        });
        expect(result.resume.personalInfo.summary).not.toContain('Terraform');
    });

    test('and after two tries it falls back to something dull and true', async () => {
        const result = await run({
            summary: { summary: 'Expert in Terraform and Go across large fleets.' },
        });
        const summary = result.resume.personalInfo.summary;
        expect(summary).not.toContain('Terraform');
        expect(summary).not.toContain('Go ');
        // The fallback still says who they are rather than going blank.
        expect(summary.length).toBeGreaterThan(0);
        expect(summary).toContain('Senior Software Engineer');
    });

    test('a number it invents in a bullet does not reach the page', async () => {
        const result = await run({
            write: (prompt: string) => {
                const pairs = [...prompt.matchAll(/^(e\d+:\d+) \| (.+)$/gm)];
                return {
                    bullets: pairs.map((m, index) => ({
                        id: m[1],
                        // A plausible, invented improvement on the first line.
                        text: index === 0 ? 'Cut latency by 77% and saved $2.4M annually.' : m[2],
                    })),
                };
            },
        });
        const text = allText(result.resume);
        expect(text).not.toContain('77%');
        expect(text).not.toContain('$2.4M');
    });

    test('a requirement id it hallucinates creates no phantom coverage', async () => {
        const result = await run({
            select: (prompt: string) => {
                const ids = [...prompt.matchAll(/^(e\d+:\d+) \|/gm)].map((m) => m[1]);
                return { bullets: ids.map((id) => ({ id, answers: ['r99', 'nonsense'], strength: 4 })) };
            },
        });
        // Nothing a BULLET could answer is answered. The years requirement
        // still is, because the candidate's dates answer it and no model
        // opinion was involved — which is exactly why tenure is handled
        // separately from what the model claims.
        expect(result.coverage.unanswered.map((r) => r.text).sort()).toEqual([
            'Experience with Kubernetes',
            'Experience with Terraform',
            'Mentor engineers and raise the technical bar',
        ]);
        expect(result.coverage.answered.map((a) => a.requirement.text)).toEqual([
            '6+ years building backend systems',
        ]);
        expect(result.coverage.answered[0].bulletIds).toEqual([]);
    });

    test('bullets it forgets to return fall back to the candidate’s own words', async () => {
        const result = await run({ write: () => ({ bullets: [] }) });
        const text = allText(result.resume);
        expect(text).toContain('1.2M orders per day');
        expect(result.resume.experience.every((e) => e.description.trim().length > 0)).toBe(true);
    });

    test('a posting it cannot read yields no score rather than a zero', async () => {
        const result = await run({
            posting: { ...BACKEND_BRIEF, requirements: [], skills: [] },
        });
        // "We could not read this posting" and "this answers nothing" are
        // different facts.
        expect(result.coverage.score).toBeNull();
    });

    test('skills it proposes are evidence-checked like anything else', async () => {
        const result = await run({}, {
            ...BACKEND_INPUT,
            candidateSkills: ['Kubernetes', 'Rust', 'Haskell'],
        });
        expect(result.resume.skills).toContain('Kubernetes');
        expect(result.resume.skills).not.toContain('Rust');
        expect(result.resume.skills).not.toContain('Haskell');
    });
});

// ═══════════════════════════════════════════════════════ invariants

describe('invariants that must hold whatever the model does', () => {
    test('every skill on the page appears in the candidate’s own text', async () => {
        const result = await run();
        const corpus = [...BACKEND_LINES, ...SETTLEMENT_LINES].join('\n').toLowerCase();
        for (const skill of result.resume.skills) {
            expect(corpus).toContain(skill.toLowerCase());
        }
    });

    test('every requirement is either answered or reported', async () => {
        const result = await run();
        const seen = [
            ...result.coverage.answered.map((a) => a.requirement.text),
            ...result.coverage.unanswered.map((r) => r.text),
        ];
        for (const requirement of BACKEND_BRIEF.requirements) {
            expect(seen).toContain(requirement.text);
        }
    });

    test('nothing is dropped silently — every cut line is reported with a reason', async () => {
        const result = await run();
        const kept = allText(result.resume);
        const sourceLines = [...BACKEND_LINES, ...SETTLEMENT_LINES];
        for (const line of sourceLines) {
            const onPage = kept.includes(line);
            const reported = result.dropped.some((d) => d.text === line);
            expect(onPage || reported).toBe(true);
        }
    });

    test('a dropped line carries the row it can be restored into', async () => {
        const result = await run();
        for (const line of result.dropped) {
            expect(['exp-flexport', 'exp-instacart']).toContain(line.targetId);
        }
    });

    test('the same input twice produces the same resume', async () => {
        // A candidate who regenerates and gets a different document stops
        // trusting the tool.
        const first = await run();
        resetMocks();
        const second = await run();
        expect(JSON.stringify(second.resume)).toBe(JSON.stringify(first.resume));
    });
});

// ═══════════════════════════════════════════════════════ another profession

describe('a profession that is not engineering', () => {
    const DESIGN_LINES = [
        'Owned the rebrand rollout across app, web and out-of-home.',
        'Led the summer campaign that ran across 400 sites and lifted app installs 18%.',
        'Rebuilt the design system in Figma, cutting handoff time from 3 days to 4 hours.',
        'Art directed 6 photo shoots and built the illustration library.',
    ];

    const DESIGN_BRIEF = {
        role: 'Senior Brand Designer',
        company: 'Monzo',
        seniority: 'senior',
        domain: 'consumer fintech',
        requirements: [
            { text: 'Expert with Figma', kind: 'must', category: 'skill' },
            { text: 'Experience running design systems', kind: 'must', category: 'experience' },
            { text: 'Expert with Adobe Creative Suite', kind: 'must', category: 'skill' },
        ],
        skills: ['Figma', 'Adobe Creative Suite', 'InDesign'],
        responsibilities: ['Lead brand campaigns'],
    };

    const DESIGN_INPUT = {
        ...BACKEND_INPUT,
        jobDescription: 'Senior Brand Designer at Monzo.',
        profile: { ...BACKEND_INPUT.profile, fullName: 'Maya Osei', title: 'Brand Designer' },
        experiences: [
            experience({
                id: 'exp-deliveroo',
                company: 'Deliveroo',
                role: 'Brand Designer',
                description: DESIGN_LINES.join('\n'),
            }),
        ],
    };

    test('produces a designer’s resume, not an engineer’s', async () => {
        // The old prompt hardcoded "Prioritize engineering signals: distributed
        // systems, infra, automation, AI/LLM pipelines, developer productivity",
        // which steered every non-engineer away from their own profession.
        const result = await run(
            {
                posting: DESIGN_BRIEF,
                select: (prompt: string) => {
                    const ids = [...prompt.matchAll(/^(e\d+:\d+) \|/gm)].map((m) => m[1]);
                    return {
                        bullets: ids.map((id) => ({
                            id,
                            answers: id.endsWith(':2') ? ['r1', 'r2'] : [],
                            strength: 4,
                        })),
                    };
                },
                summary: { summary: 'Brand designer who ships campaigns end to end.' },
            },
            DESIGN_INPUT,
        );

        expect(result.resume.skills).toContain('Figma');
        expect(allText(result.resume)).toContain('design system');
    });

    test('and flags the tool they cannot evidence', async () => {
        const result = await run(
            {
                posting: DESIGN_BRIEF,
                select: (prompt: string) => {
                    const ids = [...prompt.matchAll(/^(e\d+:\d+) \|/gm)].map((m) => m[1]);
                    return { bullets: ids.map((id) => ({ id, answers: [], strength: 4 })) };
                },
                summary: { summary: 'Brand designer.' },
            },
            DESIGN_INPUT,
        );
        expect(result.skillGaps).toContain('Adobe Creative Suite');
        expect(result.resume.skills).not.toContain('Adobe Creative Suite');
    });
});
