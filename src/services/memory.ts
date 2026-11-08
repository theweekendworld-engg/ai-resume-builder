/**
 * Long-term memory: what the user has told us, kept for months
 * (docs/impl/08-memory.md).
 *
 * Two memories, the way Claude Code has two:
 *
 *   session    `ChatConversation` turns + `focus` (src/lib/chat/focus.ts).
 *              What we are doing right now. Hours.
 *   long-term  `UserMemory`, this file. What the user told us about
 *              themselves: one short line per topic. Months.
 *
 * The rules that matter:
 *
 *   - One ACTIVE row per (userId, key). Held by a partial unique index in the
 *     database, not only by this code. A new answer supersedes the old row
 *     (status `superseded`, `supersededById`), so history is kept and the
 *     prompt only ever sees the current line.
 *   - Keys are derived in code (src/lib/memory/topics.ts), never by a model.
 *   - Sensitivity is a query concern: `shareableMemoryWhere` is the only way
 *     an artifact path reads memories, and it filters in SQL.
 *   - A memory is user-stated, not evidence. Used in a resume it is a
 *     clarification answer, nothing more; it never becomes a confirmed Win.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { MEMORY_TEXT_MAX, renderMemoryIndex } from '@/lib/memory/format';
import { canonicalKey, labelFromKey, relatedKeys, textMentions } from '@/lib/memory/topics';

export const MEMORY_SOURCES = ['clarification_answer', 'chat', 'scout_answer', 'consolidation', 'user_edit'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_SENSITIVITIES = ['shareable', 'private'] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export type MemoryStatus = 'active' | 'superseded' | 'deleted';

/** Rows read for recall. A person's memory is tens of lines, not thousands. */
export const MEMORY_READ_LIMIT = 200;

const KEY_PATTERN = /^(skill|pref|fact):[a-z0-9_]{1,48}$/;
const REMEMBER_ATTEMPTS = 5;

export type MemoryView = {
    id: string;
    key: string;
    label: string;
    text: string;
    source: MemorySource;
    sensitivity: MemorySensitivity;
    useCount: number;
    /** When the user told us this line (ISO). A changed line is a new row. */
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | null;
};

type MemoryRow = {
    id: string;
    key: string;
    label: string;
    text: string;
    source: string;
    sensitivity: string;
    useCount: number;
    createdAt: Date;
    updatedAt: Date;
    lastUsedAt: Date | null;
};

const VIEW_SELECT = {
    id: true,
    key: true,
    label: true,
    text: true,
    source: true,
    sensitivity: true,
    useCount: true,
    createdAt: true,
    updatedAt: true,
    lastUsedAt: true,
} as const;

function toView(row: MemoryRow): MemoryView {
    return {
        id: row.id,
        key: row.key,
        label: row.label || labelFromKey(row.key),
        text: row.text,
        source: (MEMORY_SOURCES as readonly string[]).includes(row.source) ? (row.source as MemorySource) : 'chat',
        sensitivity: row.sensitivity === 'private' ? 'private' : 'shareable',
        useCount: row.useCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    };
}

/** Most used first, then most recently used, then newest: the prompt index order. */
const ORDER: Prisma.UserMemoryOrderByWithRelationInput[] = [
    { useCount: 'desc' },
    { lastUsedAt: { sort: 'desc', nulls: 'last' } },
    { createdAt: 'desc' },
];

/**
 * The ONLY where-clause an external artifact may read memories through
 * (CLAUDE.md rule 3). Private lines never leave the query.
 */
export function shareableMemoryWhere(userId: string): Prisma.UserMemoryWhereInput {
    return { userId, status: 'active', sensitivity: 'shareable' };
}

export function cleanMemoryText(text: string): string {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > MEMORY_TEXT_MAX ? clean.slice(0, MEMORY_TEXT_MAX).trim() : clean;
}

function sameText(a: string, b: string): boolean {
    const n = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return n(a) === n(b);
}

/** Another writer superseded the row this attempt read; retry against theirs. */
class SupersededConcurrently extends Error {}

