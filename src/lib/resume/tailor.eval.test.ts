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
import type { EducationItem, ExperienceItem, ProjectItem, ResumeData } from '@/types/resume';
import { tailorResume, type TailorResult } from './tailor';
import { addressesEmployer } from './write';

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
    education: [] as EducationItem[],
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
        { text: 'Experience with Kubernetes', kind: 'must', category: 'skill', satisfiedByTenure: false },
        {
            text: 'Mentor engineers and raise the technical bar',
            kind: 'must',
            category: 'behaviour',
            satisfiedByTenure: false,
        },
        {
            text: '6+ years building backend systems',
            kind: 'must',
            category: 'experience',
            // Time served is the whole of what this asks for. Contrast the
            // budget requirement in the fabrication test below.
            satisfiedByTenure: true,
        },
        { text: 'Experience with Terraform', kind: 'nice', category: 'skill', satisfiedByTenure: false },
    ],
    skills: ['Kubernetes', 'Kafka', 'Terraform', 'Go'],
    // Objects, not strings: a duty is a scoreable requirement now. It was
    // parsed into a field nothing read for the whole life of v2.
    responsibilities: [{ text: 'Own critical payment services', category: 'outcome' }],
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
    /** A function, so a test can answer differently on the retry. */
    summary?: ((prompt: string) => unknown) | unknown;
};

function script(overrides: Script = {}) {
    const openai = mocks().openai;
    openai.onObject(IS_POSTING, () => overrides.posting ?? BACKEND_BRIEF);
    openai.onObject(IS_SELECT, (args: CallArgs) => (overrides.select ?? scoreBackend)(args.prompt));
    openai.onObject(IS_WRITE, (args: CallArgs) => (overrides.write ?? echoWrite)(args.prompt));
    openai.onObject(IS_SUMMARY, (args: CallArgs) => {
        if (typeof overrides.summary === 'function') {
            return (overrides.summary as (prompt: string) => unknown)(args.prompt);
        }
        return (
            overrides.summary ?? { summary: 'Backend engineer who owns payment services end to end.' }
        );
    });
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

/**
 * The model is mocked; the USAGE LOG is not.
 *
 * `generateStructured` writes an `ApiUsageLog` row per call whatever answers
 * it, so this file — nineteen end-to-end runs, several model calls each —
 * had quietly written 6,390 rows under `eval-user`. That was 96% of the whole
 * table, so the admin dashboard's tokens, spend and top-users panels were
 * almost entirely this test, and the four real accounts were invisible in it.
 *
 * A test that leaves rows in a table someone reads as a metric is not
 * self-contained. It cleans up after itself now.
 */
const EVAL_USER = 'eval-user';

beforeAll(() => installMocks({ only: ['openai'] }));
afterEach(() => resetMocks());
afterAll(async () => {
    uninstallMocks();
    const { prisma } = await import('@/lib/prisma');
    await prisma.apiUsageLog.deleteMany({ where: { userId: EVAL_USER } });
    await prisma.funnelEvent.deleteMany({ where: { userId: EVAL_USER } });
});

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
            // A stated duty is a requirement too, and an id the model invented
            // answers it no better than it answers the rest.
            'Own critical payment services',
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
            // Responsibilities empty too: they are requirements now, and a
            // posting we could not read has none of either.
            posting: { ...BACKEND_BRIEF, requirements: [], skills: [], responsibilities: [] },
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
            { text: 'Expert with Figma', kind: 'must', category: 'skill', satisfiedByTenure: false },
            {
                text: 'Experience running design systems',
                kind: 'must',
                category: 'experience',
                satisfiedByTenure: false,
            },
            {
                text: 'Expert with Adobe Creative Suite',
                kind: 'must',
                category: 'skill',
                satisfiedByTenure: false,
            },
        ],
        skills: ['Figma', 'Adobe Creative Suite', 'InDesign'],
        responsibilities: [{ text: 'Lead brand campaigns', category: 'behaviour' }],
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

/*
 * ── The 8 Aug audit ─────────────────────────────────────────────────────────
 *
 * Three live runs for a product designer, a growth marketer and a career
 * switcher — the first non-engineering personas the pipeline had ever seen.
 * Everything below reproduces a failure those runs actually produced.
 */

