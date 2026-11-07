/**
 * Import eval: the owner's own resume, read back faithfully.
 *
 * `src/__fixtures__/resume/resume_ai_voice.txt` is the text the free check
 * extracts from resume_ai_voice.pdf (pdf-parse, exactly as stashed). The
 * ground truth below is the bullet list of resume_ai_voice.tex, with LaTeX
 * markup removed. The model is scripted twice: once copying perfectly, once
 * reproducing every defect seen in the browser on 2026-11-07 (QA finding 1).
 * Both must import to the same thing, and that thing must be the resume.
 *
 * Pass condition: every source bullet exactly once, verbatim; nothing else.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installMocks, mocks, uninstallMocks } from '@/__mocks__';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { parseResumeText } from '@/lib/resumeParser';
import type { ParsedResumeData } from '@/lib/aiSchemas';
import { resumeDataFromParsed } from './fromParsed';
import { IMPORT_PARSE_SYSTEM, type ImportParse } from './importParse';
import { checkNumericGuard } from '@/lib/ai/guard';

const SOURCE = readFileSync(join(import.meta.dir, '../../__fixtures__/resume/resume_ai_voice.txt'), 'utf8');

const TRUTH = {
    Plivo: [
        'Optimized the voice media path (RTP handling, kernel and socket tuning, codec/transcoding hot paths, GC and memory-pressure reduction) and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls, raising concurrent call capacity 2x per machine and cutting fleet infrastructure cost by 50%.',
        'Built an agentic AI support platform using RAG over production logs, internal docs and microservice codebases, with Slack and CLI workflows that automate support triage and cut support workload by ∼50%.',
        'Built a low-latency SMS classification and routing system with sub-ms inference for spam filtering, preference-aware routing and fraud shielding across production messaging workflows.',
        'Developed internal engineering automation integrating Kubernetes, Jenkins, GitHub, Slack and deploy pipelines, cutting staging validation and deployment time and effort by 70%.',
    ],
    Hyperbots: [
        'Built and ran 5 microservices (notifications, RBAC, scheduling, config) handling 100K+ events a day.',
        'Moved read-heavy screens to CQRS, with writes in MongoDB and Postgres and reads served from Elasticsearch views kept in sync by events, raising query throughput by 60%.',
        'Cut API response times by 40% with missing indexes, rewrites of the slowest queries and schema fixes.',
    ],
    '2Sigma School': ['Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70%.'],
    'Swachh.io': ['Built a Flutter affiliate app on Shopify with referrals, rewards, payments.'],
} as const;

const PROJECT_TRUTH = {
    'Voice agent from scratch': [
        'Built every stage of a voice agent in PyTorch with no pretrained models: noise suppression, VAD, streaming Conformer ASR, Tacotron-style TTS, an ISTFT neural vocoder and ECAPA-style speaker ID.',
        'On the same 4.1 h of LibriSpeech, the Conformer halved CER against a BiGRU + CTC baseline (0.66 to 0.28) and ran 2.7x faster, while streaming in 640 ms chunks cost only 3% relative.',
        'Wrote a streaming OM-LSA noise suppressor that removes 8.1 dB of noise in pauses at 16 ms latency and damages speech less than the trained GTCRN model (0.9 vs 2.0 dB).',
        'Served it through a real-time WebSocket server with endpointing, barge-in, an OpenAI or Claude responder and p50/p95 latency per stage, where any stage can be swapped for Silero, faster-whisper or Kokoro.',
    ],
    'Tonecall: agent-to-agent call protocol': [
        'Designed a protocol for two AI voice agents on the same phone call to detect each other with an in-band DTMF nonce handshake and switch to JSON, cutting negotiation on a live test call from about 75s to 13s at half the cost. When the other side is a human, the agent stays in voice.',
        'Built the telephony runtime on Plivo media streams with mu-law/PCM transcoding, a streaming STT, LLM and TTS loop. Instances pair through a broker that signs every message with HMAC-SHA256 and rejects replays.',
    ],
    'Patronus: AI career companion': [
        'Built and launched an LLM career companion that keeps a record of a user’s work, checks jobs against it and tailors resumes and recruiter notes with RAG, rejecting any number not in the source (evals gate on zero fabrications).',
    ],
} as const;

const SKILL_ROWS = [
    { label: 'Languages', items: ['Python', 'Go', 'C/C++', 'Java', 'TypeScript', 'Rust'] },
    { label: 'Speech / AI', items: ['PyTorch', 'ASR (Conformer, CTC)', 'TTS', 'VAD', 'noise suppression', 'speaker ID', 'LLM agents', 'RAG'] },
    { label: 'Voice infra', items: ['FreeSWITCH', 'RTP', 'WebSockets', 'mu-law/PCM', 'real-time streaming', 'latency profiling'] },
    { label: 'Backend / Infra', items: ['FastAPI', 'gRPC', 'Kafka', 'Redis', 'PostgreSQL', 'AWS', 'Kubernetes', 'Docker', 'Prometheus', 'Grafana'] },
];

const ALL_TRUTH = [...Object.values(TRUTH).flat(), ...Object.values(PROJECT_TRUTH).flat()];

const personalInfo = {
    fullName: 'Jai Shankar',
    title: 'AI Engineer, Voice Agents',
    email: 'jaimauryatech@gmail.com',
    phone: '+91 76440 53913',
    location: 'Bengaluru, India',
    linkedin: 'linkedin.com/in/jai-shankar-b7b388234',
    github: 'github.com/jai0651',
    website: 'jaishankar.dev',
    summary: '',
};
const education = [{ institution: 'Indian Institute of Technology Delhi', degree: 'B.Tech', fieldOfStudy: 'Engineering and Computational Mechanics', startDate: '2020', endDate: '2024', current: false }];
const role = (company: string, rest: Partial<ImportParse['experiences'][number]>): ImportParse['experiences'][number] => ({
    company,
    companyNote: '',
    role: 'Software Engineer I',
    stack: '',
    location: 'Bengaluru',
    startDate: '',
    endDate: '',
    current: false,
    bullets: [],
    ...rest,
});

/** A model that copies perfectly. */
const FAITHFUL: ImportParse = {
    personalInfo,
    experiences: [
        role('Plivo', { companyNote: 'established CPaaS, AI voice agents', stack: 'Go, C, Python', startDate: 'Sep 2025', endDate: 'Present', current: true, bullets: [...TRUTH.Plivo] }),
        role('Hyperbots', { companyNote: 'seed-stage fintech AI', stack: 'Java (Spring Boot), Python (FastAPI)', startDate: 'Jun 2024', endDate: 'Aug 2025', bullets: [...TRUTH.Hyperbots] }),
        role('2Sigma School', { role: 'SDE Intern', location: '', startDate: 'Mar 2024', endDate: 'May 2024', bullets: [...TRUTH['2Sigma School']] }),
        role('Swachh.io', { role: 'SDE Intern', location: '', startDate: 'May 2023', endDate: 'Jul 2023', bullets: [...TRUTH['Swachh.io']] }),
    ],
    education,
    projects: Object.entries(PROJECT_TRUTH).map(([name, bullets]) => ({ name, technologies: [], githubUrl: '', liveUrl: '', bullets: [...bullets] })),
    achievements: [],
    skillGroups: SKILL_ROWS.map((row) => ({ ...row, items: [...row.items] })),
};

