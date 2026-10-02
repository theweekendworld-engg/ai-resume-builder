/**
 * Confirmed Wins reach the resume (launch audit 2026-10-02: none ever did),
 * and only shareable ones (CLAUDE.md rule 3: filtered in the query).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getRoleEvidence, listRoles } from './evidence';

const USER = `itest-evwins-${Date.now()}`;

afterAll(async () => {
    await prisma.win.deleteMany({ where: { userId: USER } });
    await prisma.userExperience.deleteMany({ where: { userId: USER } });
});

const win = (employerId: string, title: string, sensitivity: WinSensitivity, status: WinStatus) =>
    prisma.win.create({
        data: { userId: USER, employerId, title, narrative: `${title} in detail`, occurredAt: new Date(), category: WinCategory.shipped, source: WinSource.manual, sensitivity, status },
    });

describe('Wins in role evidence', () => {
    test('confirmed shareable Wins are evidence lines; confidential and drafts are not', async () => {
        const role = await prisma.userExperience.create({
            data: { userId: USER, company: 'Northwind', role: 'Backend Engineer', startDate: '2022-01', highlights: ['Owned the billing service.'] },
        });
        await win(role.id, 'Shipped the retry queue, p99 900ms to 300ms', WinSensitivity.shareable, WinStatus.confirmed);
        await win(role.id, 'Secret acquisition work', WinSensitivity.confidential, WinStatus.confirmed);
        await win(role.id, 'Unconfirmed draft', WinSensitivity.shareable, WinStatus.draft);

        const evidence = await getRoleEvidence(USER, role.id);
        const lines = evidence?.lines.join('\n') ?? '';
        expect(lines).toContain('Owned the billing service.');
        expect(lines).toContain('Shipped the retry queue, p99 900ms to 300ms');
        expect(lines).not.toContain('Secret acquisition');
        expect(lines).not.toContain('Unconfirmed draft');

        const [indexed] = await listRoles(USER);
        expect(indexed.evidenceCount).toBe(2);
    });

    test('a role with no highlights but confirmed Wins is not "summary only"', async () => {
        const role = await prisma.userExperience.create({
            data: { userId: USER, company: 'Acme', role: 'SDE', startDate: '2020-01', description: 'Worked on things.' },
        });
        await win(role.id, 'Cut build time from 20 minutes to 6', WinSensitivity.shareable, WinStatus.confirmed);
        const evidence = await getRoleEvidence(USER, role.id);
        // The narrative already starts with the title, so the title is not repeated.
        expect(evidence?.lines).toEqual(['Cut build time from 20 minutes to 6 in detail']);
        expect(evidence?.summaryOnly).toBeUndefined();
    });
});
