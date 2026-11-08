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

    // Live test 2026-11-08: "experience with real-time audio or telephony (RTP,
    // SIP, FreeSWITCH)" came back as four must-haves, so missing SIP was a gap.
    test('examples and alternatives the reader split off arrive folded into their parent', async () => {
        const posting = `About the job
Sarvam builds voice AI. ${'You will own the real-time voice stack end to end. '.repeat(3)}
Requirements:
- Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)
- Comfortable with Kubernetes and AWS
- Go or Python`;
        const requirement = (id: string, text: string) => ({ id, text, kind: 'must' as const, category: 'skill' as const, satisfiedByTenure: false });
        __testing.setReader(async () => ({
            brief: {
                role: 'Voice AI Engineer', company: 'Sarvam', seniority: 'mid', domain: 'voice',
                requirements: [
                    requirement('r1', 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)'),
                    requirement('r2', 'RTP'), requirement('r3', 'SIP'), requirement('r4', 'FreeSWITCH'),
                    requirement('r5', 'Kubernetes'), requirement('r6', 'AWS'),
                    requirement('r7', 'Go'), requirement('r8', 'Python'),
                ],
                skills: ['RTP', 'SIP', 'FreeSWITCH', 'Kubernetes', 'AWS', 'Go', 'Python'],
                responsibilities: [],
            },
            rejectedSkills: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001, calls: 1, latencyMs: 1 },
        }));
        const outcome = await jdSection(fakeContext({ sections: { ingest: okSection<'ingest'>(ingest({ text: posting })) } }));
        if (outcome.status !== 'ok') throw new Error('expected ok');
        expect(outcome.data.requirements.map((r) => [r.id, r.text, r.anyOf ?? null])).toEqual([
            ['r1', 'Experience with real-time audio or telephony (RTP, SIP, FreeSWITCH)', ['RTP', 'SIP', 'FreeSWITCH', 'real-time audio', 'telephony']],
            ['r5', 'Kubernetes', null],
            ['r6', 'AWS', null],
            ['r7', 'Go or Python', ['Go', 'Python']],
        ]);
    });
});
