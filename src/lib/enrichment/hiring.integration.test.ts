/**
 * The hiring lookup against a live Postgres.
 *
 * `computeHiringSignal` is pure and covered exhaustively in `hiring.test.ts`.
 * What that cannot reach is the QUERY in front of it, which is where this
 * feature is most likely to fail quietly: `findCompanySourceIds` prefilters in
 * SQL on one token and then compares canonical names in JS, and if that match
 * misses, the caller does not get an error — it gets `no_postings`, which reads
 * as "we have nothing on them" for a company whose board we poll daily.
 *
 * That silent-miss path is the reason this file exists.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { JobBoardProvider } from '@prisma/client';

const { prisma } = await import('@/lib/prisma');
const { getCompanyHiringSignal } = await import('./hiring');
const { MIN_POSTINGS_FOR_ABSENCE } = await import('./hiring');

const sourceIds: string[] = [];
const NOW = new Date('2026-09-05T00:00:00.000Z');

async function seedBoard(companyName: string, postings: Array<{
    location: string | null;
    geoBucket: string | null;
    daysAgo?: number;
}>) {
    const token = `t-${Math.random().toString(36).slice(2, 10)}`;
    const source = await prisma.jobSource.create({
        data: { provider: JobBoardProvider.greenhouse, boardToken: token, companyName },
    });
    sourceIds.push(source.id);

    await prisma.jobPosting.createMany({
        data: postings.map((p, i) => ({
            sourceId: source.id,
            externalId: `${token}-${i}`,
            title: 'Backend Engineer',
            location: p.location,
            geoBucket: p.geoBucket,
            absoluteUrl: `https://boards.greenhouse.io/${token}/jobs/${i}`,
            contentHash: `h-${token}-${i}`,
            postedAt: new Date(NOW.getTime() - (p.daysAgo ?? 10) * 86_400_000),
        })),
    });

    return source.id;
}

afterEach(async () => {
    if (sourceIds.length === 0) return;
    // Postings cascade from the source.
    await prisma.jobSource.deleteMany({ where: { id: { in: sourceIds } } });
    sourceIds.length = 0;
});

describe('finding a company\'s board', () => {
    test('an exact name matches', async () => {
        const name = `Acme${Date.now()}`;
        await seedBoard(name, [{ location: 'Bengaluru, India', geoBucket: 'bengaluru' }]);

        const result = await getCompanyHiringSignal({ companyName: name, now: NOW });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.verdict).toBe('hires_there');
    });

    test('a legal suffix on either side still matches', async () => {
        // The exact miss the canonical key exists to prevent: the board says
        // "Acme", the workspace says "Acme, Inc.", and the storage normaliser
        // leaves a stray dot that would make these two different companies.
        const stamp = Date.now();
        await seedBoard(`Acme${stamp}`, [{ location: 'Pune, India', geoBucket: 'pune' }]);

        const result = await getCompanyHiringSignal({
            companyName: `Acme${stamp}, Inc.`,
            now: NOW,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.matched).toBe(1);
    });

    test('an unknown company is no_postings, not a crash', async () => {
        const result = await getCompanyHiringSignal({
            companyName: `NoSuchCompany${Date.now()}`,
            now: NOW,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('no_postings');
    });

    test('a company with no name at all is refused before querying', async () => {
        const result = await getCompanyHiringSignal({ companyName: '   ', now: NOW });
        expect(result.ok).toBe(false);
    });

    test('another company\'s postings do not leak in', async () => {
        const stamp = Date.now();
        await seedBoard(`Alpha${stamp}`, [{ location: 'Bengaluru, India', geoBucket: 'bengaluru' }]);
        await seedBoard(`Beta${stamp}`, Array.from({ length: MIN_POSTINGS_FOR_ABSENCE }, () => ({
            location: 'New York, NY',
            geoBucket: 'nyc',
        })));

        const beta = await getCompanyHiringSignal({ companyName: `Beta${stamp}`, now: NOW });
        expect(beta.ok).toBe(true);
        if (!beta.ok) return;
        expect(beta.signal.verdict).toBe('no_observed_hiring');
        expect(beta.signal.matched).toBe(0);
    });
});

describe('the window is enforced in SQL', () => {
    test('postings older than the window are excluded', async () => {
        const name = `Stale${Date.now()}`;
        await seedBoard(name, [
            { location: 'Bengaluru, India', geoBucket: 'bengaluru', daysAgo: 400 },
        ]);

        const result = await getCompanyHiringSignal({ companyName: name, now: NOW });
        // The only India posting is outside 180 days, so there is nothing left.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.reason).toBe('no_postings');
    });

    test('a widened window brings them back', async () => {
        const name = `Stale${Date.now()}b`;
        await seedBoard(name, [
            { location: 'Bengaluru, India', geoBucket: 'bengaluru', daysAgo: 400 },
        ]);

        const result = await getCompanyHiringSignal({
            companyName: name,
            windowDays: 500,
            now: NOW,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.verdict).toBe('hires_there');
    });
});

describe('closed postings still count as evidence', () => {
    test('a filled India role is evidence they hire there', async () => {
        const name = `Closed${Date.now()}`;
        const sourceId = await seedBoard(name, [
            { location: 'Hyderabad, India', geoBucket: 'hyderabad' },
        ]);
        await prisma.jobPosting.updateMany({
            where: { sourceId },
            data: { closedAt: new Date(NOW.getTime() - 86_400_000) },
        });

        const result = await getCompanyHiringSignal({ companyName: name, now: NOW });
        // Excluding closed roles would bias the answer toward whatever happens
        // to be open this week.
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.signal.matched).toBe(1);
    });
});
