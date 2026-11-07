import { describe, expect, test } from 'bun:test';
import type { ResumeDraft } from '@/lib/ai/resumeLoop';
import { chooseSummary, factSummary, isFillerSummary, keepsOutcome, resumeFromDraft, sourceWasSeen, type DraftRecord } from './fromDraft';

const EVIDENCE = [
    'Cut checkout p95 latency from 800ms to 180ms by batching the pricing lookup.',
    'Led the migration of 12 services onto Kubernetes.',
    'Project: ledger-service. A double-entry ledger in Go.',
].join('\n');

function draft(patch: Partial<ResumeDraft> = {}): ResumeDraft {
    return {
        headline: 'Backend Engineer',
        summary: 'Backend engineer focused on payments reliability.',
        experience: [{
            roleId: 'r1', company: 'Northwind', role: 'Backend Engineer', startDate: '2021', endDate: 'Present', location: 'Remote',
            bullets: [
                { text: 'Cut checkout p95 latency from 800ms to 180ms by batching pricing lookups', sourceLine: 'Cut checkout p95 latency from 800ms to 180ms by batching the pricing lookup.', answers: [] },
                { text: 'Migrated 12 services onto Kubernetes', sourceLine: 'Led the migration of 12 services onto Kubernetes.', answers: [] },
            ],
        }],
        projects: [{ name: 'ledger-service', description: 'A double-entry ledger in Go.', technologies: ['go'], url: '' }],
        education: [],
        skills: [{ group: 'Languages', items: ['Go'] }],
        rationale: 'test',
        ...patch,
    };
}

const check = (d: ResumeDraft) => resumeFromDraft({ draft: d, contact: null, availableRoles: 1, evidenceSeen: EVIDENCE });

describe('resumeFromDraft (no fabricated quantities)', () => {
    test('a clean draft passes with no violations', () => {
        const result = check(draft());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.violations).toEqual([]);
        expect(result.resume.experience[0].description.split('\n')).toHaveLength(2);
    });

    test('a bullet citing a source line the model never saw is dropped', () => {
        const d = draft();
        d.experience[0].bullets.push({ text: 'Grew revenue 40%', sourceLine: 'Grew revenue 40% in one quarter.', answers: [] });
        const result = check(d);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resume.experience[0].description).not.toContain('40%');
        expect(result.violations.join(' ')).toContain('source line the record does not contain');
    });

    test('a figure absent from its own source line is dropped', () => {
        const d = draft();
        d.experience[0].bullets[1] = { text: 'Migrated 30 services onto Kubernetes', sourceLine: 'Led the migration of 12 services onto Kubernetes.', answers: [] };
        const result = check(d);
        expect(result.ok && result.resume.experience[0].description).not.toContain('30 services');
    });

    test('an invented figure in the summary or a project is stripped, not shipped', () => {
        const result = check(draft({
            summary: 'Backend engineer who saved $2M a year.',
            projects: [{ name: 'ledger-service', description: 'Handles 50k transactions per second.', technologies: [], url: '' }],
        }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Replaced by a line built from the record, never left as the invention.
        expect(result.resume.personalInfo.summary).not.toContain('$2M');
        expect(result.resume.personalInfo.summary).toBe('Backend Engineer at Northwind.');
        expect(result.resume.projects[0].description).toBe('');
        expect(result.violations.length).toBe(2);
    });

    test('when every line is bad, the draft is empty and refused', () => {
        const d = draft();
        d.experience[0].bullets = [{ text: 'Invented 99% uptime', sourceLine: 'Invented 99% uptime', answers: [] }];
        const result = check(d);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.kind).toBe('empty');
    });
});

describe('sourceWasSeen', () => {
    test('matches a verbatim line regardless of case and punctuation', () => {
        expect(sourceWasSeen('led the migration of 12 services onto kubernetes', EVIDENCE)).toBe(true);
        expect(sourceWasSeen('Led the migration of 13 services', EVIDENCE)).toBe(false);
        expect(sourceWasSeen('', EVIDENCE)).toBe(false);
    });
});

// ── QA 2026-11-07, finding 2: the record's words, whole ─────────────────────

