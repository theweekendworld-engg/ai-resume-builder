/**
 * The /score → sign-up handoff, held server-side (audit 2026-09-27, B).
 * Against the local Postgres; rows are tagged and removed.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    SCORE_STASH_COOKIE,
    SCORE_STASH_TTL_MS,
    claimScoreStash,
    createScoreStash,
    readScoreStash,
    recordStashResume,
} from '@/lib/scoreStash';
import { POST } from '@/app/api/score/stash/route';

const RUN = `itest-stash-${Date.now()}`;
const ids: string[] = [];
const PAYLOAD = {
    extractedText: 'PRIYA RAMAN\nSenior Software Engineer\nFlexport 2021 - Present',
    fixes: [{ priority: 'high' as const, title: 'Quantify impact', problem: 'No numbers', suggestion: 'Built X serving [N] users' }],
    score: 62,
};

afterAll(async () => {
    await prisma.pendingScore.deleteMany({ where: { OR: [{ id: { in: ids } }, { userId: { startsWith: RUN } }] } });
});

async function make(now = new Date()) {
    const row = await createScoreStash(PAYLOAD, now);
    ids.push(row.id);
    return row;
}

describe('score stash', () => {
    test('an unclaimed stash is readable by id, then bound to whoever claims it', async () => {
        const { id } = await make();
        expect((await readScoreStash(id, null))?.fixes).toHaveLength(1);

        const claimed = await claimScoreStash(id, `${RUN}-a`);
        expect(claimed?.claimedBy).toBe(`${RUN}-a`);
        // After the claim, only the claimant can read it.
        expect(await readScoreStash(id, `${RUN}-b`)).toBeNull();
        expect(await readScoreStash(id, null)).toBeNull();
        expect((await readScoreStash(id, `${RUN}-a`))?.score).toBe(62);
    });

    test('a second user can never claim it, even racing', async () => {
        const { id } = await make();
        const [a, b] = await Promise.all([claimScoreStash(id, `${RUN}-x`), claimScoreStash(id, `${RUN}-y`)]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        const row = await prisma.pendingScore.findUnique({ where: { id } });
        expect([`${RUN}-x`, `${RUN}-y`]).toContain(row!.userId!);
    });

    test('an expired stash reads as absent and cannot be claimed', async () => {
        const past = new Date(Date.now() - SCORE_STASH_TTL_MS - 60_000);
        const { id } = await make(past);
        expect(await readScoreStash(id, null)).toBeNull();
        expect(await claimScoreStash(id, `${RUN}-late`)).toBeNull();
    });

    test('the resume made from it is remembered, so a re-open reuses it', async () => {
        const { id } = await make();
        await claimScoreStash(id, `${RUN}-r`);
        await recordStashResume(id, `${RUN}-r`, 'resume_abc');
        expect((await readScoreStash(id, `${RUN}-r`))?.resumeId).toBe('resume_abc');
    });

    test('ids that are not ids are refused without a query', async () => {
        expect(await readScoreStash('../../etc', null)).toBeNull();
        expect(await claimScoreStash('', `${RUN}-z`)).toBeNull();
    });
});

describe('POST /api/score/stash', () => {
    function request(body: unknown, ip = `10.9.${Math.floor(Math.random() * 250)}.1`) {
        return new NextRequest('http://localhost/api/score/stash', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        });
    }

    test('stores a valid result, returns its id, and sets the first-party cookie', async () => {
        const res = await POST(request(PAYLOAD));
        expect(res.status).toBe(201);
        const data = (await res.json()) as { success: boolean; id: string };
        ids.push(data.id);
        expect(data.success).toBe(true);
        expect(res.cookies.get(SCORE_STASH_COOKIE)?.value).toBe(data.id);
        expect(await readScoreStash(data.id, null)).not.toBeNull();
    });

    test('an invalid payload is a 400, not a row', async () => {
        const before = await prisma.pendingScore.count();
        expect((await POST(request({ extractedText: '', fixes: [], score: 50 }))).status).toBe(400);
        expect((await POST(request({ ...PAYLOAD, score: 900 }))).status).toBe(400);
        expect((await POST(request('not json'))).status).toBe(400);
        expect(await prisma.pendingScore.count()).toBe(before);
    });

    test('an oversized body is refused', async () => {
        const res = await POST(request({ ...PAYLOAD, extractedText: 'x'.repeat(200_000) }));
        expect(res.status).toBe(413);
    });

    test('one address is rate-limited', async () => {
        const ip = '10.200.200.200';
        const statuses: number[] = [];
        for (let i = 0; i < 22; i++) {
            const res = await POST(request(PAYLOAD, ip));
            if (res.status === 201) ids.push(((await res.json()) as { id: string }).id);
            statuses.push(res.status);
        }
        expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    });
});
