'use server';

import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeType, type UserProject, type KnowledgeItem, type UserExperience } from '@prisma/client';
import { logUsageEvent, trackedEmbeddingCreate } from '@/lib/usageTracker';

const COLLECTION_NAME = 'knowledge_base';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_SIZE = Number(process.env.OPENAI_EMBEDDING_SIZE || 1536);
const PROJECT_README_EMBED_CHARS = 3500;
const PROJECT_EMBED_MAX_CHARS = 12000;
const EXPERIENCE_EMBED_CHARS = 4000;
const PROJECT_SNIPPET_LIMIT = 10;

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

function toSingleLine(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

function cleanMarkdownForEmbedding(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, '\n ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*[-=]{3,}\s*$/gm, ' ')
    .replace(/^\s*[*>]+\s?/gm, '')
    .replace(/^\s*[-+]\s+\[[ xX]\]\s+/gm, '- ')
    .replace(/^\s*[-+]\s+/gm, '- ')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value.trim());
  }
  return out;
}

function splitSentences(text: string): string[] {
  const normalized = toSingleLine(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
}

function extractSectionHighlights(readme: string): string[] {
  const lines = cleanMarkdownForEmbedding(readme).split('\n');
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } = { heading: 'overview', body: [] };
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    const isHeading = /^[A-Za-z][A-Za-z0-9\s\-_/]{2,60}$/.test(line) && line.split(' ').length <= 8;
    if (isHeading) {
      sections.push(current);
      current = { heading: line.toLowerCase(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  sections.push(current);

  const priorityKeywords = [
    'overview',
    'about',
    'features',
    'feature',
    'architecture',
    'design',
    'performance',
    'impact',
    'results',
    'security',
    'scal',
    'api',
    'workflow',
    'stack',
  ];

  const scored = sections
    .map((section) => {
      const heading = section.heading || 'overview';
      const bodyText = section.body.join(' ');
      const sentence = splitSentences(bodyText)[0] ?? '';
      const headingScore = priorityKeywords.some((keyword) => heading.includes(keyword)) ? 1 : 0;
      const signalScore = /\b(built|developed|implemented|designed|reduced|improved|optimized|scaled|automated)\b/i.test(sentence) ? 1 : 0;
      return { sentence, score: headingScore * 2 + signalScore };
    })
    .filter((entry) => entry.sentence.length >= 24)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.sentence);

  return dedupeStrings(scored).slice(0, 6);
}

function normalizeTechnologyName(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  const aliases: Record<string, string> = {
    js: 'javascript',
    'nodejs': 'node.js',
    'node js': 'node.js',
    ts: 'typescript',
    'golang': 'go',
    'nextjs': 'next.js',
    'reactjs': 'react',
    'postgres': 'postgresql',
    'k8s': 'kubernetes',
  };
  return aliases[normalized] ?? normalized;
}

function inferProjectDomains(projectText: string, technologies: string[]): string[] {
  const corpus = `${projectText} ${technologies.join(' ')}`.toLowerCase();
  const domains: Array<{ label: string; pattern: RegExp }> = [
    { label: 'frontend', pattern: /\b(react|vue|angular|ui|frontend|next\.js|tailwind|css)\b/i },
    { label: 'backend', pattern: /\b(api|backend|server|node\.js|express|fastapi|spring|go)\b/i },
    { label: 'data', pattern: /\b(data|etl|warehouse|analytics|postgres|mysql|redis|elasticsearch)\b/i },
    { label: 'devops', pattern: /\b(docker|kubernetes|terraform|ci\/cd|pipeline|infrastructure|deploy)\b/i },
    { label: 'ai-ml', pattern: /\b(llm|ai|ml|machine learning|embedding|vector|rag|pytorch|tensorflow)\b/i },
    { label: 'blockchain', pattern: /\b(solana|ethereum|web3|smart contract|anchor|dex|defi)\b/i },
    { label: 'mobile', pattern: /\b(android|ios|flutter|react native|mobile)\b/i },
  ];
  return domains.filter((domain) => domain.pattern.test(corpus)).map((domain) => domain.label);
}

function extractHighSignalSnippets(description: string, readme: string): string[] {
  const candidateLines = `${cleanMarkdownForEmbedding(description)}\n${cleanMarkdownForEmbedding(readme)}`
    .split('\n')
    .map((line) => line.trim().replace(/^[\-•]\s*/, ''))
    .filter((line) => line.length >= 28 && line.length <= 260);
  const scored = candidateLines
    .map((line) => {
      let score = 0;
      if (/\b(built|developed|implemented|designed|optimized|scaled|reduced|improved|automated)\b/i.test(line)) score += 2;
      if (/\b(\d+%|\d+x|\d+\s*(ms|sec|s|m|h|users|requests|qps|latency|throughput))\b/i.test(line)) score += 2;
      if (/\b(api|microservice|pipeline|architecture|auth|cache|queue|database|security)\b/i.test(line)) score += 1;
      return { line, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.line);
  return dedupeStrings(scored).slice(0, PROJECT_SNIPPET_LIMIT);
}

function buildProjectEmbeddingText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme' | 'githubUrl' | 'source'>) {
  const rawTechnologies = Array.isArray(project.technologies)
    ? (project.technologies as string[]).map((tech) => tech.trim()).filter(Boolean)
    : [];
  const normalizedTechnologies = dedupeStrings(rawTechnologies.map(normalizeTechnologyName));

  const description = cleanMarkdownForEmbedding(project.description || '');
  const readme = cleanMarkdownForEmbedding((project.readme || '').slice(0, PROJECT_README_EMBED_CHARS));
  const summarySentences = dedupeStrings([
    ...splitSentences(description).slice(0, 2),
    ...splitSentences(readme).slice(0, 2),
  ]).slice(0, 3);

  const sectionHighlights = extractSectionHighlights(readme);
  const highSignalSnippets = extractHighSignalSnippets(description, readme);
  const domainTags = inferProjectDomains(`${description}\n${readme}`, normalizedTechnologies);
  const githubHints = project.githubUrl ? `Repository: ${project.githubUrl}` : '';

  const parts = [
    `Project: ${project.name.trim()}`,
    githubHints,
    normalizedTechnologies.length > 0 ? `Technologies: ${normalizedTechnologies.join(', ')}` : '',
    domainTags.length > 0 ? `Domains: ${domainTags.join(', ')}` : '',
    summarySentences.length > 0 ? `Summary: ${summarySentences.join(' ')}` : '',
    sectionHighlights.length > 0 ? `Section highlights: ${sectionHighlights.join(' | ')}` : '',
    highSignalSnippets.length > 0 ? `Capabilities and outcomes: ${highSignalSnippets.join(' | ')}` : '',
    `Source: ${project.source}`,
    description ? `Description context: ${description.slice(0, 1600)}` : '',
    readme ? `README context: ${readme.slice(0, 4800)}` : '',
  ].filter(Boolean);

  return parts.join('\n').slice(0, PROJECT_EMBED_MAX_CHARS);
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
      embeddingVersion: 2,
      source: params.project.source,
      githubUrl: params.project.githubUrl ?? '',
      technologies: Array.isArray(params.project.technologies) ? (params.project.technologies as string[]) : [],
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