const DESIGNER_LINES = [
    'Built and maintained the design system in Figma — 90 components adopted by four squads.',
    'Cut checkout abandonment from 31% to 19% by rebuilding the payment step.',
    'Ran usability testing with 24 participants across three markets.',
    'Owned the merchant dashboard redesign end to end.',
    'Facilitated quarterly design critiques and mentored one junior designer through her first solo feature.',
];

const DESIGNER_BRIEF = {
    role: 'Senior Product Designer',
    company: 'Northbeam',
    seniority: 'senior',
    domain: 'fintech',
    requirements: [
        { text: 'Expert with Figma', kind: 'must', category: 'skill', satisfiedByTenure: false },
        {
            text: '5+ years designing digital products',
            kind: 'must',
            category: 'experience',
            satisfiedByTenure: true,
        },
    ],
    skills: ['Figma', 'Design systems'],
    responsibilities: [
        {
            text: 'Raise the bar on craft across the design team, and mentor designers earlier in their career',
            category: 'behaviour',
        },
        { text: 'Contribute to and evolve our design system', category: 'outcome' },
    ],
};

const DESIGNER_INPUT = {
    ...BACKEND_INPUT,
    jobDescription: 'Senior Product Designer at Northbeam.',
    profile: { ...BACKEND_INPUT.profile, title: 'Product Designer' },
    experiences: [
        experience({ id: 'exp-d', company: 'Monzo', role: 'Product Designer', description: DESIGNER_LINES.join('\n') }),
    ],
    projects: [],
    candidateSkills: ['Figma', 'Design systems', 'Usability testing'],
};

/** Mentoring answers only the RESPONSIBILITY, and is the weakest line. */
function scoreDesigner(prompt: string) {
    const ids = [...prompt.matchAll(/^([ep]\d+:\d+|cred:\w+) \|/gm)].map((m) => m[1]);
    return {
        bullets: ids.map((id) => {
            const raw = Number.parseInt(id.split(':')[1] ?? '', 10);
            // `cred:skills` has no numeric suffix; it is evidence, not a line.
            const index = Number.isFinite(raw) ? raw : 0;
            const isMentoring = id.endsWith(':4');
            return {
                id,
                answers: isMentoring ? ['d1'] : index === 0 ? ['r1', 'd2'] : [],
                strength: isMentoring ? 3 : 5 - index,
            };
        }),
    };
}

describe('the posting’s “What you’ll do” section is read', () => {
    test('a line that answers only a stated DUTY survives the cap', async () => {
        // The audit's exact failure. `readPosting` extracted seven duties for
        // this posting and nothing consumed them, so the cover pass had never
        // heard of "mentor designers earlier in their career" — and dropped
        // the one line that answers it, for `cap`, as the weakest of five.
        const result = await run(
            { posting: DESIGNER_BRIEF, select: scoreDesigner },
            DESIGNER_INPUT,
        );
        const text = result.resume.experience.map((role) => role.description).join('\n');
        expect(text).toContain('mentored one junior designer');
    });

    test('a duty appears in coverage rather than being invisible', async () => {
        const result = await run(
            { posting: DESIGNER_BRIEF, select: scoreDesigner },
            DESIGNER_INPUT,
        );
        const kinds = [
            ...result.coverage.answered.map((a) => a.requirement.kind),
            ...result.coverage.unanswered.map((r) => r.kind),
        ];
        expect(kinds).toContain('responsibility');
    });
});

describe('evidence we cut is never reported as evidence we lack', () => {
    test('a requirement answered only by a dropped line is reported as restorable', async () => {
        // A marketer's history says "Manage a team of three and a £1.2M annual
        // budget". The cap dropped it, and the gap report then told her
        // nothing on her resume answered "Experience managing and developing
        // marketers". That manufactures a false negative about her own career
        // and presents it as analysis.
        const result = await run({
            posting: {
                ...BACKEND_BRIEF,
                requirements: [
                    {
                        text: 'Experience managing and developing marketers',
                        kind: 'must',
                        category: 'behaviour',
                        satisfiedByTenure: false,
                    },
                ],
                skills: [],
                responsibilities: [],
            },
            // Only the fifth Flexport line answers it, and it is the weakest,
            // so the four-per-role cap removes it.
            // Below MIN_STRENGTH, so it is never eligible and the cover pass
            // cannot rescue it. A real line, genuinely off the page — which is
            // the only honest way to reach this branch now that a strong line
            // answering a must is protected.
            select: (prompt: string) => {
                const ids = [...prompt.matchAll(/^(\S+) \|/gm)].map((m) => m[1]);
                return {
                    bullets: ids.map((id) => ({
                        id,
                        answers: id === 'e0:4' ? ['r1'] : [],
                        strength: id === 'e0:4' ? 1 : 5,
                    })),
                };
            },
        });

        expect(result.coverage.unanswered).toEqual([]);
        expect(result.coverage.answeredByCut.map((a) => a.requirement.text)).toEqual([
            'Experience managing and developing marketers',
        ]);
        expect(result.advice.some((line) => line.includes('did not fit'))).toBe(true);
        expect(result.advice.some((line) => line.startsWith('Nothing on your resume answers'))).toBe(
            false,
        );
    });
});

