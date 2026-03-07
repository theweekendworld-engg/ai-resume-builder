'use server';

import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ProjectSource } from '@prisma/client';
import { deleteFromQdrant, generateEmbedding, searchQdrantByVector, upsertProjectEmbedding } from '@/actions/embed';

const ProjectInputSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  url: z.string().max(500).optional(),
  githubUrl: z.string().max(500).optional(),
  technologies: z.array(z.string().max(100)).max(100).optional(),
  readme: z.string().max(20000).optional(),
  source: z.nativeEnum(ProjectSource).optional(),
});

const UpdateProjectSchema = ProjectInputSchema.partial().extend({
  id: z.string().cuid(),
});

const SuggestProjectsForJobSchema = z.object({
  jobDescription: z.string().min(20).max(50000),
  limit: z.number().int().min(1).max(8).default(4),
  excludeProjectUrls: z.array(z.string().max(2000)).max(200).optional(),
});

async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

function normalizeUrl(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export async function listUserProjects(): Promise<{
  success: boolean;
  projects?: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    githubUrl: string | null;
    technologies: string[];
    readme: string;
    source: ProjectSource;
    embedded: boolean;
    updatedAt: Date;
  }>;
  error?: string;
}> {
  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const projects = await prisma.userProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        githubUrl: true,
        technologies: true,
        readme: true,
        source: true,
        embedded: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      projects: projects.map((p) => ({
        ...p,
        technologies: Array.isArray(p.technologies) ? (p.technologies as string[]) : [],
      })),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function createUserProject(input: unknown): Promise<{
  success: boolean;
  projectId?: string;
  warning?: string;
  error?: string;
}> {
  const parsed = ProjectInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const project = await prisma.userProject.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? '',
        url: parsed.data.url ?? '',
        githubUrl: parsed.data.githubUrl || null,
        technologies: parsed.data.technologies ?? [],
        readme: parsed.data.readme ?? '',
        source: parsed.data.source ?? ProjectSource.manual,
      },
      select: {
        id: true,
        name: true,
        description: true,
        technologies: true,
        readme: true,
        qdrantPointId: true,
        createdAt: true,
        githubUrl: true,
        source: true,
      },
    });

    try {
      const embedding = await upsertProjectEmbedding({
        userId,
        project,
        replacePointId: project.qdrantPointId,
      });

      await prisma.userProject.update({
        where: { id: project.id },
        data: {
          qdrantPointId: embedding.pointId,
          embedded: true,
        },
      });
    } catch (embedError: unknown) {
      await prisma.userProject.update({
        where: { id: project.id },
        data: {
          embedded: false,
        },
      });

      return {
        success: true,
        projectId: project.id,
        warning: embedError instanceof Error ? embedError.message : 'Project saved but embedding failed',
      };
    }

    return { success: true, projectId: project.id };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function updateUserProject(input: unknown): Promise<{
  success: boolean;
  warning?: string;
  error?: string;
}> {
  const parsed = UpdateProjectSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const project = await prisma.userProject.findFirst({
      where: { id: parsed.data.id, userId },
      select: {
        id: true,
        qdrantPointId: true,
      },
    });

    if (!project) return { success: false, error: 'Project not found' };

    const { id, ...rest } = parsed.data;

    const updated = await prisma.userProject.update({
      where: { id },
      data: {
        ...rest,
        githubUrl: rest.githubUrl === undefined ? undefined : rest.githubUrl || null,
        technologies: rest.technologies ?? undefined,
        embedded: false,
        qdrantPointId: project.qdrantPointId ?? undefined,
      },
      select: {
        id: true,
        name: true,
        description: true,
        technologies: true,
        readme: true,
        qdrantPointId: true,
        createdAt: true,
        githubUrl: true,
        source: true,
      },
    });

    try {
      const embedding = await upsertProjectEmbedding({
        userId,
        project: updated,
        replacePointId: project.qdrantPointId,
      });

      await prisma.userProject.update({
        where: { id: updated.id },
        data: {
          qdrantPointId: embedding.pointId,
          embedded: true,
        },
      });
    } catch (embedError: unknown) {
      return {
        success: true,
        warning: embedError instanceof Error ? embedError.message : 'Project updated but embedding failed',
      };
    }

    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function deleteUserProject(projectId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const parsedId = z.string().cuid().safeParse(projectId);
  if (!parsedId.success) return { success: false, error: 'Invalid project id' };

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const existing = await prisma.userProject.findFirst({
      where: { id: parsedId.data, userId },
      select: { qdrantPointId: true },
    });

    if (existing?.qdrantPointId) {
      try {
        await deleteFromQdrant(existing.qdrantPointId);
      } catch (error: unknown) {
        console.error('Failed to remove project vector:', error);
      }
    }

    await prisma.userProject.deleteMany({
      where: { id: parsedId.data, userId },
    });

    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function reEmbedUserProject(projectId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const parsedId = z.string().cuid().safeParse(projectId);
  if (!parsedId.success) return { success: false, error: 'Invalid project id' };

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const project = await prisma.userProject.findFirst({
      where: { id: parsedId.data, userId },
      select: {
        id: true,
        name: true,
        description: true,
        technologies: true,
        readme: true,
        qdrantPointId: true,
        createdAt: true,
        githubUrl: true,
        source: true,
      },
    });

    if (!project) return { success: false, error: 'Project not found' };

    const embedding = await upsertProjectEmbedding({
      userId,
      project,
      replacePointId: project.qdrantPointId,
    });

    await prisma.userProject.update({
      where: { id: project.id },
      data: {
        qdrantPointId: embedding.pointId,
        embedded: true,
      },
    });

    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function suggestProjectsForJob(input: unknown): Promise<{
  success: boolean;
  projects?: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    githubUrl: string | null;
    technologies: string[];
    source: ProjectSource;
    relevanceScore: number;
  }>;
  error?: string;
}> {
  const parsed = SuggestProjectsForJobSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  try {
    const userId = await getUserId();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const excluded = new Set(
      (parsed.data.excludeProjectUrls ?? [])
        .map((value) => normalizeUrl(value))
        .filter(Boolean)
    );

    const queryEmbedding = await generateEmbedding({
      userId,
      operation: 'embedding_generate',
      text: parsed.data.jobDescription.slice(0, 12000),
      metadata: {
        reason: 'project_recommendation_query',
        type: 'project',
      },
    });

    const semanticResults = await searchQdrantByVector({
      userId,
      vector: queryEmbedding,
      type: 'project',
      limit: Math.max(parsed.data.limit * 4, 12),
    });

    const scoreByProjectId = new Map<string, number>();
    for (const result of semanticResults) {
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
      if (!sourceId) continue;
      const score = Number(result.score ?? 0);
      const previous = scoreByProjectId.get(sourceId) ?? -1;
      if (score > previous) {
        scoreByProjectId.set(sourceId, score);
      }
    }

    const projectIds = [...scoreByProjectId.keys()];
    if (projectIds.length === 0) {
      return { success: true, projects: [] };
    }

    const projects = await prisma.userProject.findMany({
      where: {
        userId,
        id: { in: projectIds },
      },
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        githubUrl: true,
        technologies: true,
        source: true,
      },
    });

    const ranked = projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        url: project.url,
        githubUrl: project.githubUrl,
        technologies: Array.isArray(project.technologies) ? (project.technologies as string[]) : [],
        source: project.source,
        relevanceScore: Number((scoreByProjectId.get(project.id) ?? 0).toFixed(4)),
      }))
      .filter((project) => {
        const normalizedPrimary = normalizeUrl(project.githubUrl ?? project.url);
        if (normalizedPrimary && excluded.has(normalizedPrimary)) return false;
        if (project.githubUrl) {
          const normalizedGitHub = normalizeUrl(project.githubUrl);
          if (normalizedGitHub && excluded.has(normalizedGitHub)) return false;
        }
        if (project.url) {
          const normalizedUrl = normalizeUrl(project.url);
          if (normalizedUrl && excluded.has(normalizedUrl)) return false;
        }
        return true;
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, parsed.data.limit);

    return { success: true, projects: ranked };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to suggest projects',
    };
  }
}
