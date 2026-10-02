/**
 * `ask_record`: find the user's own confirmed Wins about a topic.
 *
 * Semantic search first (pgvector), then a plain text match, merged. The text
 * pass is not a nicety: vectors exist only for shareable confirmed Wins and
 * only once embedded, and "my Kafka work" should find the Win that says Kafka
 * whether or not its vector has been written yet. This is the user reading
 * their own record inside the app, not an external artifact, so it is not
 * limited to shareable (rule 3 governs what leaves the app).
 */

import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { WIN_POINT_TYPE } from '@/lib/graph/visibility';
import { searchTerms } from './findJobs';
import type { ChatRecordItem } from './types';

export const RECORD_LIMIT = 6;

type WinRow = { id: string; title: string; narrative: string; occurredAt: Date; category: string };

const toItem = (win: WinRow): ChatRecordItem => ({
    winId: win.id,
    title: win.title,
    narrative: win.narrative.slice(0, 400),
    occurredAt: win.occurredAt.toISOString(),
    category: win.category,
});

const RECORD_STATUSES = [WinStatus.confirmed, WinStatus.archived];
const select = { id: true, title: true, narrative: true, occurredAt: true, category: true } as const;

export async function searchRecord(userId: string, query: string): Promise<ChatRecordItem[]> {
    const ranked: string[] = [];

    try {
        const { searchQdrantByUser } = await import('@/lib/embeddings');
        const hits = await searchQdrantByUser({ userId, query, type: WIN_POINT_TYPE, limit: RECORD_LIMIT });
        for (const hit of hits) {
            const sourceId = (hit.payload as { sourceId?: unknown } | null)?.sourceId;
            if (typeof sourceId === 'string') ranked.push(sourceId);
        }
    } catch (error: unknown) {
        console.warn('[chat] semantic record search unavailable; text match only', {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const terms = searchTerms(query);
    const textMatches = terms.length === 0
        ? []
        : await prisma.win.findMany({
            where: {
                userId,
                status: { in: RECORD_STATUSES },
                OR: terms.flatMap((term) => [
                    { title: { contains: term, mode: 'insensitive' as const } },
                    { narrative: { contains: term, mode: 'insensitive' as const } },
                ]),
            },
            orderBy: { occurredAt: 'desc' },
            take: RECORD_LIMIT,
            select,
        });

    const semantic = ranked.length === 0
        ? []
        : await prisma.win.findMany({ where: { id: { in: ranked }, userId, status: { in: RECORD_STATUSES } }, select });
    const byId = new Map<string, WinRow>([...semantic, ...textMatches].map((win) => [win.id, win]));
    const ordered = [...ranked, ...textMatches.map((win) => win.id)];
    const seen = new Set<string>();
    const out: ChatRecordItem[] = [];
    for (const id of ordered) {
        const win = byId.get(id);
        if (!win || seen.has(id)) continue;
        seen.add(id);
        out.push(toItem(win));
        if (out.length >= RECORD_LIMIT) break;
    }
    return out;
}
