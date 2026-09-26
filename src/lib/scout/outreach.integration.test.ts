/**
 * Rule 3 for outreach (CLAUDE.md, ADR-8): an outreach draft is an external
 * artifact, so the Win evidence it reads is filtered to shareable + confirmed
 * IN THE QUERY. These tests assert the filter and what the query returns —
 * then, end to end, that a confidential Win never reaches the model's prompt.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { WinSensitivity, WinStatus } from '@prisma/client';
import { __testing as structuredTesting } from '@/lib/ai/structured';
import { createOrGetRun } from '@/lib/agent/run';
import { externalRetrievalFilter } from '@/lib/graph/visibility';
import { prisma } from '@/lib/prisma';
import { cleanupTestUser, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import { LINKEDIN_NOTE_MAX } from '@/lib/scout/types';
import { generateOutreachDraft, loadShareableEvidence, outreachWinWhere } from './outreach';

const users: string[] = [];
function user(): string {
    const id = newTestUserId('outreach');
    users.push(id);
    return id;
}

let prompts: string[] = [];

beforeAll(() => {
    structuredTesting.setUsageLogger(async () => undefined);
});

afterEach(() => {
    prompts = [];
});

afterAll(async () => {
    structuredTesting.reset();
    for (const id of users) {
        await prisma.agentRun.deleteMany({ where: { userId: id } });
        await prisma.userExperience.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

async function confirmed(userId: string, title: string, sensitivity: WinSensitivity) {
    const win = await makeWin({ userId, title, sensitivity });
    await prisma.win.update({ where: { id: win.id }, data: { status: WinStatus.confirmed, confirmedAt: new Date() } });
    return win;
}

describe('the outreach evidence query', () => {
    test('is exactly the external retrieval filter', () => {
        expect(outreachWinWhere('u1')).toEqual(externalRetrievalFilter('u1'));
        expect(outreachWinWhere('u1')).toMatchObject({ sensitivity: WinSensitivity.shareable, status: { in: [WinStatus.confirmed] } });
    });

    test('returns shareable confirmed wins and nothing else', async () => {
        const userId = user();
        await confirmed(userId, 'Shipped the public settlement API', WinSensitivity.shareable);
        await confirmed(userId, 'Negotiated the confidential Visa contract', WinSensitivity.confidential);
        await confirmed(userId, 'Fixed the internal-only on-call rota', WinSensitivity.internal_only);
        await makeWin({ userId, title: 'Draft win never reviewed', sensitivity: WinSensitivity.shareable });

        const text = (await loadShareableEvidence(userId)).map((line) => line.text).join('\n');
        expect(text).toContain('public settlement API');
        expect(text).not.toContain('confidential Visa contract');
        expect(text).not.toContain('internal-only on-call');
        expect(text).not.toContain('Draft win never reviewed');
    });
});

describe('generateOutreachDraft', () => {
    test('never shows the model a confidential win, and enforces the note cap', async () => {
        const userId = user();
        await confirmed(userId, 'Shipped the public settlement API', WinSensitivity.shareable);
        await confirmed(userId, 'Negotiated the confidential Visa contract', WinSensitivity.confidential);
        await prisma.userExperience.create({
            data: { userId, company: 'Razorpay', role: 'Software Engineer', startDate: '2021', endDate: '', current: true, location: '', description: '', highlights: ['Built settlement in Go'] },
        });

        const { run } = await createOrGetRun({ userId, agent: 'scout', inputKey: 'k1', input: { url: 'https://example.com' } });
        const at = new Date().toISOString();
        await prisma.agentRun.update({
            where: { id: run.id },
            data: {
                kind: 'job_posting',
                result: {
                    jd: {
                        status: 'ok', sources: [], finishedAt: at,
                        data: {
                            role: 'Backend Engineer', company: 'Acme', seniority: '', domain: 'payments', location: 'Bengaluru', workMode: 'hybrid',
                            employmentType: null, compensationText: null, experienceText: null, applyUrl: null,
                            requirements: [{ id: 'r1', text: 'Go', kind: 'must' }], skills: ['Go'], responsibilities: [],
                        },
                    },
                },
            },
        });

        let calls = 0;
        structuredTesting.setObjectRunner(async ({ prompt }) => {
            prompts.push(prompt);
            calls += 1;
            // First draft is far too long; the retry is still too long; code trims.
            const body = 'Hi, I built the settlement service at Razorpay in Go and would value a referral for the Backend Engineer role at Acme. '.repeat(calls === 1 ? 5 : 4);
            return { object: { subject: null, body }, inputTokens: 1000, outputTokens: 200 };
        });

        const { draft, costUsd } = await generateOutreachDraft({ userId, runId: run.id, target: 'referral', format: 'linkedin_note' });

        expect(prompts.length).toBe(2); // one corrective retry, no more
        expect(prompts.join('\n')).not.toContain('confidential Visa contract');
        expect(prompts[0]).toContain('public settlement API');
        expect(draft.body.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
        expect(draft.subject).toBeNull();
        expect(costUsd).toBeGreaterThan(0);
    });

    test('refuses another user\'s run', async () => {
        const owner = user();
        const { run } = await createOrGetRun({ userId: owner, agent: 'scout', inputKey: 'k2', input: {} });
        await expect(generateOutreachDraft({ userId: user(), runId: run.id, target: 'recruiter', format: 'email' })).rejects.toThrow('Run not found');
    });
});