function isRaceLoss(error: unknown): boolean {
    if (error instanceof SupersededConcurrently) return true;
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export type RememberInput = {
    key: string;
    label?: string;
    text: string;
    source: MemorySource;
    sourceRef?: string | null;
    /** Omitted: keep the current row's choice, or shareable for a new topic. */
    sensitivity?: MemorySensitivity;
};

/**
 * Write or refresh the memory for a topic. The same line said again only
 * touches the row; a different line supersedes it. Returns null when there is
 * nothing to remember (empty text, a key that is not a topic).
 */
export async function remember(userId: string, input: RememberInput): Promise<MemoryView | null> {
    const key = canonicalKey(input.key.trim().toLowerCase());
    const text = cleanMemoryText(input.text);
    if (!userId || !text || !KEY_PATTERN.test(key)) return null;

    // Writers racing for one topic meet the partial unique index; the loser
    // retries and supersedes the winner. A few attempts, with a little
    // jitter, because three writers can make one lose twice.
    for (let attempt = 0; attempt < REMEMBER_ATTEMPTS; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const current = await tx.userMemory.findFirst({
                    where: { userId, key, status: 'active' },
                    select: VIEW_SELECT,
                });
                if (current && sameText(current.text, text)) {
                    const touched = await tx.userMemory.update({
                        where: { id: current.id },
                        data: {
                            ...(input.label && !current.label ? { label: input.label.slice(0, 80) } : {}),
                            ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
                            sourceRef: input.sourceRef ?? undefined,
                        },
                        select: VIEW_SELECT,
                    });
                    return toView(touched);
                }
                if (current) {
                    // Conditional: a concurrent writer that got here first wins,
                    // and this attempt retries against its row.
                    const flipped = await tx.userMemory.updateMany({
                        where: { id: current.id, status: 'active' },
                        data: { status: 'superseded' },
                    });
                    if (flipped.count === 0) throw new SupersededConcurrently();
                }
                const created = await tx.userMemory.create({
                    data: {
                        userId,
                        key,
                        label: (input.label?.trim() || current?.label || '').slice(0, 80),
                        text,
                        source: input.source,
                        sourceRef: input.sourceRef ?? null,
                        sensitivity: input.sensitivity ?? (current?.sensitivity === 'private' ? 'private' : 'shareable'),
                        // Usage follows the topic, so a refreshed answer keeps its place in the index.
                        useCount: current?.useCount ?? 0,
                        lastUsedAt: current?.lastUsedAt ?? null,
                    },
                    select: VIEW_SELECT,
                });
                if (current) {
                    await tx.userMemory.update({ where: { id: current.id }, data: { supersededById: created.id } });
                }
                return toView(created);
            });
        } catch (error: unknown) {
            if (attempt < REMEMBER_ATTEMPTS - 1 && isRaceLoss(error)) {
                await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20)));
                continue;
            }
            throw error;
        }
    }
    return null;
}

/** Active memories, most used first. `shareableOnly` filters in the query. */
export async function listMemories(userId: string, opts: { shareableOnly?: boolean; limit?: number } = {}): Promise<MemoryView[]> {
    const rows = await prisma.userMemory.findMany({
        where: opts.shareableOnly ? shareableMemoryWhere(userId) : { userId, status: 'active' },
        orderBy: ORDER,
        take: Math.min(opts.limit ?? MEMORY_READ_LIMIT, MEMORY_READ_LIMIT),
        select: VIEW_SELECT,
    });
    return rows.map(toView);
}

/**
 * Recall by topic keys, by a free-text query, or both. A query matches a
 * memory whose key or text names it (aliases included: "Anthropic" finds the
 * Claude memory).
 */
export async function recall(
    userId: string,
    params: { keys?: string[]; query?: string; shareableOnly?: boolean },
): Promise<MemoryView[]> {
    const all = await listMemories(userId, { shareableOnly: params.shareableOnly });
    const keys = new Set((params.keys ?? []).map((key) => canonicalKey(key)));
    const query = params.query?.trim();
    const queryKeys = query ? new Set(relatedKeys(query)) : new Set<string>();
    return all.filter((memory) => {
        if (keys.has(memory.key)) return true;
        if (!query) return false;
        return queryKeys.has(memory.key) || textMentions(memory.text, query);
    });
}

