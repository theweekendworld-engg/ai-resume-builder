import { afterEach, describe, expect, test } from 'bun:test';
import { defaultUserGenerationPreferences } from '@/lib/userPreferences';
import type { JdData } from '@/lib/scout/types';
import { buildFitRecord } from '@/lib/scout/fit/evaluate';
import { fakeContext, okSection } from '@/lib/scout/fit/testContext.test-utils';
import { __testing, fitSection } from './fit';

const JD: JdData = {
    role: 'Backend Engineer', company: 'Acme', seniority: 'mid', domain: 'payments',
    location: 'Pune, Maharashtra, India', workMode: 'onsite', employmentType: 'Full-time',
    compensationText: null, experienceText: '3+ years', applyUrl: null,
    requirements: [{ id: 'r1', text: 'Experience with Go', kind: 'must' }],
    skills: ['Go'], responsibilities: [],
};

const RECORD = buildFitRecord({
    profile: { location: 'Bengaluru', defaultTitle: 'Backend Engineer', defaultSummary: '', yearsExperience: '5' },
    experiences: [{ company: 'Razorpay', role: 'Engineer', startDate: '2021', endDate: '', current: true, description: '', highlights: ['Built settlement in Go'] }],
    projects: [],
});

afterEach(() => __testing.reset());

describe('fitSection', () => {
    test('pauses on the one question that decides the verdict, without paying for prose', async () => {
        __testing.setLoader(async () => ({ record: RECORD, prefs: { ...defaultUserGenerationPreferences, preferredWorkModes: ['onsite'] } }));
        let aiCalls = 0;
        const ctx = fakeContext({
            sections: { jd: okSection<'jd'>(JD) },
            ai: (async () => {
                aiCalls += 1;
                return {};
            }) as never,
        });
        const outcome = await fitSection(ctx);
        expect(outcome.status).toBe('needs_input');
        if (outcome.status !== 'needs_input') return;
        expect(outcome.question.id).toBe('pref.relocate');
        expect(outcome.data?.summary).toBeTruthy();
        expect(aiCalls).toBe(0);
    });

    test('after the answer: a verdict, with the model summary under the guard', async () => {
        __testing.setLoader(async () => ({ record: RECORD, prefs: { ...defaultUserGenerationPreferences, preferredWorkModes: ['onsite'] } }));
        const guards: unknown[] = [];
        const ctx = fakeContext({
            sections: { jd: okSection<'jd'>(JD) },
            answers: { 'pref.relocate': 'yes' },
            ai: (async (opts: { guard?: unknown; system: string }) => {
                // "Experience with Go" is settled by the prefilter, so only the
                // summary reaches the model here.
                expect(opts.system).not.toContain('recruiter screening');
                guards.push(opts.guard);
                return { data: { summary: 'A strong fit: your Go work at Razorpay covers the core requirement.' }, degraded: false };
            }) as never,
        });
        const outcome = await fitSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;
        expect(outcome.data.verdict).toBe('strong');
        expect(outcome.data.summary).toContain('Razorpay');
        expect(guards).toHaveLength(1);
        expect((guards[0] as { fields: string[] }).fields).toEqual(['summary']);
    });

    test('a model failure falls back to the deterministic summary, never fails the fit', async () => {
        __testing.setLoader(async () => ({ record: RECORD, prefs: { ...defaultUserGenerationPreferences, preferredWorkModes: ['onsite'], willingToRelocate: 'yes' } }));
        const ctx = fakeContext({
            sections: { jd: okSection<'jd'>(JD) },
            ai: (async () => {
                throw new Error('provider 500');
            }) as never,
        });
        const outcome = await fitSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status === 'ok') expect(outcome.data.summary).toContain('strong fit');
    });

    test('no JD, no fit', async () => {
        const outcome = await fitSection(fakeContext({}));
        expect(outcome.status).toBe('unavailable');
    });
});