/** Every defect observed in the browser, reproduced. */
const SLOPPY: ImportParse = {
    personalInfo: {
        ...personalInfo,
        summary: 'AI-focused software engineer with engineering experience spanning voice infrastructure and fintech backends.',
    },
    experiences: [
        role('Plivo', {
            // Tag line and stack dropped; role carries the stack.
            role: 'Software Engineer I | Go, C, Python',
            startDate: 'Sep 2025',
            endDate: 'Present',
            current: true,
            bullets: [
                'Engineers voice infrastructure, agentic AI support systems, messaging classification, and internal engineering automation.',
                // Cut after the first outcome.
                'Optimized the voice media path (RTP handling, kernel and socket tuning, codec/transcoding hot paths, GC and memory-pressure reduction) and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls.',
                TRUTH.Plivo[1],
                // A typo "fixed", which is still the source.
                'Built a low latency SMS classification and routing system with sub-ms inference for spam filtering, preference-aware routing and fraud shielding across production messaging workflows.',
            ],
        }),
        role('Hyperbots', {
            startDate: 'Jun 2024',
            endDate: 'Aug 2025',
            bullets: [
                'Built fintech AI backend services and event-driven data systems using Java, Spring Boot, and Python.',
                TRUTH.Hyperbots[0],
                // A number changed: must never survive as text.
                'Moved read-heavy screens to CQRS, raising query throughput by 65%.',
            ],
        }),
        role('2Sigma School', {
            role: 'SDE Intern',
            location: '',
            // What the live model did on 2026-11-07: the whole printed line,
            // company and title first.
            bullets: ['Built a safe, fast remote and in-browser code execution engine.', `2Sigma School, SDE Intern. ${TRUTH['2Sigma School'][0]}`],
        }),
        role('Swachh.io', {
            role: 'SDE Intern',
            location: '',
            bullets: ['Built a Flutter affiliate app on Shopify', 'Swachh.io, SDE Intern. Built a Flutter affiliate app on Shopify with referrals, rewards, payments. May – Jul 2023'],
        }),
    ],
    education,
    projects: [
        {
            name: 'Voice agent from scratch',
            technologies: ['Python', 'PyTorch'],
            githubUrl: 'https://github.com/jai0651/VAD-ASR',
            liveUrl: '',
            // Merged into a paragraph; the model-results and OM-LSA bullets dropped.
            bullets: [`${PROJECT_TRUTH['Voice agent from scratch'][0]} ${PROJECT_TRUTH['Voice agent from scratch'][3]}`],
        },
        { name: 'Tonecall', technologies: ['TypeScript', 'Next.js', 'WebSockets'], githubUrl: '', liveUrl: '', bullets: [PROJECT_TRUTH['Tonecall: agent-to-agent call protocol'][0]] },
        { name: 'Patronus: AI career companion', technologies: ['Next.js'], githubUrl: '', liveUrl: 'https://patronus.cv', bullets: ['An LLM career companion with RAG.'] },
    ],
    achievements: [],
    skillGroups: [
        { label: 'Languages', items: ['Python', 'Go', 'Java', 'TypeScript', 'Rust'] },
        { label: 'Observability', items: ['Observability'] },
        { label: 'AI & Machine Learning', items: ['PyTorch', 'RAG'] },
    ],
};

