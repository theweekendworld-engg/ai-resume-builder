import { ScoreFixSchema, type ScoreFix } from '@/lib/anonScoreSchema';
import { z } from 'zod';

/**
 * The Phase 1 anonymous checker stashes its result in sessionStorage under this
 * key before routing the user to sign-up. After auth, the builder/editor reads
 * it ONCE to (a) preload a parsed resume and (b) seed the fix checklist, then
 * clears it so it does not re-fire.
 */
export const PENDING_SCORE_KEY = 'patronus:pendingScore';

const PendingScoreSchema = z.object({
    extractedText: z.string(),
    fixes: z.array(ScoreFixSchema),
    score: z.number(),
    createdAt: z.string(),
});

export interface PendingScore {
    extractedText: string;
    fixes: ScoreFix[];
    score: number;
    createdAt: string;
}

/** Reads + validates the pending score handoff. Returns null if absent/invalid. */
export function readPendingScore(): PendingScore | null {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return null;
        const raw = window.sessionStorage.getItem(PENDING_SCORE_KEY);
        if (!raw) return null;
        const parsed = PendingScoreSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return null;
        return parsed.data;
    } catch {
        return null;
    }
}

/** Clears the handoff so it is consumed exactly once. */
export function clearPendingScore(): void {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        window.sessionStorage.removeItem(PENDING_SCORE_KEY);
    } catch {
        // Non-fatal.
    }
}
