/**
 * Re-embed one profile row (project, experience or knowledge item) whose
 * vector is missing from the store.
 *
 * These rows are embedded inline by the action that saves them, so until now
 * nothing repaired one whose vector was lost: a save made while the store was
 * down, or the whole collection when production moved from Qdrant Cloud to
 * pgvector (2026-09-27). A missing vector does not error; the item just never
 * surfaces in semantic search, and the resume is quietly worse than the
 * record. The reconcile sweep finds them and enqueues one job each.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { buildDedupeKey } from '@/lib/jobs/runner';
import {
    upsertExperienceEmbedding,
    upsertKnowledgeItemEmbedding,
    upsertProjectEmbedding,
} from '@/lib/embeddings';
import type { JobHandler, JobResultObject } from '@/lib/jobs/types';

export const EMBED_PROFILE_ITEM_JOB_KIND = 'embed_profile_item' as const;

export const PROFILE_ITEM_KINDS = ['project', 'experience', 'knowledge'] as const;
export type ProfileItemKind = (typeof PROFILE_ITEM_KINDS)[number];

const PayloadSchema = z.object({
    kind: z.enum(PROFILE_ITEM_KINDS),
    id: z.string().min(1),
});

/** One repair per row per day: a daily sweep may retry, a double-fired one may not. */
export function embedProfileItemDedupeKey(kind: ProfileItemKind, id: string, day: string): string {
    return buildDedupeKey('embed-profile', [kind, id, day]);
}

export const embedProfileItemHandler: JobHandler = async (payload, ctx): Promise<JobResultObject> => {
    const parsed = PayloadSchema.safeParse(payload ?? {});
    if (!parsed.success) return { embedded: false, reason: 'bad_payload' };
    const { kind, id } = parsed.data;

    if (kind === 'project') {
        const project = await prisma.userProject.findUnique({
            where: { id },
            select: {
                id: true, userId: true, name: true, description: true, technologies: true, readme: true,
                qdrantPointId: true, createdAt: true, githubUrl: true, source: true,
            },
        });
        if (!project) return { embedded: false, reason: 'missing' };
        const { pointId } = await upsertProjectEmbedding({
            userId: project.userId,
            project,
            replacePointId: project.qdrantPointId,
        });
        await prisma.userProject.update({ where: { id }, data: { qdrantPointId: pointId, embedded: true } });
        ctx.log('embed_profile_item: ok', { kind, id });
        return { embedded: true, kind, pointId };
    }

    if (kind === 'experience') {
        const experience = await prisma.userExperience.findUnique({
            where: { id },
            select: {
                id: true, userId: true, role: true, company: true, description: true, highlights: true,
                createdAt: true, qdrantPointId: true,
            },
        });
        if (!experience) return { embedded: false, reason: 'missing' };
        const { pointId } = await upsertExperienceEmbedding({ userId: experience.userId, experience });
        await prisma.userExperience.update({ where: { id }, data: { qdrantPointId: pointId, embedded: true } });
        ctx.log('embed_profile_item: ok', { kind, id });
        return { embedded: true, kind, pointId };
    }

    const item = await prisma.knowledgeItem.findUnique({
        where: { id },
        select: {
            id: true, userId: true, type: true, title: true, content: true, metadata: true,
            qdrantPointId: true, createdAt: true,
        },
    });
    if (!item) return { embedded: false, reason: 'missing' };
    const { pointId } = await upsertKnowledgeItemEmbedding({
        userId: item.userId,
        item,
        replacePointId: item.qdrantPointId,
    });
    await prisma.knowledgeItem.update({ where: { id }, data: { qdrantPointId: pointId, embedded: true } });
    ctx.log('embed_profile_item: ok', { kind, id });
    return { embedded: true, kind, pointId };
};
