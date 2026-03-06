'use server';

import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeType, type UserProject, type KnowledgeItem, type UserExperience } from '@prisma/client';
import { logUsageEvent, trackedEmbeddingCreate } from '@/lib/usageTracker';

const COLLECTION_NAME = 'knowledge_base';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_SIZE = Number(process.env.OPENAI_EMBEDDING_SIZE || 1536);
const PROJECT_README_EMBED_CHARS = 1200;
const EXPERIENCE_EMBED_CHARS = 4000;

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});

let collectionEnsured = false;

export async function ensureKnowledgeBaseCollection() {
  if (collectionEnsured) return;

  const collections = await qdrantClient.getCollections();
  const exists = collections.collections.some((collection) => collection.name === COLLECTION_NAME);

  if (!exists) {
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: {
        size: EMBEDDING_SIZE,
        distance: 'Cosine',
      },
    });
  }

  collectionEnsured = true;
}

export async function generateEmbedding(params: {
  text: string;
  userId: string;
  sessionId?: string;
  operation: string;
  metadata?: Record<string, unknown>;
}): Promise<number[]> {
  const text = params.text;
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Embedding input cannot be empty');
  }

  const response = await trackedEmbeddingCreate(
    {
      model: EMBEDDING_MODEL,
      input: trimmed,
    },
    {
      userId: params.userId,
      sessionId: params.sessionId,
      operation: params.operation,
      metadata: params.metadata,
    }
  );

  return response.data[0].embedding;
}

export async function deleteFromQdrant(pointId: string) {
  if (!pointId) return;

  await ensureKnowledgeBaseCollection();
  await qdrantClient.delete(COLLECTION_NAME, {
    wait: true,
    points: [pointId],
  });
}

export async function upsertToQdrant(params: {
  pointId?: string | null;
  vector: number[];
  payload: Record<string, unknown>;
}): Promise<string> {
  await ensureKnowledgeBaseCollection();

  const pointId = params.pointId || uuidv4();
  await qdrantClient.upsert(COLLECTION_NAME, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: params.vector,
        payload: params.payload,
      },
    ],
  });

  return pointId;
}

function deriveImpactSummary(project: Pick<UserProject, 'name' | 'description' | 'readme'>): string {
  const source = `${project.description} ${project.readme}`.trim();
  const sentence = source.split(/[.!?]\s+/).find((line) => line.trim().length > 20) || '';
  if (!sentence) return '';
  return `Impact summary: ${sentence.trim().slice(0, 240)}`;
}

function buildProjectEmbeddingText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme' | 'githubUrl' | 'source'>) {
  const technologies = Array.isArray(project.technologies)
    ? (project.technologies as string[])
    : [];
  const primaryLanguage = technologies[0] ?? '';
  const impactSummary = deriveImpactSummary(project);
  const githubHints = project.githubUrl ? `GitHub: ${project.githubUrl}` : '';

  return [
    project.name,
    project.description,
    technologies.length > 0 ? `Technologies: ${technologies.join(', ')}` : '',
    primaryLanguage ? `Primary language: ${primaryLanguage}` : '',
    githubHints,
    impactSummary,
    project.readme?.slice(0, PROJECT_README_EMBED_CHARS) || '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 8000);
}

