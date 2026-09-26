/**
 * Section: key takeaways from a knowledge post, saved to the reading shelf.
 *
 * Saved as `SavedInsight` and NEVER as `KnowledgeItem`. `KnowledgeItem` feeds
 * resume generation as the user's own evidence; someone else's post about
 * scaling Kafka is not something the user did, and writing it there would let
 * it surface as a claim on their resume. The test beside this file asserts it.
 *
 * Takeaways go through the numeric guard against the post text: a digest
 * that says "cut latency 40%" when the post said "cut latency a lot" is a
 * fabricated figure with our name on it.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { ScoutSection } from '@/lib/scout/section';
import { dataOf } from '@/lib/scout/section';

export const DIGEST_TEXT_CAP = 12_000;

const DigestSchema = z.object({
    title: z.string().min(1).max(160),
    takeaways: z.array(z.string().min(1).max(280)).min(1).max(6),
    tags: z.array(z.string().min(1).max(40)).max(6),
});

const SYSTEM = `You summarise one LinkedIn post for a busy job seeker who saved it to read later. Return JSON only.

title: a short plain title for the post (not clickbait, no emoji).
takeaways: 3 to 6 concrete, standalone points the reader can act on or remember. Use only what the post says. Never add a number, percentage, date or name the post does not contain. If the post has fewer real points, return fewer.
tags: 2 to 5 lowercase topic tags, e.g. "system design", "interviewing", "negotiation".`;

function normalizeTags(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of tags) {
        const clean = tag.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        out.push(clean);
    }
    return out.slice(0, 5);
}

export const digestSection: ScoutSection<'digest'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    if (!ingest) return { status: 'unavailable', reason: 'Nothing was read from the post.' };

    const text = ingest.text.slice(0, DIGEST_TEXT_CAP);
    const { data, degraded } = await ctx.step.ai({
        task: 'scoutDigest',
        feature: 'scout',
        schema: DigestSchema,
        system: SYSTEM,
        prompt: [
            ingest.author ? `Author: ${ingest.author}` : null,
            ingest.title ? `Title: ${ingest.title}` : null,
            `Post:\n"""\n${text}\n"""`,
        ].filter(Boolean).join('\n'),
        guard: { sourceText: `${ingest.title ?? ''}\n${text}`, fields: ['title', 'takeaways'] },
    });

    // The guard may strip a takeaway it could not keep honest.
    const takeaways = data.takeaways.map((entry) => entry.trim()).filter(Boolean);
    if (takeaways.length === 0) {
        return { status: 'unavailable', reason: 'The post did not have takeaways we could state without inventing detail.' };
    }
    const tags = normalizeTags(data.tags);
    const title = data.title.trim() || ingest.title || 'Saved post';

    const saved = await prisma.savedInsight.upsert({
        where: { runId: ctx.runId },
        create: {
            userId: ctx.userId,
            runId: ctx.runId,
            url: ingest.sourceUrl,
            author: ingest.author,
            title,
            takeaways,
            tags,
        },
        update: { url: ingest.sourceUrl, author: ingest.author, title, takeaways, tags },
    });

    if (degraded) ctx.step.log('digest degraded by guard', { runId: ctx.runId });
    return { status: 'ok', data: { title, takeaways, tags, savedInsightId: saved.id } };
};
