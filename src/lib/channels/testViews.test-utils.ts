import type { StoredSection } from '@/lib/agent/run';
import type { ScoutRunView, ScoutSections } from '@/lib/scout/types';

export const RUN_ID = 'cmue6z09b000965hljys7gv7l';
export const APP = 'https://aicv.theweekendworld.com';
const at = '2026-09-23T10:00:00.000Z';

export function ok<T>(data: T): StoredSection<T> {
    return { status: 'ok', data, sources: [], finishedAt: at };
}

export function view(overrides: Partial<ScoutRunView> & { sections?: ScoutSections } = {}): ScoutRunView {
    return {
        id: RUN_ID,
        status: 'succeeded',
        kind: 'job_posting',
        input: { url: 'https://www.linkedin.com/jobs/view/4455902670', source: 'telegram' },
        channel: 'telegram',
        sections: {},
        plan: ['ingest', 'classify', 'jd', 'fit', 'company', 'comp', 'interviews', 'network', 'talent'],
        pendingQuestion: null,
        drafts: [],
        headline: 'Software Dev Engineer II at Amazon · Possible fit (64)',
        createdAt: at,
        finishedAt: at,
        error: null,
        ...overrides,
    };
}

export const JOB_SECTIONS: ScoutSections = {
    jd: ok({
        role: 'Software Dev Engineer II', company: 'Amazon', seniority: 'mid', domain: 'voice',
        location: 'Chennai, Tamil Nadu, India', workMode: 'onsite', employmentType: 'Full-time',
        compensationText: null, experienceText: '3+ years', requirements: [], skills: [], responsibilities: [], applyUrl: null,
    }),
    fit: ok({
        score: 64, verdict: 'stretch', matched: [],
        gaps: [{ requirementId: 'r1', text: 'Distributed systems at scale', severity: 'blocking' }],
        preferenceChecks: [{ key: 'work_mode', status: 'conflict', detail: 'Onsite in Chennai; you prefer remote' }],
        notFitReasons: ['Onsite in Chennai; you prefer remote'], summary: 'x', softRequirements: [],
    }),
    comp: ok({
        figures: [{ label: 'SDE II total comp, India', value: '₹45–60 LPA', sourceUrl: 'https://www.levels.fyi/companies/amazon', sourceTitle: 'Levels', asOf: null }],
        observedBand: null, caveat: 'self-reported',
    }),
    company: ok({
        name: 'Amazon', website: 'amazon.com', employeeCount: 1500000, employeeCountRange: null, fundingText: null,
        latestFundingStage: 'Public', revenueText: null, industry: null, headquarters: null, foundedYear: null,
        provenance: {}, hiringStatement: null, facts: [], growthNote: null,
    }),
    interviews: ok({
        links: [
            { url: 'https://reddit.com/r/x', title: 'a', source: 'reddit', publishedAt: null, snippet: '', relevance: '' },
            { url: 'https://leetcode.com/x', title: 'b', source: 'leetcode', publishedAt: null, snippet: '', relevance: '' },
        ],
        themes: [],
    }),
};

/**
 * Inbox half of the channel deps, inert by default. Spread into a test's
 * `fakeDeps` so adding an inbox function never breaks every channel test.
 */
export function inertInboxDeps() {
    return {
        setJobStatus: async () => ({ success: false as const, error: 'n/a' }),
        confirmWinForUser: async () => ({ success: false as const, error: 'n/a' }),
        dismissWinForUser: async () => ({ success: false as const, error: 'n/a' }),
        topFits: async () => [],
        listJobBoard: async () => [],
        listInsights: async () => [],
        listChatNotes: async () => [],
        tailorResumeForRun: async () => ({ success: false as const, error: 'n/a' }),
        nextGenerationQuestion: async () => null,
    };
}
