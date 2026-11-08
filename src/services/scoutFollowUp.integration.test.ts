/**
 * The fit is never withheld behind a question (QA 2026-11-07, "Your fit:
 * Waiting on your answer above"). A pay-floor question rides on a FINISHED
 * run as the fit's follow-up; answering it records the answer, recomputes
 * fit and track, saves the floor to the profile, and resumes the run once.
 *
 * Also: a section that hits the monthly AI ceiling says so in the ceiling's
 * words instead of "This part failed after a retry".
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createOrGetRun, readAnswers, readSections } from '@/lib/agent/run';
import { prisma } from '@/lib/prisma';
import { runScoutSection } from '@/lib/scout/pipeline';
import { __testing as jdTesting } from '@/lib/scout/sections/jd';
import type { FitData } from '@/lib/scout/types';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { UsageLimitError } from '@/lib/usageTracker';
import { __testing, answerScoutQuestion, openFollowUp } from '@/services/scout';

const USER = `itest-followup-${Date.now()}`;
const resumed: string[] = [];

beforeAll(() => {
    // Seams, not mock.module. The resumed run is recorded, not executed.
    __testing.setStarter(async (runId) => ({ runId }));
    __testing.setStagesRunner(async (runId) => {
        resumed.push(runId);
    });
});

afterAll(async () => {
    __testing.setStarter(null);
    __testing.setStagesRunner(null);
    jdTesting.reset();
    const runs = await prisma.agentRun.findMany({ where: { userId: USER }, select: { id: true } });
    await prisma.agentStep.deleteMany({ where: { runId: { in: runs.map((run) => run.id) } } });
    await prisma.agentRun.deleteMany({ where: { userId: USER } });
    await prisma.userProfile.deleteMany({ where: { userId: USER } });
});

const AT = new Date().toISOString();

const FIT: FitData = {
    score: 88,
    verdict: 'strong',
    matched: [{ requirementId: 'r1', text: 'Go', evidence: 'Built settlement in Go', strength: 'direct' }],
    gaps: [],
    preferenceChecks: [{ key: 'compensation', status: 'unknown', detail: 'Posted pay: ₹30-40 LPA; you have not set a floor' }],
    notFitReasons: [],
    summary: 'Backend Engineer at Acme looks like a strong fit.',
    softRequirements: [],
    followUp: { id: 'pref.minComp', step: 'fit', prompt: 'This posting states ₹30-40 LPA. What is the lowest compensation you would take?' },
};

async function finishedRun(status: 'succeeded' | 'running' = 'succeeded') {
    const { run } = await createOrGetRun({ userId: USER, agent: 'scout', inputKey: `k-${Math.random()}`, input: { text: 'x'.repeat(300), source: 'dashboard' } });
    await prisma.agentRun.update({
        where: { id: run.id },
        data: {
            kind: 'job_posting',
            status,
            workflowRunId: 'inline:dev:done',
            result: {
                fit: { status: 'ok', data: FIT, sources: [], finishedAt: AT },
                track: { status: 'ok', data: { workspaceId: 'ws', status: 'analyzed', created: true }, sources: [], finishedAt: AT },
                company: { status: 'ok', data: { name: 'Acme' }, sources: [], finishedAt: AT },
            },
        },
    });
    return run.id;
}

describe('the fit follow-up', () => {
    test('a finished run carries it; answering resumes the run once, recomputes fit and track, and saves the floor', async () => {
        const runId = await finishedRun();
        const before = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
        expect(openFollowUp(before)?.id).toBe('pref.minComp');

        const answered = await answerScoutQuestion(USER, runId, '₹35 LPA', 'pref.minComp');
        expect(answered.success).toBe(true);

        const after = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
        expect(readAnswers(after)['pref.minComp']).toBe('₹35 LPA');
        const sections = readSections(after);
        expect(sections.fit).toBeUndefined();
        expect(sections.track).toBeUndefined();
        // Untouched sections are kept, so the resume pays only for fit and track.
        expect(sections.company?.status).toBe('ok');
        expect(resumed).toContain(runId);

        const profile = await prisma.userProfile.findUnique({ where: { userId: USER } });
        expect(parseUserGenerationPreferences(profile?.preferences).minCompensationText).toBe('₹35 LPA');

        // A second answer finds nothing open: the first one is recorded.
        const again = await answerScoutQuestion(USER, runId, '₹50 LPA', 'pref.minComp');
        expect(again.success).toBe(false);
    });

    test('a question id that does not match is refused, not misfiled', async () => {
        const runId = await finishedRun();
        const wrong = await answerScoutQuestion(USER, runId, 'yes', 'pref.relocate');
        expect(wrong).toMatchObject({ success: false, code: 'no_question' });
    });

    test('while the run is still going, the answer waits', async () => {
        const runId = await finishedRun('running');
        const early = await answerScoutQuestion(USER, runId, '₹35 LPA');
        expect(early).toMatchObject({ success: false, code: 'not_ready' });
    });

    test('someone else\'s run is not found', async () => {
        const runId = await finishedRun();
        expect(await answerScoutQuestion('someone-else', runId, '₹35 LPA')).toMatchObject({ success: false, code: 'not_found' });
    });
});

describe('the monthly AI ceiling inside a section', () => {
    test('is stored as unavailable with the ceiling\'s own words, not a generic failure', async () => {
        const { run } = await createOrGetRun({ userId: USER, agent: 'scout', inputKey: `k-${Math.random()}`, input: { text: 'x'.repeat(300), source: 'dashboard' } });
        await prisma.agentRun.update({
            where: { id: run.id },
            data: {
                result: {
                    ingest: {
                        status: 'ok', sources: [], finishedAt: AT,
                        data: {
                            sourceUrl: null, linkKind: 'text', fetchVia: 'provided_text', title: 'Backend Engineer', author: null, authorUrl: null,
                            companyName: 'Acme', location: null, postedAt: null, applicantsText: null, truncated: false,
                            text: `Backend Engineer at Acme. ${'We build payment rails in Go and PostgreSQL. '.repeat(10)}`,
                        },
                    },
                },
            },
        });
        jdTesting.setReader(async () => {
            throw new UsageLimitError("You've reached this month's limit for AI features.");
        });
        const section = await runScoutSection(run.id, 'jd');
        expect(section.status).toBe('unavailable');
        if (section.status === 'unavailable') expect(section.reason).toStartWith("You've reached this month's limit for AI features. It resets on");
    });
});
