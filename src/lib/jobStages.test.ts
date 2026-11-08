import { describe, expect, test } from 'bun:test';

import { jobStageFacts, jobStages, jobStageSummary, type JobStageFacts } from './jobStages';

const facts = (partial: Partial<JobStageFacts>): JobStageFacts => ({
    analyzed: false,
    tailored: false,
    email: false,
    applied: false,
    ...partial,
});

const statuses = (f: JobStageFacts) => jobStages(f).map((stage) => stage.status);

describe('jobStages', () => {
    test('a fresh job: the first stage is where you are', () => {
        expect(statuses(facts({}))).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    });

    test('analyzed and tailored: the email is next', () => {
        expect(statuses(facts({ analyzed: true, tailored: true }))).toEqual(['done', 'done', 'current', 'upcoming']);
    });

    test('applied without tailoring: the missed steps read as skipped, not owed', () => {
        expect(statuses(facts({ analyzed: true, applied: true }))).toEqual(['done', 'skipped', 'skipped', 'done']);
    });

    test('all four done: nothing is current', () => {
        const all = facts({ analyzed: true, tailored: true, email: true, applied: true });
        expect(statuses(all)).toEqual(['done', 'done', 'done', 'done']);
        expect(jobStageSummary(jobStages(all))).toBe('All 4 stages done');
    });

    test('exactly one stage is ever current', () => {
        for (let mask = 0; mask < 16; mask += 1) {
            const f = facts({ analyzed: !!(mask & 1), tailored: !!(mask & 2), email: !!(mask & 4), applied: !!(mask & 8) });
            const current = statuses(f).filter((status) => status === 'current').length;
            expect(current).toBeLessThanOrEqual(1);
        }
    });

    test('labels are the product words, in order', () => {
        expect(jobStages(facts({})).map((stage) => stage.label)).toEqual(['Analyzed', 'Tailored', 'Email ready', 'Applied']);
    });

    test('summary names the next step and the count', () => {
        expect(jobStageSummary(jobStages(facts({ analyzed: true })))).toBe('Next: Tailored · 1 of 4 done');
    });
});

describe('jobStageFacts', () => {
    test('a scored job is analyzed; a sent one is applied', () => {
        const f = jobStageFacts({ applicationStatus: 'applied', fitScore: 82, emailReady: false });
        expect(f).toEqual({ analyzed: true, tailored: false, email: false, applied: true });
    });

    test('a bare discovered link is not analyzed yet', () => {
        expect(jobStageFacts({ applicationStatus: 'discovered', emailReady: false }).analyzed).toBe(false);
    });

    test('any resume or generated PDF picked for the job counts as tailored', () => {
        expect(jobStageFacts({ applicationStatus: 'analyzed', selectedGeneratedPdfId: 'pdf_1', emailReady: true })).toEqual({
            analyzed: true,
            tailored: true,
            email: true,
            applied: false,
        });
    });

    test('archived is not applied', () => {
        expect(jobStageFacts({ applicationStatus: 'archived', emailReady: false }).applied).toBe(false);
    });
});
