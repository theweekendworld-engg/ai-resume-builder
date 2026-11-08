/**
 * Connections imported after a job was analysed show up on it without a
 * manual Refresh (e2e QA 2026-11-08). First-degree matches are re-read on
 * every getScoutRun; nothing else the run found changes.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { createOrGetRun } from '@/lib/agent/run';
import { normalizeCompanyName } from '@/lib/enrichment/companyName';
import { prisma } from '@/lib/prisma';
import { cleanupTestUser, newTestUserId } from '@/services/winFixtures.test-utils';
import type { ScoutRunView } from '@/lib/scout/types';
import { getScoutRun } from './scout';

/** The network section's targets, or [] when it is not an ok section. */
function targetsOf(view: ScoutRunView): { fullName: string; tier: string }[] {
    const network = view.sections.network;
    return network && network.status === 'ok' ? (network.data as { targets: { fullName: string; tier: string }[] }).targets : [];
}

const users: string[] = [];

afterAll(async () => {
    for (const id of users) {
        await prisma.contact.deleteMany({ where: { userId: id } });
        await prisma.agentRun.deleteMany({ where: { userId: id } });
        await cleanupTestUser(id);
    }
});

async function analysedJob(userId: string) {
    const { run } = await createOrGetRun({ userId, agent: 'scout', inputKey: `k-${Math.random()}`, input: { text: 'post', source: 'dashboard' } });
    const at = new Date().toISOString();
    await prisma.agentRun.update({
        where: { id: run.id },
        data: {
            kind: 'job_posting',
            status: 'succeeded',
            result: {
                jd: {
                    status: 'ok', sources: [], finishedAt: at,
                    data: {
                        role: 'Backend Engineer, Voice AI', company: 'Sarvam Labs', seniority: null, domain: null, location: 'Remote, India',
                        workMode: 'remote', employmentType: null, compensationText: null, experienceText: null, applyUrl: null,
                        requirements: [], skills: [], responsibilities: [],
                    },
                },
                network: {
                    status: 'ok', sources: [], finishedAt: at,
                    // Analysed before any connections were imported: search links only.
                    data: { targets: [], searches: [], hasContacts: false },
                },
            },
        },
    });
    return run.id;
}

describe('fresh connections on read', () => {
    test('a connection imported after the analysis is named on the job', async () => {
        const userId = newTestUserId('fresh-conn');
        users.push(userId);
        const runId = await analysedJob(userId);

        const before = await getScoutRun(userId, runId);
        expect(before.success && targetsOf(before.data)).toHaveLength(0);

        await prisma.contact.create({
            data: {
                userId, fullName: 'Test Person One', company: 'Sarvam Labs', normalizedCompany: normalizeCompanyName('Sarvam Labs'),
                position: 'Engineering Manager', profileUrl: 'https://www.linkedin.com/in/test-person-one', connectedOn: new Date('2026-11-02'),
            },
        });

        const after = await getScoutRun(userId, runId);
        expect(after.success).toBe(true);
        if (!after.success) return;
        const targets = targetsOf(after.data);
        expect(targets.map((t) => [t.fullName, t.tier])).toEqual([['Test Person One', 'first_degree']]);

        // Stored data is untouched: the merge happens on read.
        const row = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { result: true } });
        expect(((row.result as { network: { data: { targets: unknown[] } } }).network.data.targets)).toHaveLength(0);
    });

    test('someone at another company is not named', async () => {
        const userId = newTestUserId('fresh-conn-other');
        users.push(userId);
        const runId = await analysedJob(userId);
        await prisma.contact.create({
            data: { userId, fullName: 'Someone Else', company: 'Plivo', normalizedCompany: normalizeCompanyName('Plivo'), position: 'Engineer' },
        });
        const view = await getScoutRun(userId, runId);
        expect(view.success && targetsOf(view.data)).toHaveLength(0);
    });
});
