/**
 * Weekly memory consolidation (docs/impl/08-memory.md §5).
 *
 * Once a week, per user whose memories changed: merge lines that are the same
 * topic, and rewrite the fresh ones to the fewest words that keep every fact.
 * ONE `generateStructured` call per user, with a closed schema: the model
 * picks a topic by index and returns its line; it never names a key, a row or
 * a topic of its own.
 *
 * Nothing new may appear, and that is checked twice:
 *
 *   1. The numeric guard, against exactly the memories it was shown. If the
 *      guard had to strip ANYTHING, the whole run keeps the originals: a
 *      memory is the user's words, and a half-trusted rewrite of it is worse
 *      than a long line.
 *   2. Per topic, in code: every content word of the rewrite must already be
 *      in that topic's own lines. A rewrite that fails keeps its originals
 *      (or, for a merge, the originals joined, which adds nothing).
 *
 * Idempotent. Rewritten rows are `consolidation` rows, which are never sent
 * again on their own, so a second run has nothing to do; the job's dedupe key
 * (`memory_consolidate:<userId>:<week>`) stops a second enqueue anyway.
 */

import { z } from 'zod';
import { generateStructured } from '@/lib/ai/structured';
import { MEMORY_TEXT_MAX } from '@/lib/memory/format';
import { canonicalKey } from '@/lib/memory/topics';
import { consolidationWindowStart, weekKeyFor } from '@/lib/memory/week';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';

/** Sources a person (or their answer) wrote. Consolidation and edits are left alone. */
export const CAPTURED_SOURCES = ['clarification_answer', 'chat', 'scout_answer'] as const;

/** Topics in one call. A person rarely has more; the rest wait a week. */
export const CONSOLIDATION_MAX_TOPICS = 40;
/** A single line this short is already minimal: not worth a model's look. */
export const MINIMAL_WORDS = 6;

export { consolidationWindowStart, weekKeyFor };

const ConsolidationSchema = z.object({
    items: z.array(z.object({
        /** The topic's number in the list shown. */
        index: z.number().int(),
        /** The topic's one line, fewest words, nothing new. */
        text: z.string().max(200),
    })).max(CONSOLIDATION_MAX_TOPICS),
});

export const CONSOLIDATION_SYSTEM = `You tidy a person's saved notes about their own work and preferences, so a small model can read them at a glance.

For each numbered topic, return ONE line: the fewest words that keep every fact in that topic's notes.

Rules:
- Use only words that appear in that topic's notes. Never add a fact, tool, company, number, scope or outcome.
- Keep every number exactly as written.
- When a topic has several notes, merge them into one line and keep each distinct fact once.
- Terse fragments are good ("Claude Sonnet voice agent at Plivo; 2k calls/day"). No "I", no filler, no full stops needed.
- Return one item per topic, with its number as index.`;

type Row = {
    id: string;
    key: string;
    label: string;
    text: string;
    source: string;
    sensitivity: string;
    useCount: number;
    lastUsedAt: Date | null;
    createdAt: Date;
};

export type Topic = { key: string; label: string; rows: Row[] };

const CONNECTORS = new Set(['and', 'at', 'for', 'with', 'on', 'in', 'of', 'the', 'a', 'an', 'to', 'via', 'using', 'by', 'from', 'plus', 'as', 'or']);

function words(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9.%$€£₹+#]+/)
        .map((token) => token.replace(/^\.+|\.+$/g, ''))
        .filter(Boolean);
}

/**
 * Nothing new: every word of the rewrite is already one of the topic's own
 * words (connectors aside). Strict on purpose; a false rejection costs a
 * long line, a false acceptance puts words in the user's mouth.
 */
export function addsNothing(rewrite: string, sources: readonly string[]): boolean {
    const allowed = new Set(sources.flatMap(words));
    return words(rewrite).every((word) => allowed.has(word) || CONNECTORS.has(word));
}

function wordCount(text: string): number {
    return words(text).length;
}

/** Join distinct lines of a merged topic, deterministically. Adds no word. */
export function joinLines(texts: readonly string[]): string {
    const distinct: string[] = [];
    for (const text of texts) {
        const clean = text.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
        if (clean && !distinct.some((seen) => seen.toLowerCase() === clean.toLowerCase())) distinct.push(clean);
    }
    const joined = distinct.join('; ');
    return joined.length > MEMORY_TEXT_MAX ? joined.slice(0, MEMORY_TEXT_MAX).trim() : joined;
}

/**
 * The topics worth a look: every canonical topic that holds a freshly
 * captured line, with any other active line on the same canonical key.
 * A single line already this short, or already consolidated, is left alone.
 */
