'use server';

import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { KnowledgeType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkKbRateLimit } from '@/lib/rateLimit';
import {
  deleteFromQdrant,
  searchQdrantByUser,
  upsertKnowledgeItemEmbedding,
} from '@/actions/embed';
import { extractKeywords } from '@/actions/ai';

const MAX_CONTENT_LENGTH = 5000;
const MAX_QUERY_LENGTH = 1000;
const MAX_TAGS = 10;

const SaveKbSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  type: z.string().min(1).max(100),
  tags: z.array(z.string().max(100)).max(MAX_TAGS),
});

const SearchKbSchema = z.string().min(1).max(MAX_QUERY_LENGTH);

const CreateKnowledgeItemSchema = z.object({
  type: z.nativeEnum(KnowledgeType),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateKnowledgeItemSchema = CreateKnowledgeItemSchema.partial().extend({
  id: z.string().cuid(),
});

function sanitizeTags(tags: string[]): string[] {
  return tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function normalizeKnowledgeType(type: string): KnowledgeType {
  const normalized = type.trim().toLowerCase();
  if (Object.values(KnowledgeType).includes(normalized as KnowledgeType)) {
    return normalized as KnowledgeType;
  }
  return KnowledgeType.custom;
}

function deriveTitle(content: string, fallbackType: string) {
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 120);
  return fallbackType.slice(0, 80);
}

async function getUserId() {
  const { userId } = await auth();
  return userId ?? null;
}

export async function saveToKnowledgeBase(content: string, type: string, tags: string[]) {
  const parsed = SaveKbSchema.safeParse({
    content: typeof content === 'string' ? content.trim() : '',
    type: typeof type === 'string' ? type.trim() : '',
    tags: Array.isArray(tags) ? tags : [],
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const limit = await checkKbRateLimit(`kb:save:${userId}`);
  if (!limit.allowed) return { success: false, error: limit.error };

  try {
    const safeTags = sanitizeTags(parsed.data.tags);
    const knowledgeType = normalizeKnowledgeType(parsed.data.type);

    const item = await prisma.knowledgeItem.create({
      data: {
        userId,
        type: knowledgeType,
        title: deriveTitle(parsed.data.content, parsed.data.type),
        content: parsed.data.content,
        metadata: {
          tags: safeTags,
          originalType: parsed.data.type,
        },
      },
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        metadata: true,
        qdrantPointId: true,
        createdAt: true,
      },
    });

    try {
      const embedding = await upsertKnowledgeItemEmbedding({
        userId,
        item,
        replacePointId: item.qdrantPointId,
      });

      await prisma.knowledgeItem.update({
        where: { id: item.id },
        data: {
          qdrantPointId: embedding.pointId,
          embedded: true,
        },
      });
    } catch (embedError: unknown) {
      await prisma.knowledgeItem.update({
        where: { id: item.id },
        data: { embedded: false },
      });

      return {
        success: true,
        warning: embedError instanceof Error ? embedError.message : 'Saved but embedding failed',
      };
    }

    return { success: true };
  } catch (error: unknown) {
    console.error('KB Save Error:', error);
    return { success: false, error: 'Failed to save to KB' };
  }
}

export async function searchKnowledgeBase(query: string) {
  const parsed = SearchKbSchema.safeParse(typeof query === 'string' ? query.trim() : '');
  if (!parsed.success) return [];

  const userId = await getUserId();
  if (!userId) return [];

  const limit = await checkKbRateLimit(`kb:search:${userId}`);
  if (!limit.allowed) return [];

  let optimizedQuery = parsed.data;
  if (optimizedQuery.length > 100) {
    const keywords = await extractKeywords(optimizedQuery);
    if (keywords.length > 0) {
      optimizedQuery = keywords.join(' ');
      console.log('Optimized KB search query:', optimizedQuery);
    }
  }

  try {
    const searchResult = await searchQdrantByUser({
      userId,
      query: optimizedQuery,
      limit: 5,
    });

    return searchResult.map((result) => {
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const metadata = typeof payload.metadata === 'object' && payload.metadata ? (payload.metadata as Record<string, unknown>) : {};
      const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : [];

      return {
        id: result.id,
        content: payload.content,
        type: payload.type,
        tags,
        sourceId: payload.sourceId,
        score: result.score,
      };
    });
  } catch (error: unknown) {
    console.error('KB Search Error:', error);
    return [];
  }
}

export async function listKnowledgeItems() {
  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const items = await prisma.knowledgeItem.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });

  return { success: true, items };
}

export async function createKnowledgeItem(input: unknown) {
  const parsed = CreateKnowledgeItemSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const item = await prisma.knowledgeItem.create({
    data: {
      userId,
      type: parsed.data.type,
      title: parsed.data.title,
      content: parsed.data.content,
      metadata: parsed.data.metadata as Prisma.InputJsonValue | undefined,
    },
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      metadata: true,
      qdrantPointId: true,
      createdAt: true,
    },
  });

  try {
    const embedding = await upsertKnowledgeItemEmbedding({
      userId,
      item,
      replacePointId: item.qdrantPointId,
    });

    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        qdrantPointId: embedding.pointId,
        embedded: true,
      },
    });

    return { success: true, id: item.id };
  } catch (error: unknown) {
    return {
      success: true,
      id: item.id,
      warning: error instanceof Error ? error.message : 'Knowledge item saved but embedding failed',
    };
  }
}

