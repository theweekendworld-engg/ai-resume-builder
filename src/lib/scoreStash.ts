/**
 * The free-check result, held server-side across sign-up.
 *
 * `/score` used to hand its result to the logged-in app through
 * sessionStorage. That broke on the default path twice over: the storage is
 * per TAB, so email verification opened in a new tab lost it; and `/welcome`
 * cleared it before the editor could seed the fix checklist, so "Fix all of
 * these in one click" delivered no fixes (audit 2026-09-27, flow B).
 *
 * A `PendingScore` row lives 24 hours. It is created anonymously, then CLAIMED
 * by the user who signs up with it. After a claim only that user can read it.
 * The resume created from it is recorded in the payload, so re-opening the
 * same link reopens the same resume instead of making a second one.
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ScoreFixSchema } from '@/lib/anonScoreSchema';
import { prisma } from '@/lib/prisma';

export const SCORE_STASH_TTL_MS = 24 * 60 * 60 * 1000;
export const SCORE_STASH_COOKIE = 'patronus_score_stash';
/** A resume is tens of KB of text at most; 40k chars is the parser's own cap. */
export const MAX_STASH_TEXT = 40_000;
export const MAX_STASH_FIXES = 30;

export const StashPayloadSchema = z.object({
    extractedText: z.string().trim().min(1).max(MAX_STASH_TEXT),
    fixes: z.array(ScoreFixSchema).max(MAX_STASH_FIXES),
    score: z.number().min(0).max(100),
});

export type StashPayload = z.infer<typeof StashPayloadSchema>;

/** What is stored: the payload, plus the resume made from it once one is. */
type StoredPayload = StashPayload & { resumeId?: string };

const ID = /^[a-z0-9]{20,40}$/i;

export function isStashId(value: unknown): value is string {
    return typeof value === 'string' && ID.test(value);
}

export async function createScoreStash(
    payload: StashPayload,
    now: Date = new Date(),
): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(now.getTime() + SCORE_STASH_TTL_MS);
    const row = await prisma.pendingScore.create({
        data: { payload: payload as unknown as Prisma.InputJsonValue, expiresAt },
        select: { id: true, expiresAt: true },
    });
    return row;
}

export type StashView = StashPayload & { id: string; resumeId: string | null; claimedBy: string | null };

function toView(row: { id: string; payload: Prisma.JsonValue; userId: string | null }): StashView | null {
    const stored = row.payload as unknown as StoredPayload;
    const parsed = StashPayloadSchema.safeParse(stored);
    if (!parsed.success) return null;
    return {
        ...parsed.data,
        id: row.id,
        resumeId: typeof stored.resumeId === 'string' ? stored.resumeId : null,
        claimedBy: row.userId,
    };
}

/**
 * Read a stash for `userId`. Unclaimed stashes are readable by anyone who has
 * the id (that is how the id is used across sign-up); a claimed one only by its
 * claimant. Expired stashes read as absent.
 */
export async function readScoreStash(id: string, userId: string | null, now: Date = new Date()): Promise<StashView | null> {
    if (!isStashId(id)) return null;
    const row = await prisma.pendingScore.findUnique({ where: { id }, select: { id: true, payload: true, userId: true, expiresAt: true } });
    if (!row || row.expiresAt <= now) return null;
    if (row.userId && row.userId !== userId) return null;
    return toView(row);
}

/**
 * Claim for `userId`. Conditional update, so two tabs racing to claim the same
 * stash converge: the first claimant wins and a different user never can.
 */
export async function claimScoreStash(id: string, userId: string, now: Date = new Date()): Promise<StashView | null> {
    if (!isStashId(id)) return null;
    await prisma.pendingScore.updateMany({
        where: { id, userId: null, expiresAt: { gt: now } },
        data: { userId, claimedAt: now },
    });
    return readScoreStash(id, userId, now);
}

/** Remember the resume made from this stash, so a re-open reuses it. */
export async function recordStashResume(id: string, userId: string, resumeId: string): Promise<void> {
    const row = await prisma.pendingScore.findFirst({ where: { id, userId }, select: { payload: true } });
    if (!row) return;
    const next = { ...(row.payload as Record<string, unknown>), resumeId };
    await prisma.pendingScore.update({ where: { id }, data: { payload: next as Prisma.InputJsonValue } });
}