export function topicsToConsolidate(rows: readonly Row[]): Topic[] {
    const byKey = new Map<string, Row[]>();
    for (const row of rows) {
        const key = canonicalKey(row.key);
        byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
    const topics: Topic[] = [];
    for (const [key, group] of byKey) {
        // Nothing freshly captured: already consolidated or edited by hand.
        if (!group.some((row) => (CAPTURED_SOURCES as readonly string[]).includes(row.source))) continue;
        if (group.length === 1 && wordCount(group[0].text) <= MINIMAL_WORDS) continue;
        const newest = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        topics.push({ key, label: newest.label, rows: group });
    }
    return topics.slice(0, CONSOLIDATION_MAX_TOPICS);
}

export function renderTopics(topics: readonly Topic[]): string {
    return topics
        .map((topic, i) => [
            `${i + 1}. ${topic.label || topic.key}`,
            ...topic.rows.map((row) => `   - ${row.text.replace(/\s+/g, ' ').trim()}`),
        ].join('\n'))
        .join('\n');
}

export type ConsolidationResult = {
    userId: string;
    weekKey: string;
    topics: number;
    rewritten: number;
    merged: number;
    kept: number;
    skipped?: 'nothing_to_do' | 'guard';
    costUsd?: number;
};

/**
 * Write one topic's new line and supersede what it replaces, atomically. The
 * conditional flip means a row the user edited or deleted meanwhile is left
 * alone and the topic is skipped this week.
 */
async function applyTopic(userId: string, weekKey: string, topic: Topic, text: string): Promise<boolean> {
    const ids = topic.rows.map((row) => row.id);
    try {
        await prisma.$transaction(async (tx) => {
            const flipped = await tx.userMemory.updateMany({
                where: { id: { in: ids }, userId, status: 'active' },
                data: { status: 'superseded' },
            });
            if (flipped.count !== ids.length) throw new Error('changed meanwhile');
            const lastUsed = topic.rows.map((row) => row.lastUsedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
            const created = await tx.userMemory.create({
                data: {
                    userId,
                    key: topic.key,
                    label: topic.label,
                    text,
                    source: 'consolidation',
                    sourceRef: `consolidate:${weekKey}`,
                    // The most private line wins: merging never widens who may see it.
                    sensitivity: topic.rows.some((row) => row.sensitivity === 'private') ? 'private' : 'shareable',
                    useCount: topic.rows.reduce((sum, row) => sum + row.useCount, 0),
                    lastUsedAt: lastUsed ? new Date(lastUsed) : null,
                },
                select: { id: true },
            });
            await tx.userMemory.updateMany({ where: { id: { in: ids } }, data: { supersededById: created.id } });
        });
        return true;
    } catch {
        return false;
    }
}

export async function consolidateMemories(userId: string, opts: { weekKey?: string } = {}): Promise<ConsolidationResult> {
    const weekKey = opts.weekKey ?? weekKeyFor();
    const rows = await prisma.userMemory.findMany({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, key: true, label: true, text: true, source: true, sensitivity: true, useCount: true, lastUsedAt: true, createdAt: true },
    });
    const topics = topicsToConsolidate(rows);
    const base = { userId, weekKey, topics: topics.length, rewritten: 0, merged: 0, kept: 0 };
    if (topics.length === 0) return { ...base, skipped: 'nothing_to_do' };

    const sourceText = topics.flatMap((topic) => topic.rows.map((row) => row.text)).join('\n');
    const result = await generateStructured({
        task: 'memoryConsolidate',
        feature: 'memory',
        userId,
        schema: ConsolidationSchema,
        system: CONSOLIDATION_SYSTEM,
        prompt: `Topics:\n${renderTopics(topics)}`,
        guard: { sourceText, fields: ['items'] },
    });

    // The guard stripped something: keep every original. No partial trust.
    if (result.degraded) {
        return { ...base, kept: topics.length, skipped: 'guard', costUsd: result.usage.costUsd };
    }

    const proposed = new Map<number, string>();
    for (const item of result.data.items) {
        const index = item.index - 1;
        if (index < 0 || index >= topics.length || proposed.has(index)) continue;
        proposed.set(index, item.text.replace(/\s+/g, ' ').trim());
    }

    let rewritten = 0;
    let merged = 0;
    let kept = 0;
    for (const [index, topic] of topics.entries()) {
        const sources = topic.rows.map((row) => row.text);
        const originalWords = sources.reduce((sum, text) => sum + wordCount(text), 0);
        const candidate = proposed.get(index) ?? '';
        const accepted = candidate
            && candidate.length <= MEMORY_TEXT_MAX
            && addsNothing(candidate, sources)
            && wordCount(candidate) <= originalWords
            ? candidate
            : null;

        let text: string | null = null;
        if (accepted && !(topic.rows.length === 1 && accepted === topic.rows[0].text)) text = accepted;
        else if (!accepted && topic.rows.length > 1) text = joinLines(sources);

        if (!text) {
            kept += 1;
            continue;
        }
        if (await applyTopic(userId, weekKey, topic, text)) {
            if (topic.rows.length > 1) merged += 1;
            else rewritten += 1;
        } else {
            kept += 1;
        }
    }

    if (rewritten + merged > 0) await track(userId, 'memory_consolidated', { weekKey, rewritten, merged, kept });
    return { ...base, rewritten, merged, kept, costUsd: result.usage.costUsd };
}