const MEDIA = 'Optimized the voice media path (RTP handling, kernel and socket tuning, codec/transcoding hot paths, GC and memory-pressure reduction) and shipped neural noise cancellation as a FreeSWITCH module in C, used on 7.5M calls, raising concurrent call capacity 2x per machine and cutting fleet infrastructure cost by 50%.';
const SUPPORT = 'Built an agentic AI support platform using RAG over production logs, internal docs and microservice codebases, with Slack and CLI workflows that automate support triage and cut support workload by ∼50%.';
const CRUD = 'Built and ran 5 microservices (notifications, RBAC, scheduling, config) handling 100K+ events a day.';
const CQRS = 'Moved read-heavy screens to CQRS, with writes in MongoDB and Postgres and reads served from Elasticsearch views kept in sync by events, raising query throughput by 60%.';
const API = 'Cut API response times by 40% with missing indexes, rewrites of the slowest queries and schema fixes.';
const VOICE = [
    'Built every stage of a voice agent in PyTorch with no pretrained models: noise suppression, VAD, streaming Conformer ASR, Tacotron-style TTS, an ISTFT neural vocoder and ECAPA-style speaker ID.',
    'Wrote a streaming OM-LSA noise suppressor that removes 8.1 dB of noise in pauses at 16 ms latency and damages speech less than the trained GTCRN model (0.9 vs 2.0 dB).',
];
const OWNER_EVIDENCE = [MEDIA, SUPPORT, CRUD, CQRS, API, ...VOICE, 'Indian Institute of Technology Delhi B.Tech Plivo Hyperbots FreeSWITCH'].join('\n');

const RECORD: DraftRecord = {
    roles: new Map([
        ['plivo', { lines: [MEDIA, SUPPORT], restorable: [MEDIA, SUPPORT] }],
        ['hyperbots', { lines: [CRUD, CQRS, API], restorable: [CRUD, CQRS, API] }],
    ]),
    projects: [{ name: 'Voice agent from scratch', description: VOICE.join('\n'), source: 'pdf_resume' }],
};

function ownerDraft(patch: Partial<ResumeDraft> = {}): ResumeDraft {
    return {
        headline: 'AI Engineer, Voice Agents',
        summary: 'AI-focused software engineer with engineering experience spanning voice infrastructure and backend systems.',
        experience: [
            {
                roleId: 'plivo', company: 'Plivo', role: 'Software Engineer I', startDate: 'Sep 2025', endDate: 'Present', location: 'Bengaluru',
                // The model cut the outcome clause: in its text AND in its sourceLine.
                bullets: [{ text: 'Optimized the voice media path and shipped neural noise cancellation, used on 7.5M calls.', sourceLine: MEDIA.slice(0, MEDIA.indexOf(', raising')), answers: ['r1'] }],
            },
            {
                roleId: 'hyperbots', company: 'Hyperbots', role: 'Software Engineer I', startDate: 'Jun 2024', endDate: 'Aug 2025', location: 'Bengaluru',
                // The 40% line left out.
                bullets: [{ text: CQRS, sourceLine: CQRS, answers: [] }, { text: CRUD, sourceLine: CRUD, answers: [] }],
            },
        ],
        projects: [{ name: 'Voice agent from scratch', description: 'A voice agent built from scratch in PyTorch, every stage.', technologies: ['PyTorch'], url: '' }],
        education: [{ institution: 'Indian Institute of Technology Delhi', degree: 'B.Tech', fieldOfStudy: '', startDate: '2020', endDate: '2024' }],
        skills: [{ group: 'Speech', items: ['PyTorch'] }],
        rationale: 'test',
        ...patch,
    };
}

const tailor = (d: ResumeDraft, extra: Partial<Parameters<typeof resumeFromDraft>[0]> = {}) =>
    resumeFromDraft({ draft: d, contact: null, availableRoles: 2, evidenceSeen: OWNER_EVIDENCE, record: RECORD, maxBulletsPerRole: 4, ...extra });