const USER = 'eval-import-user';

function scriptModel(output: ImportParse) {
    mocks().openai.reset();
    mocks().openai.onObject(IMPORT_PARSE_SYSTEM.slice(0, 60), { object: structuredClone(output) });
}

function bulletsOf(parsed: ParsedResumeData) {
    return [
        ...parsed.experiences.flatMap((item) => item.highlights),
        ...parsed.projects.flatMap((item) => item.description.split('\n').filter(Boolean)),
    ];
}

beforeAll(() => {
    installMocks({ only: ['openai'] });
    // Pure eval: no budget row and no usage log in the database.
    structuredTesting.setBudgetGuard(async () => undefined);
    structuredTesting.setUsageLogger(async () => undefined);
});

afterAll(() => {
    uninstallMocks();
    structuredTesting.reset();
});

describe.each([
    ['a model that copies perfectly', FAITHFUL],
    ['a model reproducing every defect from QA 2026-11-07', SLOPPY],
] as const)('import of resume_ai_voice with %s', (_label, output) => {
    let parsed: ParsedResumeData;

    beforeAll(async () => {
        scriptModel(output);
        parsed = await parseResumeText(SOURCE, USER);
    });

    test('one guarded model call, on the resumeParse task', () => {
        const calls = mocks().openai.objectCalls;
        // The sloppy script trips the numeric guard ("65%"), which buys one
        // corrective call; the faithful one needs none.
        expect(calls.length).toBe(output === SLOPPY ? 2 : 1);
        expect(calls[0].system).toBe(IMPORT_PARSE_SYSTEM);
    });

    test('every source bullet appears exactly once, verbatim', () => {
        const got = bulletsOf(parsed);
        for (const bullet of ALL_TRUTH) {
            expect(got.filter((line) => line === bullet)).toHaveLength(1);
        }
    });

    test('no bullet that is not in the source', () => {
        const truth = new Set<string>(ALL_TRUTH);
        expect(bulletsOf(parsed).filter((line) => !truth.has(line))).toEqual([]);
        expect(bulletsOf(parsed)).toHaveLength(ALL_TRUTH.length);
    });

    test('each role holds its own bullets, in order', () => {
        for (const [company, bullets] of Object.entries(TRUTH)) {
            const experience = parsed.experiences.find((item) => item.company === company);
            expect(experience?.highlights).toEqual([...bullets]);
            // The role summary field is never written: that is where the
            // invented first bullets came from.
            expect(experience?.description).toBe('');
        }
    });

    test('project bullets stay bullets, none dropped', () => {
        for (const [name, bullets] of Object.entries(PROJECT_TRUTH)) {
            // The title as printed, even when the model shortened it.
            const project = parsed.projects.find((item) => item.name === name);
            expect(project?.description.split('\n')).toEqual([...bullets]);
        }
    });

    test('company tag lines and role stacks are kept, as written, never as bullets', () => {
        const plivo = parsed.experiences.find((item) => item.company === 'Plivo')!;
        const hyperbots = parsed.experiences.find((item) => item.company === 'Hyperbots')!;
        expect(plivo.companyNote).toBe('established CPaaS, AI voice agents');
        expect(plivo.stack).toBe('Go, C, Python');
        expect(plivo.role).toBe('Software Engineer I');
        expect(hyperbots.companyNote).toBe('seed-stage fintech AI');
        expect(hyperbots.stack).toBe('Java (Spring Boot), Python (FastAPI)');
    });

    test('skills keep the resume\'s own rows and labels', () => {
        expect(parsed.skillGroups).toEqual(SKILL_ROWS);
        expect(parsed.skills).toEqual(SKILL_ROWS.flatMap((row) => row.items));
    });

    test('no summary is invented for a resume that has none', () => {
        expect(parsed.personalInfo.summary).toBe('');
        expect(parsed.personalInfo.title).toBe('AI Engineer, Voice Agents');
    });

    test('project technologies are the ones printed with the project', () => {
        expect(parsed.projects.find((item) => item.name === 'Voice agent from scratch')?.technologies).toEqual(['Python', 'PyTorch', 'WebSockets']);
        expect(parsed.projects.find((item) => item.name === 'Tonecall: agent-to-agent call protocol')?.technologies).toEqual(['TypeScript', 'Next.js', 'WebSockets']);
    });

    test('zero fabricated quantities: every figure stored is in the source', () => {
        const check = checkNumericGuard(
            { bullets: bulletsOf(parsed), summary: parsed.personalInfo.summary },
            { sourceText: SOURCE, fields: ['bullets', 'summary'] },
        );
        expect(check.violations).toEqual([]);
    });

    test('the editor document prints each bullet once and the rows as labelled', () => {
        const data = resumeDataFromParsed(parsed);
        const plivo = data.experience.find((item) => item.company === 'Plivo')!;
        expect(plivo.description.split('\n')).toEqual(TRUTH.Plivo.map((line) => `• ${line}`));
        expect(plivo.companyNote).toBe('established CPaaS, AI voice agents');
        const twoSigma = data.experience.find((item) => item.company === '2Sigma School')!;
        expect(twoSigma.description).toBe(`• ${TRUTH['2Sigma School'][0]}`);
        const voice = data.projects.find((item) => item.name === 'Voice agent from scratch')!;
        expect(voice.description.split('\n')).toHaveLength(4);
        expect(data.skillGroups?.map((group) => group.label)).toEqual(['Languages', 'Speech / AI', 'Voice infra', 'Backend / Infra']);
    });
});
