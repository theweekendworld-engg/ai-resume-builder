/** Home's data, against the local Postgres. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ApplicationStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getOverview, type OverviewFlags } from './overview';

const USER = `itest-overview-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ALL: OverviewFlags = { chat: true, scout: true, workLog: true, missions: false, journey: true };
const NONE: OverviewFlags = { chat: false, scout: false, workLog: false, missions: false, journey: false };

beforeAll(async () => {
    const now = Date.now();
    const acme = await prisma.applicationWorkspace.create({ data: { userId: USER, sourceUrl: `https://a.test/${USER}`, companyName: 'Acme', roleTitle: 'Backend Engineer', applicationStatus: ApplicationStatus.interview } });
    await prisma.applicationWorkspace.create({ data: { userId: USER, sourceUrl: `https://b.test/${USER}`, companyName: 'Globex', roleTitle: 'SDE II', applicationStatus: ApplicationStatus.analyzed } });
    await prisma.applicationEvent.create({ data: { userId: USER, workspaceId: acme.id, kind: 'interview', occurredAt: new Date(now + 2 * 86_400_000), title: 'Acme technical interview', source: 'calendar', refId: 'gcal:1' } });
    await prisma.applicationEvent.create({ data: { userId: USER, workspaceId: acme.id, kind: 'status_change', occurredAt: new Date(now - 3_600_000), title: 'Moved to Interviewing', source: 'email' } });
    await prisma.jobEmail.create({ data: { userId: USER, messageId: 'm1', fromEmail: 'priya@acme.com', fromName: 'Priya', subject: 'Times?', receivedAt: new Date(now - 7_200_000), textBody: 'x', status: 'processed', kind: 'scheduling', workspaceId: acme.id } });
    await prisma.win.create({ data: { userId: USER, title: 'Shipped the retry queue', occurredAt: new Date(), status: 'draft', category: 'shipped', source: 'manual' } });
});

afterAll(async () => {
    await prisma.jobEmail.deleteMany({ where: { userId: USER } });
    await prisma.win.deleteMany({ where: { userId: USER } });
    await prisma.applicationWorkspace.deleteMany({ where: { userId: USER } });
});

describe('getOverview', () => {
    test('needs-you is ranked: the interview first, then the reply, then drafts, then jobs to review', async () => {
        const data = await getOverview(USER, ALL);
        expect(data.needsYou.map((item) => item.kind)).toEqual(['interview', 'email', 'drafts', 'review']);
        expect(data.pipeline?.find((s) => s.column === 'interviewing')?.count).toBe(1);
        expect(data.pipeline?.find((s) => s.column === 'to_review')?.count).toBe(1);
        expect(data.upcoming?.[0].title).toBe('Acme technical interview');
        expect(data.activity[0].title).toBe('Moved to Interviewing');
    });

    test('a section whose feature is off is absent, not empty', async () => {
        const data = await getOverview(USER, NONE);
        expect(data.pipeline).toBeNull();
        expect(data.upcoming).toBeNull();
        expect(data.record).toBeNull();
        expect(data.needsYou.map((item) => item.kind)).toEqual([]);
        expect(data.setup.map((step) => step.key)).toEqual(['resume', 'telegram']);
    });
});
