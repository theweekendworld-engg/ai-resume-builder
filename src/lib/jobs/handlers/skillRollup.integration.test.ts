/**
 * skill_rollup against the local Postgres: the batched upsert writes one row
 * per (skill, window, geo), a second run updates rather than duplicates, and
 * comp only counts when band-eligible.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import { skillRollupHandler } from './skillRollup';

const RUN = `itest-rollup-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SKILL = `${RUN}-kafka`;
const GEO = `${RUN}-geo`;
let sourceId = '';

const ctx = {
    jobId: 'test', attempt: 1, deadline: new Date(Date.now() + 60_000),
    enqueue: async () => ({ jobId: 'x', deduped: false }), log: () => {},
} as never;

beforeAll(async () => {
    const source = await prisma.jobSource.create({
        data: { provider: 'greenhouse', boardToken: RUN, companyName: 'Rollup Co' },
        select: { id: true },
    });
    sourceId = source.id;
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
        await prisma.jobPosting.create({
            data: {
                sourceId, externalId: `${RUN}-${i}`, title: 'Backend Engineer', absoluteUrl: `https://example.com/${RUN}/${i}`,
                contentHash: `${RUN}-${i}`, postedAt: new Date(now - (i + 1) * 86_400_000), geoBucket: GEO,
                skills: [SKILL], seniority: 'senior',
                compAnnualLow: 100_000 + i * 10_000, compAnnualHigh: 150_000 + i * 10_000, compCurrency: 'USD',
                compBandEligible: i < 2,
            },
        });
    }
});

afterAll(async () => {
    await prisma.skillSignal.deleteMany({ where: { skillNorm: SKILL } });
    await prisma.jobPosting.deleteMany({ where: { sourceId } });
    await prisma.jobSource.deleteMany({ where: { id: sourceId } });
});

describe('skill_rollup', () => {
    test('writes one row per window for the cell, with comp from band-eligible postings only', async () => {
        await skillRollupHandler({}, ctx);
        const rows = await prisma.skillSignal.findMany({ where: { skillNorm: SKILL, geoBucket: GEO }, orderBy: { window: 'asc' } });
        expect(rows.map((r) => r.window)).toEqual(['365d', '90d']);
        for (const row of rows) {
            expect(row.postingCount).toBe(3);
            expect(row.currency).toBe('USD');
            expect(row.medianLow).not.toBeNull();
            expect(row.seniorityMix).toEqual({ senior: 3 });
            expect(row.trendPercent).toBeNull();
        }
    });

    test('a second run updates the same rows instead of adding more', async () => {
        await prisma.jobPosting.create({
            data: {
                sourceId, externalId: `${RUN}-late`, title: 'Backend Engineer', absoluteUrl: `https://example.com/${RUN}/late`,
                contentHash: `${RUN}-late`, postedAt: new Date(), geoBucket: GEO, skills: [SKILL], compBandEligible: false,
            },
        });
        await skillRollupHandler({}, ctx);
        const rows = await prisma.skillSignal.findMany({ where: { skillNorm: SKILL, geoBucket: GEO } });
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.postingCount === 4)).toBe(true);
    });
});