describe('tailoring keeps the outcome clause', () => {
    test('a bullet the model cut is printed as the whole record line', () => {
        const result = tailor(ownerDraft());
        if (!result.ok) throw new Error('expected ok');
        const plivo = result.resume.experience.find((item) => item.company === 'Plivo')!;
        expect(plivo.description.split('\n')[0]).toBe(MEDIA);
        expect(plivo.description).toContain('raising concurrent call capacity 2x per machine and cutting fleet infrastructure cost by 50%');
    });

    test('even with rewrites allowed, a rewrite that drops a figure is refused', () => {
        const result = tailor(ownerDraft(), { allowRewrite: true });
        if (!result.ok) throw new Error('expected ok');
        expect(result.resume.experience[0].description.split('\n')[0]).toBe(MEDIA);
        expect(keepsOutcome('Shipped noise cancellation used on 7.5M calls.', MEDIA)).toBe(false);
        expect(keepsOutcome('Shipped noise cancellation on 7.5M calls, doubling capacity (2x) and halving cost (50%).', MEDIA)).toBe(true);
    });

    test('a quantified line the model left out of a kept role comes back, last', () => {
        const result = tailor(ownerDraft());
        if (!result.ok) throw new Error('expected ok');
        const hyperbots = result.resume.experience.find((item) => item.company === 'Hyperbots')!;
        expect(hyperbots.description.split('\n')).toEqual([CQRS, CRUD, API]);
    });

    test('putting lines back respects the per-role cap', () => {
        const result = tailor(ownerDraft(), { maxBulletsPerRole: 2 });
        if (!result.ok) throw new Error('expected ok');
        expect(result.resume.experience.find((item) => item.company === 'Hyperbots')!.description.split('\n')).toEqual([CQRS, CRUD]);
    });

    test('a resume project prints its own bullet lines, not the model\'s paraphrase', () => {
        const result = tailor(ownerDraft());
        if (!result.ok) throw new Error('expected ok');
        expect(result.resume.projects[0].description.split('\n')).toEqual(VOICE);
    });

    test('a generic About is replaced by one built from the record', () => {
        const result = tailor(ownerDraft());
        if (!result.ok) throw new Error('expected ok');
        const about = result.resume.personalInfo.summary;
        expect(isFillerSummary(about)).toBe(false);
        expect(about).not.toMatch(/spanning|focused|leverag|passionate|results-driven/i);
        expect(about).toBe('Software Engineer I at Plivo, previously at Hyperbots. B.Tech, Indian Institute of Technology Delhi.');
    });

    test('tag line, stack and skills rows travel from the base resume', () => {
        const result = tailor(ownerDraft(), {
            base: {
                experience: [{ id: 'x', company: 'Plivo', role: 'Software Engineer I', startDate: '', endDate: '', current: true, location: '', description: '', companyNote: 'established CPaaS, AI voice agents', stack: 'Go, C, Python' }],
                skillGroups: [{ label: 'Speech / AI', items: ['PyTorch', 'TTS'] }],
            },
        });
        if (!result.ok) throw new Error('expected ok');
        expect(result.resume.experience[0].companyNote).toBe('established CPaaS, AI voice agents');
        expect(result.resume.experience[0].stack).toBe('Go, C, Python');
        expect(result.resume.skillGroups).toEqual([{ label: 'Speech / AI', items: ['PyTorch', 'TTS'] }]);
        expect(result.resume.personalInfo.summary).toContain('Software Engineer I at Plivo (Go, C, Python)');
    });

    test('a bullet citing another role\'s line is dropped', () => {
        const d = ownerDraft();
        d.experience[0].bullets.push({ text: API, sourceLine: API, answers: [] });
        const result = tailor(d);
        if (!result.ok) throw new Error('expected ok');
        expect(result.resume.experience[0].description).not.toContain('40%');
    });
});

describe('the About line', () => {
    const facts = { evidenceSeen: OWNER_EVIDENCE, experience: [], education: [] };

    test('a short, sourced, specific summary is kept as written', () => {
        const kept = chooseSummary({ ...facts, draftSummary: 'Voice infrastructure engineer: FreeSWITCH noise cancellation at Plivo.' });
        expect(kept).toEqual({ summary: 'Voice infrastructure engineer: FreeSWITCH noise cancellation at Plivo.', replaced: false });
    });

    test('a named term the record does not hold disqualifies it', () => {
        expect(chooseSummary({ ...facts, draftSummary: 'Voice engineer who built LiveKit agents at Plivo.' }).replaced).toBe(true);
    });

    test('filler words disqualify it', () => {
        for (const filler of ['Passionate engineer.', 'Results-driven engineer at Plivo.', 'Engineer leveraging FreeSWITCH.', 'AI-focused engineer.']) {
            expect(isFillerSummary(filler)).toBe(true);
        }
    });

    test('the fact line names roles and school, nothing else', () => {
        expect(factSummary([], [])).toBe('');
    });
});
