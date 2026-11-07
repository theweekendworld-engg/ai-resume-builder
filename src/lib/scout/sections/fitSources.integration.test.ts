/**
 * Rule 3 for fit: which Wins may become evidence. Asserts the FILTER (what
 * `loadFitSources` reads from the database), not any text a model wrote.
 * Matched lines are quoted on the fit card and into outreach drafts, so an
 * internal or confidential Win reaching the record is a leak.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity, WinSource, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { WORK_LOG_SOURCE } from '@/lib/scout/fit/evaluate';
import { loadFitSources } from './fit';

const USER = `itest-fitwins-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function win(title: string, status: WinStatus, sensitivity: WinSensitivity) {
    await prisma.win.create({
        data: { userId: USER, title, occurredAt: new Date('2026-09-01'), category: WinCategory.shipped, status, sensitivity, source: WinSource.manual },
    });
}

beforeAll(async () => {
    await prisma.userProfile.create({ data: { userId: USER, defaultTitle: 'Backend Engineer' } });
    await win('Shareable confirmed: moved settlement onto Kafka', WinStatus.confirmed, WinSensitivity.shareable);
    await win('Internal only: reorg of the payments team', WinStatus.confirmed, WinSensitivity.internal_only);
    await win('Confidential: unannounced acquisition integration', WinStatus.confirmed, WinSensitivity.confidential);
    await win('Draft: maybe sped up the ledger', WinStatus.draft, WinSensitivity.shareable);
    await win('Dismissed: not a win', WinStatus.dismissed, WinSensitivity.shareable);
});

afterAll(async () => {
    await prisma.win.deleteMany({ where: { userId: USER } });
    await prisma.userProfile.deleteMany({ where: { userId: USER } });
});

describe('loadFitSources reads Wins through the external filter', () => {
    test('only confirmed, shareable Wins become record lines', async () => {
        const { record } = await loadFitSources(USER);
        const winLines = record.lines.filter((line) => line.source === WORK_LOG_SOURCE).map((line) => line.text);
        expect(winLines).toEqual(['Shareable confirmed: moved settlement onto Kafka']);
        expect(record.corpus).not.toContain('acquisition');
        expect(record.corpus).not.toContain('reorg');
        // A record of one shareable Win is still something to match against.
        expect(record.empty).toBe(false);
    });
});