const TEXAS_STATE: EducationItem[] = [
    {
        id: 'edu-1',
        institution: 'Texas State University',
        degree: 'BS',
        fieldOfStudy: 'Business Administration',
        startDate: '2014-09',
        endDate: '2018-05',
        current: false,
    },
];

describe('the education and skills sections count as evidence', () => {
    test('a degree requirement is answered by the degree', async () => {
        // A career switcher holding a BS from Texas State was told "Nothing on
        // your resume answers: 'Bachelor's degree in any field'" — coverage
        // read bullets and nothing else.
        const result = await run(
            {
                posting: {
                    ...BACKEND_BRIEF,
                    requirements: [
                        {
                            text: "Bachelor's degree in any field",
                            kind: 'must',
                            category: 'domain',
                            satisfiedByTenure: false,
                        },
                    ],
                    skills: [],
                    responsibilities: [],
                },
                select: (prompt: string) => {
                    const ids = [...prompt.matchAll(/^(\S+) \|/gm)].map((m) => m[1]);
                    return {
                        bullets: ids.map((id) => ({
                            id,
                            // Only the education line answers it.
                            answers: id.startsWith('cred:edu') ? ['r1'] : [],
                            strength: 4,
                        })),
                    };
                },
            },
            {
                ...BACKEND_INPUT,
                education: TEXAS_STATE,
            },
        );

        expect(result.coverage.unanswered).toEqual([]);
        expect(result.coverage.answered[0].via).toBe('credential');
    });

    test('education never becomes a bullet on the page', async () => {
        // It is evidence, not a line of experience. Scoring it must not let it
        // leak into a role's description.
        const result = await run(
            { posting: { ...BACKEND_BRIEF, responsibilities: [] } },
            {
                ...BACKEND_INPUT,
                education: TEXAS_STATE,
            },
        );
        const text = result.resume.experience.map((role) => role.description).join('\n');
        expect(text).not.toContain('Texas State');
    });
});

describe('the summary is not addressed to the employer', () => {
    test('a mail-merge summary is rewritten, not shipped', async () => {
        // All three live audit runs produced this construction in sentence
        // two, unprompted. It is the first line a recruiter reads and the tell
        // that gets a document binned as AI-written.
        let calls = 0;
        const result = await run({
            posting: { ...BACKEND_BRIEF, responsibilities: [] },
            summary: () => {
                calls += 1;
                return calls === 1
                    ? { summary: "Fit for Stripe's Senior Backend Engineer role through owning payments." }
                    : { summary: 'Backend engineer who owns payment services end to end.' };
            },
        });

        expect(calls).toBe(2);
        expect(result.resume.personalInfo.summary).toBe(
            'Backend engineer who owns payment services end to end.',
        );
    });

    test('a summary that never mentions the employer is left alone', async () => {
        // The retry costs a model call; it must not fire on a good summary.
        let calls = 0;
        await run({
            posting: { ...BACKEND_BRIEF, responsibilities: [] },
            summary: () => {
                calls += 1;
                return { summary: 'Backend engineer who owns payment services end to end.' };
            },
        });
        expect(calls).toBe(1);
    });

    test('the check itself', () => {
        expect(
            addressesEmployer("Fit for Stripe's Senior Backend Engineer role through…", {
                role: 'Senior Backend Engineer',
                company: 'Stripe',
            }),
        ).toBe(true);
        expect(
            addressesEmployer('Backend engineer who owns payment services end to end.', {
                role: 'Senior Backend Engineer',
                company: 'Stripe',
            }),
        ).toBe(false);
    });

    test('a one-word role title does not trip the check', () => {
        // "Designs payment flows" must be allowed to mention design work.
        expect(addressesEmployer('Designer who ships payment flows.', { role: 'Designer', company: '' })).toBe(
            false,
        );
    });
});
