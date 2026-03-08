import { z } from 'zod';
import type { KnowledgeItem } from '@prisma/client';
import type { ExperienceItem, ProjectItem } from '@/types/resume';
import { config } from '@/lib/config';
import { trackedChatCompletion } from '@/lib/usageTracker';
import { parseWithRetry } from '@/lib/aiSchemas';
import { toCompactJson } from '@/lib/textUtils';
import {
  normalizeDescription,
  normalizeSummary,
  normalizeSkills,
  MAX_BULLET_WORDS,
  MAX_SUMMARY_WORDS,
} from '@/lib/resumeNormalizer';

const ParaphraseItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().default(''),
});

const LooseParaphraseSchema = z.object({
  summary: z.string().default(''),
  experience: z.array(ParaphraseItemSchema).default([]),
  projects: z.array(ParaphraseItemSchema).default([]),
  skills: z.array(z.string()).default([]),
});

export const ParaphraseSchema = z.object({
  summary: z.string().default(''),
  experience: z.array(z.object({ id: z.string(), description: z.string().default('') })).default([]),
  projects: z.array(z.object({ id: z.string(), description: z.string().default('') })).default([]),
  skills: z.array(z.string()).default([]),
});

const MAX_BULLETS_PER_ITEM = 4;

function formatExperienceContext(experiences: ExperienceItem[], relevanceById: Map<string, number>): string {
  return experiences.map((item) => {
    const relevance = relevanceById.get(item.id) ?? 0;
    return `[Experience:${item.id}] ${item.role} at ${item.company} (${item.startDate} - ${item.current ? 'Present' : item.endDate || 'N/A'}, ${item.location})
Relevance:${relevance.toFixed(2)}
${item.description}`;
  }).join('\n\n');
}

function formatProjectContext(projects: ProjectItem[]): string {
  return projects.map((item) => `[Project:${item.id}] ${item.name}\nTech:${item.technologies.join(', ')}\n${item.description}`).join('\n\n');
}

function formatKnowledgeContext(items: Pick<KnowledgeItem, 'title' | 'content'>[]): string {
  return items.map((item) => `[Knowledge] ${item.title}: ${item.content}`).join('\n');
}

function normalizeBulletedDescription(description: string, fallback: string): string {
  const source = description.trim() ? description : fallback;
  return normalizeDescription(source, MAX_BULLETS_PER_ITEM);
}

export async function paraphraseStaticData(params: {
  parsedJD: unknown;
  targetContext: string;
  baseSummary: string;
  experiences: ExperienceItem[];
  experienceRelevance: Map<string, number>;
  selectedProjects: ProjectItem[];
  selectedKnowledge: Pick<KnowledgeItem, 'title' | 'content'>[];
  tonePreference: 'formal' | 'conversational' | 'technical';
  userId: string;
  sessionId?: string;
}) {
  const prompt = `You are tailoring resume content for a specific job.
Rules:
- Keep facts and metrics truthful.
- Never fabricate tools, achievements, or numbers.
- Use Action + Tech + Impact phrasing for each bullet when source evidence supports it.
- For each experience/project item, output exactly 3-4 concise bullets.
- Each bullet must be a single line and at most ${MAX_BULLET_WORDS} words.
- Include concrete scale/metrics only when present in source evidence.
- Keep summary to 40-${MAX_SUMMARY_WORDS} words, focused on target role and measurable outcomes.
- Prioritize engineering signals: distributed systems, infra, automation, AI/LLM pipelines, developer productivity.
- Output ONLY JSON.

Target context: ${params.targetContext}
Parsed JD: ${toCompactJson(params.parsedJD)}

Current summary:\n${params.baseSummary}

Experiences:\n${formatExperienceContext(params.experiences, params.experienceRelevance)}

Selected projects:\n${formatProjectContext(params.selectedProjects)}

Selected achievements/knowledge:\n${formatKnowledgeContext(params.selectedKnowledge)}

Return JSON with this shape:
{
  "summary": "string",
  "experience": [{"id":"experience-id","description":"string"}],
  "projects": [{"id":"project-id","description":"string"}],
  "skills": ["string"]
}
`;

  const response = await trackedChatCompletion({
    model: config.openai.models.paraphrase,
    messages: [
      {
        role: 'system',
        content: 'You are an expert resume writer focused on ATS optimization.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  }, {
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'paraphrase_experience',
  });

  const content = response.choices[0].message.content ?? '{}';
  const parsed = await parseWithRetry(content, LooseParaphraseSchema);
  if (!parsed.success) {
    throw new Error(`Failed to paraphrase static data: ${parsed.error}`);
  }

  const normalized = {
    summary: normalizeSummary(parsed.data.summary),
    experience: parsed.data.experience
      .map((entry, index) => ({
        id: entry.id?.trim() || params.experiences[index]?.id || '',
        description: normalizeBulletedDescription(entry.description, params.experiences[index]?.description ?? ''),
      }))
      .filter((entry) => entry.id),
    projects: parsed.data.projects
      .map((entry, index) => ({
        id: entry.id?.trim() || params.selectedProjects[index]?.id || '',
        description: normalizeBulletedDescription(entry.description, params.selectedProjects[index]?.description ?? ''),
      }))
      .filter((entry) => entry.id),
    skills: normalizeSkills(parsed.data.skills),
  };

  return ParaphraseSchema.parse(normalized);
}