function buildExperienceEmbeddingText(experience: Pick<UserExperience, 'role' | 'company' | 'description' | 'highlights'>) {
  const highlights = Array.isArray(experience.highlights) ? (experience.highlights as string[]) : [];
  return [
    `${experience.role} at ${experience.company}`,
    experience.description,
    highlights.length > 0 ? `Highlights: ${highlights.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, EXPERIENCE_EMBED_CHARS);
}

function buildKnowledgeEmbeddingText(item: Pick<KnowledgeItem, 'type' | 'title' | 'content' | 'metadata'>) {
  const metadata = typeof item.metadata === 'object' && item.metadata ? (item.metadata as Record<string, unknown>) : {};
  const repo = typeof metadata.repo === 'string' ? metadata.repo : '';

  if (item.type === KnowledgeType.oss_contribution) {
    return `${item.title}. ${item.content}. ${repo}`.slice(0, 8000);
  }

  return `${item.title}: ${item.content}`.slice(0, 8000);
}

export async function upsertProjectEmbedding(params: {
  userId: string;
  sessionId?: string;
  project: Pick<UserProject, 'id' | 'name' | 'description' | 'technologies' | 'readme' | 'qdrantPointId' | 'createdAt' | 'githubUrl' | 'source'>;
  replacePointId?: string | null;
}) {
  const content = buildProjectEmbeddingText(params.project);
  const vector = await generateEmbedding({
    text: content,
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'embedding_generate',
    metadata: { itemType: 'project', sourceId: params.project.id },
  });

  if (params.replacePointId) {
    await deleteFromQdrant(params.replacePointId);
  }

  const pointId = await upsertToQdrant({
    vector,
    payload: {
      userId: params.userId,
      type: 'project',
      sourceId: params.project.id,
      title: params.project.name,
      content,
      createdAt: params.project.createdAt.toISOString(),
    },
  });

  return { pointId, content };
}

export async function upsertExperienceEmbedding(params: {
  userId: string;
  sessionId?: string;
  experience: Pick<UserExperience, 'id' | 'role' | 'company' | 'description' | 'highlights' | 'createdAt'>;
}) {
  const content = buildExperienceEmbeddingText(params.experience);
  const vector = await generateEmbedding({
    text: content,
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'embedding_generate',
    metadata: { itemType: 'experience', sourceId: params.experience.id },
  });

  const pointId = await upsertToQdrant({
    pointId: `experience:${params.experience.id}`,
    vector,
    payload: {
      userId: params.userId,
      type: 'experience',
      sourceId: params.experience.id,
      title: `${params.experience.role} @ ${params.experience.company}`,
      content,
      createdAt: params.experience.createdAt.toISOString(),
    },
  });

  return { pointId, content };
}

export async function deleteExperienceEmbedding(experienceId: string) {
  if (!experienceId) return;
  await deleteFromQdrant(`experience:${experienceId}`);
}

export async function upsertKnowledgeItemEmbedding(params: {
  userId: string;
  sessionId?: string;
  item: Pick<KnowledgeItem, 'id' | 'type' | 'title' | 'content' | 'metadata' | 'qdrantPointId' | 'createdAt'>;
  replacePointId?: string | null;
}) {
  const content = buildKnowledgeEmbeddingText(params.item);
  const vector = await generateEmbedding({
    text: content,
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'embedding_generate',
    metadata: { itemType: params.item.type, sourceId: params.item.id },
  });

  if (params.replacePointId) {
    await deleteFromQdrant(params.replacePointId);
  }

  const pointId = await upsertToQdrant({
    vector,
    payload: {
      userId: params.userId,
      type: params.item.type,
      sourceId: params.item.id,
      title: params.item.title,
      content,
      createdAt: params.item.createdAt.toISOString(),
    },
  });

  return { pointId, content };
}

export async function searchQdrantByUser(params: {
  userId: string;
  query: string;
  limit?: number;
  type?: string;
  sessionId?: string;
}) {
  const vector = await generateEmbedding({
    text: params.query,
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'embedding_generate',
    metadata: {
      reason: 'semantic_search_query',
      type: params.type ?? 'all',
    },
  });

  return searchQdrantByVector({
    userId: params.userId,
    vector,
    limit: params.limit,
    type: params.type,
    sessionId: params.sessionId,
  });
}

export async function searchQdrantByVector(params: {
  userId: string;
  vector: number[];
  limit?: number;
  type?: string;
  sessionId?: string;
}) {
  await ensureKnowledgeBaseCollection();

  const must: Array<Record<string, unknown>> = [
    {
      key: 'userId',
      match: { value: params.userId },
    },
  ];

  if (params.type) {
    must.push({
      key: 'type',
      match: { value: params.type },
    });
  }

  const start = Date.now();
  try {
    const result = await qdrantClient.search(COLLECTION_NAME, {
      vector: params.vector,
      limit: params.limit ?? 5,
      filter: { must },
    });

    await logUsageEvent({
      userId: params.userId,
      sessionId: params.sessionId,
      operation: 'semantic_search',
      provider: 'qdrant',
      model: 'cosine-vector-search',
      latencyMs: Date.now() - start,
      status: 'success',
      metadata: {
        type: params.type ?? 'all',
        resultCount: result.length,
      },
    });

    return result;
  } catch (error: unknown) {
    await logUsageEvent({
      userId: params.userId,
      sessionId: params.sessionId,
      operation: 'semantic_search',
      provider: 'qdrant',
      model: 'cosine-vector-search',
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        type: params.type ?? 'all',
        error: error instanceof Error ? error.message : 'Qdrant search failed',
      },
    });
    throw error;
  }
}
