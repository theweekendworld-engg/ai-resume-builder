import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, searchQdrantByVector } from '@/actions/embed';
import type { Result } from '@/lib/result';

const UserContextInput = z.object({
  userId: z.string().min(1),
});

const MultiVectorSearchInput = z.object({
  userId: z.string().min(1),
  role: z.string().default(''),
  skillGroups: z.array(
    z.object({
      name: z.string().default(''),
      skills: z.array(z.string()).default([]),
    })
  ).default([]),
  sessionId: z.string().cuid().optional(),
});

export async function loadUserContextTool(input: unknown): Promise<Result<{
  profile: Awaited<ReturnType<typeof prisma.userProfile.findUnique>>;
  experiences: Awaited<ReturnType<typeof prisma.userExperience.findMany>>;
  education: Awaited<ReturnType<typeof prisma.userEducation.findMany>>;
  projects: Awaited<ReturnType<typeof prisma.userProject.findMany>>;
}>> {
  const parsed = UserContextInput.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; '), code: 'INVALID_INPUT' };
  }

  try {
    const [profile, experiences, education, projects] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: parsed.data.userId } }),
      prisma.userExperience.findMany({ where: { userId: parsed.data.userId }, orderBy: { updatedAt: 'desc' } }),
      prisma.userEducation.findMany({ where: { userId: parsed.data.userId }, orderBy: { updatedAt: 'desc' } }),
      prisma.userProject.findMany({ where: { userId: parsed.data.userId }, orderBy: { updatedAt: 'desc' } }),
    ]);

    return { success: true, data: { profile, experiences, education, projects } };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load user context',
      code: 'LOAD_CONTEXT_FAILED',
    };
  }
}

export async function searchProjectsBySkillGroupTool(input: unknown): Promise<Result<Array<{ id: string; score: number }>>> {
  const parsed = MultiVectorSearchInput.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; '), code: 'INVALID_INPUT' };
  }

  const groups = parsed.data.skillGroups.slice(0, 3);
  if (groups.length === 0) {
    return { success: true, data: [] };
  }

  try {
    const vectors = await Promise.all(
      groups.map((group) => generateEmbedding({
        text: `${parsed.data.role}. ${group.skills.join(', ')}`.trim(),
        userId: parsed.data.userId,
        sessionId: parsed.data.sessionId,
        operation: 'embedding_generate',
        metadata: { reason: 'multi_vector_skill_group', group: group.name },
      }))
    );

    const batches = await Promise.all(
      vectors.map((vector) => searchQdrantByVector({
        userId: parsed.data.userId,
        sessionId: parsed.data.sessionId,
        vector,
        type: 'project',
        limit: 6,
      }))
    );

    const dedup = new Map<string, number>();
    for (const batch of batches) {
      for (const item of batch) {
        const payload = (item.payload ?? {}) as Record<string, unknown>;
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!sourceId) continue;
        const score = Number(item.score ?? 0);
        const previous = dedup.get(sourceId) ?? 0;
        if (score > previous) {
          dedup.set(sourceId, score);
        }
      }
    }

    const data = [...dedup.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);

    return { success: true, data };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Multi-vector retrieval failed',
      code: 'MULTI_VECTOR_FAILED',
    };
  }
}
