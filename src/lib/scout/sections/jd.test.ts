import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { __testing as cacheTesting, createMemoryStore } from '@/lib/research/cache';
import type { IngestData } from '@/lib/scout/types';
import { fakeContext, okSection } from '@/lib/scout/fit/testContext.test-utils';
import { __testing, jdSection } from './jd';

const TEXT = `About the job
Acme builds payments infrastructure. This is a hybrid role in our Bengaluru office.
Requirements: 3+ years of professional experience with Go and PostgreSQL. Kubernetes is a plus.
Compensation: ₹30-45 LPA. Employment type Full-time. Apply at https://boards.greenhouse.io/acme/jobs/1.`;

function ingest(overrides: Partial<IngestData> = {}): IngestData {
    return {
        sourceUrl: 'https://www.linkedin.com/jobs/view/4455902670',
        linkKind: 'linkedin_job',
        fetchVia: 'guest_job_api',
        title: 'Software Dev Engineer II',
        author: null,
        authorUrl: null,
        companyName: 'Acme',
        location: 'Bengaluru, Karnataka, India',
        postedAt: null,
        applicantsText: null,
        text: TEXT,
        truncated: false,
        ...overrides,
    };
}

// The parse cache is shared and persistent; tests get their own, or the
// second run of this file reads the first run's parse and never calls the reader.
beforeEach(() => cacheTesting.setStore(createMemoryStore()));
afterEach(() => {
    __testing.reset();
    cacheTesting.setStore(null);
});

describe('jdSection', () => {
    test('merges the model reading with quoted page facts and charges the step', async () => {
        const seen: { feature?: string; sessionId?: string }[] = [];
        __testing.setReader(async (params) => {
            seen.push({ feature: params.feature, sessionId: params.sessionId });
            return {
                brief: {
                    role: 'Backend Engineer', company: 'Acme Corp', seniority: 'mid', domain: 'payments',
                    requirements: [
                        { id: 'r1', text: 'Go and PostgreSQL', kind: 'must', category: 'skill', satisfiedByTenure: false },
                        { id: 'd1', text: 'Own services', kind: 'responsibility', category: 'behaviour', satisfiedByTenure: false },
                    ],
                    skills: ['Go', 'PostgreSQL', 'Kubernetes'],
                    responsibilities: ['Own services'],
                },
                rejectedSkills: [],
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.0004, calls: 1, latencyMs: 10 },
            };
        });

        const ctx = fakeContext({ sections: { ingest: okSection<'ingest'>(ingest()) } });
        const outcome = await jdSection(ctx);
        expect(outcome.status).toBe('ok');
        if (outcome.status !== 'ok') return;

        expect(seen).toEqual([{ feature: 'scout', sessionId: 'run-test' }]);
        expect(ctx.costs).toEqual([0.0004]);
        // The page's structured title and company outrank the model's reading.
        expect(outcome.data.role).toBe('Software Dev Engineer II');
        expect(outcome.data.company).toBe('Acme');
        expect(outcome.data.workMode).toBe('hybrid');
        expect(outcome.data.compensationText).toBe('₹30-45 LPA');
        expect(outcome.data.experienceText).toContain('3+ years');
        expect(outcome.data.employmentType).toBe('Full-time');
        expect(outcome.data.applyUrl).toBe('https://www.linkedin.com/jobs/view/4455902670');
        expect(outcome.data.requirements.map((r) => [r.id, r.kind])).toEqual([['r1', 'must'], ['d1', 'responsibility']]);
    });

    test('a short post is unavailable with a reason, and costs nothing', async () => {
        let called = false;
        __testing.setReader(async () => {
            called = true;
            throw new Error('should not be called');
        });
        const ctx = fakeContext({ sections: { ingest: okSection<'ingest'>(ingest({ text: 'We are hiring! DM me.' })) } });
        const outcome = await jdSection(ctx);
        expect(outcome.status).toBe('unavailable');
        expect(called).toBe(false);
    });

    // Live runs 2026-09-25: one posting parsed to 10 must-haves, then 12, and
    // the fit score moved 30 → 35 with nothing about the user changing.
    test('the same posting is read once and gives the same requirements every time', async () => {
        let calls = 0;
        __testing.setReader(async () => {
            calls += 1;
            return {
                brief: {
                    role: 'Backend Engineer', company: 'Acme', seniority: 'mid', domain: 'payments',
                    requirements: [{ id: `r${calls}`, text: `Requirement read #${calls}`, kind: 'must', category: 'skill', satisfiedByTenure: false }],
                    skills: ['Go'],
                    responsibilities: [],
                },
                rejectedSkills: [],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001, calls: 1, latencyMs: 1 },
            };
        });
        const first = await jdSection(fakeContext({ sections: { ingest: okSection<'ingest'>(ingest()) } }));
        const secondCtx = fakeContext({ sections: { ingest: okSection<'ingest'>(ingest()) } });
        const second = await jdSection(secondCtx);
        expect(calls).toBe(1);
        expect(secondCtx.costs).toEqual([]);
        if (first.status !== 'ok' || second.status !== 'ok') throw new Error('expected ok');
        expect(second.data.requirements).toEqual(first.data.requirements);
    });
});