/**
 * For each skill a posting asks about, the memory that already answers it.
 * A memory filed under the skill (or an alias of it) wins; failing that, one
 * whose text names it. Skills with no memory are absent from the map.
 */
export async function recallForSkills(userId: string, skills: readonly string[]): Promise<Map<string, MemoryView>> {
    const found = new Map<string, MemoryView>();
    if (skills.length === 0) return found;
    // Skills only: a preference ("Remote") is never the answer to a requirement.
    const memories = (await listMemories(userId)).filter((memory) => memory.key.startsWith('skill:'));
    if (memories.length === 0) return found;
    for (const skill of skills) {
        const keys = relatedKeys(skill);
        const byKey = keys.map((key) => memories.find((memory) => memory.key === key)).find(Boolean);
        const byText = byKey ?? memories.find((memory) => textMentions(memory.text, skill));
        if (byText) found.set(skill, byText);
    }
    return found;
}

/**
 * Count a use. Raw SQL on purpose: `@updatedAt` would otherwise move on every
 * read-time use, and `updatedAt` should mean "the line changed".
 */
export async function markMemoriesUsed(userId: string, ids: readonly string[], now: Date = new Date()): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    await prisma.$executeRaw`UPDATE "UserMemory" SET "useCount" = "useCount" + 1, "lastUsedAt" = ${now} WHERE "userId" = ${userId} AND "status" = 'active' AND "id" IN (${Prisma.join(unique)})`;
}

/**
 * Change a memory from Settings → Memory. New text is a new row
 * (`user_edit`) superseding the old, so history survives; a sensitivity
 * change alone is metadata and updates in place.
 */
export async function editMemory(
    userId: string,
    id: string,
    patch: { text?: string; sensitivity?: MemorySensitivity },
): Promise<Result<MemoryView>> {
    const current = await prisma.userMemory.findFirst({ where: { id, userId, status: 'active' }, select: VIEW_SELECT });
    if (!current) return err('That memory is gone. Reload to see the current list.', 'not_found');

    const text = patch.text === undefined ? undefined : cleanMemoryText(patch.text);
    if (text !== undefined && !text) return err('A memory needs some text. Delete it instead.', 'invalid_input');

    if (text !== undefined && !sameText(text, current.text)) {
        const saved = await remember(userId, {
            key: current.key,
            label: current.label,
            text,
            source: 'user_edit',
            sourceRef: `edit:${current.id}`,
            sensitivity: patch.sensitivity ?? (current.sensitivity === 'private' ? 'private' : 'shareable'),
        });
        return saved ? ok(saved) : err('Could not save that.', 'invalid_input');
    }

    if (patch.sensitivity && patch.sensitivity !== current.sensitivity) {
        const updated = await prisma.userMemory.update({
            where: { id: current.id },
            data: { sensitivity: patch.sensitivity },
            select: VIEW_SELECT,
        });
        return ok(toView(updated));
    }
    return ok(toView(current));
}

/** Soft delete. The topic is unknown again, so it may be asked about again. */
export async function forgetMemory(userId: string, id: string): Promise<Result<{ id: string }>> {
    const result = await prisma.userMemory.updateMany({
        where: { id, userId, status: 'active' },
        data: { status: 'deleted' },
    });
    if (result.count === 0) return err('That memory is gone. Reload to see the current list.', 'not_found');
    return ok({ id });
}

/**
 * The compact block a prompt sees: one line per memory, most used first,
 * at most ~1,500 characters. Empty string when there is nothing.
 * `shareableOnly` for anything that feeds an artifact (filtered in SQL).
 */
export async function memoryIndex(userId: string, opts: { shareableOnly?: boolean; maxChars?: number } = {}): Promise<string> {
    const memories = await listMemories(userId, { shareableOnly: opts.shareableOnly, limit: 60 });
    return renderMemoryIndex(memories, opts.maxChars);
}