export async function updateKnowledgeItem(input: unknown) {
  const parsed = UpdateKnowledgeItemSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const existing = await prisma.knowledgeItem.findFirst({
    where: { id: parsed.data.id, userId },
    select: {
      id: true,
      qdrantPointId: true,
      createdAt: true,
      type: true,
      title: true,
      content: true,
      metadata: true,
    },
  });

  if (!existing) return { success: false, error: 'Knowledge item not found' };

  const updated = await prisma.knowledgeItem.update({
    where: { id: existing.id },
    data: {
      type: parsed.data.type ?? undefined,
      title: parsed.data.title ?? undefined,
      content: parsed.data.content ?? undefined,
      metadata: (parsed.data.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      embedded: false,
    },
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      metadata: true,
      qdrantPointId: true,
      createdAt: true,
    },
  });

  try {
    const embedding = await upsertKnowledgeItemEmbedding({
      userId,
      item: updated,
      replacePointId: existing.qdrantPointId,
    });

    await prisma.knowledgeItem.update({
      where: { id: updated.id },
      data: {
        qdrantPointId: embedding.pointId,
        embedded: true,
      },
    });
  } catch (embedError: unknown) {
    return {
      success: true,
      warning: embedError instanceof Error ? embedError.message : 'Knowledge item updated but embedding failed',
    };
  }

  return { success: true };
}

export async function deleteKnowledgeItem(id: string) {
  const parsedId = z.string().cuid().safeParse(id);
  if (!parsedId.success) return { success: false, error: 'Invalid knowledge item id' };

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const existing = await prisma.knowledgeItem.findFirst({
    where: { id: parsedId.data, userId },
    select: { qdrantPointId: true },
  });

  if (existing?.qdrantPointId) {
    try {
      await deleteFromQdrant(existing.qdrantPointId);
    } catch (error: unknown) {
      console.error('Failed to remove knowledge vector:', error);
    }
  }

  await prisma.knowledgeItem.deleteMany({ where: { id: parsedId.data, userId } });
  return { success: true };
}

export async function reEmbedKnowledgeItem(id: string) {
  const parsedId = z.string().cuid().safeParse(id);
  if (!parsedId.success) return { success: false, error: 'Invalid knowledge item id' };

  const userId = await getUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const item = await prisma.knowledgeItem.findFirst({
    where: { id: parsedId.data, userId },
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      metadata: true,
      qdrantPointId: true,
      createdAt: true,
    },
  });

  if (!item) return { success: false, error: 'Knowledge item not found' };

  const embedding = await upsertKnowledgeItemEmbedding({
    userId,
    item,
    replacePointId: item.qdrantPointId,
  });

  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: {
      qdrantPointId: embedding.pointId,
      embedded: true,
    },
  });

  return { success: true };
}
