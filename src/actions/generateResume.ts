'use server';

import { auth } from '@clerk/nextjs/server';
import { KnowledgeType, type KnowledgeItem, type UserProject } from '@prisma/client';
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { z } from 'zod';
import { searchQdrantByUser } from '@/actions/embed';
import { parseWithRetry, ResumeDataSchema } from '@/lib/aiSchemas';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { initialResumeData, type ResumeData, type ExperienceItem, type ProjectItem } from '@/types/resume';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const ParsedJDSchema = z.object({
  role: z.string().default(''),
  company: z.string().default(''),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  experienceLevel: z.string().default(''),
  keyResponsibilities: z.array(z.string()).default([]),
  industryDomain: z.string().default(''),
});

const ParaphraseSchema = z.object({
  summary: z.string().default(''),
  experience: z.array(z.object({ id: z.string(), description: z.string().default('') })).default([]),
  skills: z.array(z.string()).default([]),
});

const SmartGenerateOptionsSchema = z.object({
  templatePreference: z.enum(['ats-simple', 'modern', 'classic']).optional(),
  maxProjects: z.number().int().min(1).max(6).optional(),
  focusAreas: z.array(z.string().max(100)).max(20).optional(),
  fallbackResumeData: ResumeDataSchema.optional(),
});

const jdCache = new Map<string, z.infer<typeof ParsedJDSchema>>();

type SourceMap = {
  projects: { id: string; score: number }[];
  knowledgeItems: { id: string; score: number }[];
  parsedJD: z.infer<typeof ParsedJDSchema>;
};

type ClaimValidation = {
  valid: boolean;
  coverageRate: number;
  unsupportedClaims: string[];
  mappings: Record<string, string>;
};

type SmartResumeResult = {
  resume: ResumeData;
  sources: SourceMap;
  atsEstimate: number;
  validation: ClaimValidation;
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getProjectText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme'>): string {
  const technologies = Array.isArray(project.technologies) ? (project.technologies as string[]) : [];
  return [project.name, project.description, technologies.join(' '), project.readme.slice(0, 1200)].join(' ').trim();
}

function getKnowledgeText(item: Pick<KnowledgeItem, 'title' | 'content'>): string {
  return `${item.title} ${item.content}`.trim();
}

function buildExperienceDescription(item: { description: string; highlights: unknown }): string {
  const highlights = Array.isArray(item.highlights) ? (item.highlights as string[]) : [];
  const cleanedHighlights = highlights.map((line) => line.trim()).filter(Boolean).map((line) => (line.startsWith('•') ? line : `• ${line}`));

  const baseDescription = (item.description || '').trim();
  if (!baseDescription) return cleanedHighlights.join('\n');
  if (cleanedHighlights.length === 0) return baseDescription;

  return `${baseDescription}\n${cleanedHighlights.join('\n')}`.trim();
}

function scoreProject(params: {
  project: UserProject;
  semanticScore: number;
  jdSkills: string[];
}): number {
  const semantic = Math.max(0, Math.min(1, params.semanticScore));
  const projectText = getProjectText(params.project);
  const normalizedProjectText = normalizeText(projectText);

  const skillHits = params.jdSkills.filter((skill) => normalizedProjectText.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;

  const ageMs = Date.now() - params.project.updatedAt.getTime();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const recency = Math.max(0, 1 - ageMs / (3 * oneYear));

  return (semantic * 0.65) + (skillCoverage * 0.25) + (recency * 0.1);
}

function scoreKnowledge(params: {
  item: KnowledgeItem;
  semanticScore: number;
  jdSkills: string[];
}): number {
  const semantic = Math.max(0, Math.min(1, params.semanticScore));
  const text = normalizeText(getKnowledgeText(params.item));
  const skillHits = params.jdSkills.filter((skill) => text.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;
  const quantifiedBonus = /\d/.test(params.item.content) ? 0.1 : 0;

  return (semantic * 0.75) + (skillCoverage * 0.15) + quantifiedBonus;
}

async function parseJobDescription(jobDescription: string): Promise<z.infer<typeof ParsedJDSchema>> {
  const hash = createHash('sha256').update(jobDescription.trim()).digest('hex');
  const cached = jdCache.get(hash);
  if (cached) return cached;

  const prompt = `Parse the job description into structured JSON.
Return ONLY JSON with keys:
role, company, requiredSkills, preferredSkills, experienceLevel, keyResponsibilities, industryDomain.
If missing, use empty strings/arrays.

JOB DESCRIPTION:\n${jobDescription}`;

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content ?? '{}';
  const parsed = await parseWithRetry(content, ParsedJDSchema);
  if (!parsed.success) {
    throw new Error(`Failed to parse JD: ${parsed.error}`);
  }

  jdCache.set(hash, parsed.data);
  return parsed.data;
}

function toResumeProject(project: UserProject): ProjectItem {
  return {
    id: project.id,
    name: project.name,
    description: project.description || project.readme.slice(0, 400),
    url: project.url || project.githubUrl || '',
    technologies: Array.isArray(project.technologies) ? (project.technologies as string[]) : [],
  };
}

function computeAtsEstimate(resume: ResumeData, parsedJD: z.infer<typeof ParsedJDSchema>): number {
  const jdTerms = uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills]).map(normalizeText);
  if (jdTerms.length === 0) return 70;

  const resumeText = normalizeText(JSON.stringify(resume));
  const matches = jdTerms.filter((term) => term && resumeText.includes(term)).length;
  const score = Math.round((matches / jdTerms.length) * 100);
  return Math.max(40, Math.min(95, score));
}

function validateClaims(resume: ResumeData, sources: Array<{ id: string; text: string }>): ClaimValidation {
  const sourceTokens = sources.map((source) => ({
    id: source.id,
    tokens: new Set(tokenize(source.text)),
  }));

  const claimLines: string[] = [];
  for (const exp of resume.experience) {
    const lines = exp.description.split('\n').map((line) => line.trim()).filter(Boolean);
    claimLines.push(...lines);
  }
  for (const project of resume.projects) {
    if (project.description.trim()) claimLines.push(project.description.trim());
  }

  const mappings: Record<string, string> = {};
  const unsupportedClaims: string[] = [];

  for (const line of claimLines) {
    const claimTokens = tokenize(line);
    if (claimTokens.length < 3) {
      mappings[line] = 'short-claim';
      continue;
    }

    let bestSourceId = '';
    let bestOverlap = 0;

    for (const source of sourceTokens) {
      let overlap = 0;
      for (const token of claimTokens) {
        if (source.tokens.has(token)) overlap += 1;
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSourceId = source.id;
      }
    }

    const coverage = bestOverlap / claimTokens.length;
    if (coverage >= 0.22 && bestOverlap >= 3) {
      mappings[line] = bestSourceId;
    } else {
      unsupportedClaims.push(line);
    }
  }

  const supported = claimLines.length - unsupportedClaims.length;
  const coverageRate = claimLines.length > 0 ? supported / claimLines.length : 1;

  return {
    valid: unsupportedClaims.length === 0,
    coverageRate,
    unsupportedClaims,
    mappings,
  };
}

function sanitizeUnsupportedClaims(resume: ResumeData, unsupportedClaims: string[]): ResumeData {
  if (unsupportedClaims.length === 0) return resume;
  const bad = new Set(unsupportedClaims.map((claim) => claim.trim()));

  return {
    ...resume,
    experience: resume.experience.map((exp) => {
      const filtered = exp.description
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !bad.has(line));

      return {
        ...exp,
        description: filtered.join('\n') || exp.description,
      };
    }),
    projects: resume.projects.map((project) => ({
      ...project,
      description: bad.has(project.description.trim()) ? '' : project.description,
    })),
  };
}

async function paraphraseStaticData(params: {
  jobDescription: string;
  parsedJD: z.infer<typeof ParsedJDSchema>;
  baseSummary: string;
  experiences: ExperienceItem[];
  selectedProjects: ProjectItem[];
  selectedKnowledge: Pick<KnowledgeItem, 'title' | 'content'>[];
}): Promise<z.infer<typeof ParaphraseSchema>> {
  const prompt = `You are tailoring resume content for a specific job.
Rules:
- Keep facts, metrics, companies, and dates truthful to source data.
- Do not invent numbers, tools, projects, or achievements.
- Only rewrite wording and ordering to emphasize relevance.
- Output ONLY JSON.

Parsed JD:\n${JSON.stringify(params.parsedJD, null, 2)}

Raw JD:\n${params.jobDescription}

Current summary:\n${params.baseSummary}

Experiences:\n${JSON.stringify(params.experiences, null, 2)}

Selected projects:\n${JSON.stringify(params.selectedProjects, null, 2)}

Selected achievements/knowledge:\n${JSON.stringify(params.selectedKnowledge, null, 2)}

Return JSON as:
{
  "summary": "string",
  "experience": [{"id": "experience-id", "description": "rewritten bullet text"}],
  "skills": ["ordered", "skills", "for", "this", "JD"]
}`;

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content ?? '{}';
  const parsed = await parseWithRetry(content, ParaphraseSchema);
  if (!parsed.success) {
    throw new Error(`Failed to paraphrase static data: ${parsed.error}`);
  }

  return parsed.data;
}

function buildBaseResume(params: {
  fallback: ResumeData;
  profile: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    defaultTitle: string;
    defaultSummary: string;
  } | null;
  experiences: ExperienceItem[];
  education: ResumeData['education'];
  projects: ProjectItem[];
  skills: string[];
  jdRole: string;
  parsedSummary: string;
}): ResumeData {
  const fallbackInfo = params.fallback.personalInfo;

  return {
    personalInfo: {
      fullName: params.profile?.fullName || fallbackInfo.fullName,
      title: params.jdRole || params.profile?.defaultTitle || fallbackInfo.title,
      email: params.profile?.email || fallbackInfo.email,
      phone: params.profile?.phone || fallbackInfo.phone,
      location: params.profile?.location || fallbackInfo.location,
      website: params.profile?.website || fallbackInfo.website,
      linkedin: params.profile?.linkedin || fallbackInfo.linkedin,
      github: params.profile?.github || fallbackInfo.github,
      summary: params.parsedSummary || params.profile?.defaultSummary || fallbackInfo.summary,
    },
    experience: params.experiences.length > 0 ? params.experiences : params.fallback.experience,
    projects: params.projects.length > 0 ? params.projects : params.fallback.projects,
    education: params.education.length > 0 ? params.education : params.fallback.education,
    skills: params.skills.length > 0 ? params.skills : params.fallback.skills,
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
  };
}

export async function generateSmartResume(
  jobDescription: string,
  options?: {
    templatePreference?: 'ats-simple' | 'modern' | 'classic';
    maxProjects?: number;
    focusAreas?: string[];
    fallbackResumeData?: ResumeData;
  }
): Promise<SmartResumeResult> {
  const trimmedJobDescription = jobDescription?.trim();
  if (!trimmedJobDescription) {
    throw new Error('Job description is required');
  }

  const parsedOptions = SmartGenerateOptionsSchema.parse(options ?? {});
  const fallback = parsedOptions.fallbackResumeData ?? structuredClone(initialResumeData);

  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }

  const parsedJD = await parseJobDescription(trimmedJobDescription);
  const jdSkills = uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills, ...(parsedOptions.focusAreas ?? [])]);

  const knowledgeTypes: KnowledgeType[] = [
    KnowledgeType.achievement,
    KnowledgeType.oss_contribution,
    KnowledgeType.certification,
    KnowledgeType.award,
    KnowledgeType.publication,
    KnowledgeType.custom,
  ];

  const [projectSearch, ...knowledgeSearches] = await Promise.all([
    searchQdrantByUser({ userId, query: trimmedJobDescription, type: 'project', limit: 10 }),
    ...knowledgeTypes.map((type) => searchQdrantByUser({ userId, query: trimmedJobDescription, type, limit: 4 })),
  ]);

  const projectScores = new Map<string, number>();
  const projectIds: string[] = [];
  for (const result of projectSearch) {
    const payload = (result.payload ?? {}) as Record<string, unknown>;
    const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
    if (!sourceId || projectScores.has(sourceId)) continue;
    projectScores.set(sourceId, Number(result.score ?? 0));
    projectIds.push(sourceId);
  }

  const knowledgeScores = new Map<string, number>();
  const knowledgeIds: string[] = [];
  for (const batch of knowledgeSearches) {
    for (const result of batch) {
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
      if (!sourceId || knowledgeScores.has(sourceId)) continue;
      knowledgeScores.set(sourceId, Number(result.score ?? 0));
      knowledgeIds.push(sourceId);
    }
  }

  const [profile, experiencesRaw, educationRaw, projectsRaw, knowledgeRaw] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.userExperience.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.userEducation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    projectIds.length > 0
      ? prisma.userProject.findMany({ where: { userId, id: { in: projectIds } } })
      : Promise.resolve([]),
    knowledgeIds.length > 0
      ? prisma.knowledgeItem.findMany({ where: { userId, id: { in: knowledgeIds } } })
      : Promise.resolve([]),
  ]);

  const projectLimit = parsedOptions.maxProjects ?? 4;
  const rankedProjects = projectsRaw
    .map((project) => ({
      project,
      score: scoreProject({
        project,
        semanticScore: projectScores.get(project.id) ?? 0,
        jdSkills,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, projectLimit);

  const rankedKnowledge = knowledgeRaw
    .map((item) => ({
      item,
      score: scoreKnowledge({
        item,
        semanticScore: knowledgeScores.get(item.id) ?? 0,
        jdSkills,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const selectedProjects = rankedProjects.map((entry) => toResumeProject(entry.project));

  const sourceExperiences: ExperienceItem[] = experiencesRaw.map((item) => ({
    id: item.id,
    company: item.company,
    role: item.role,
    startDate: item.startDate,
    endDate: item.endDate,
    current: item.current,
    location: item.location,
    description: buildExperienceDescription(item),
  }));

  const education = educationRaw.map((item) => ({
    id: item.id,
    institution: item.institution,
    degree: item.degree,
    fieldOfStudy: item.fieldOfStudy,
    startDate: item.startDate,
    endDate: item.endDate,
    current: item.current,
  }));

  const baseSummary = profile?.defaultSummary || fallback.personalInfo.summary;

  const paraphrased = await paraphraseStaticData({
    jobDescription: trimmedJobDescription,
    parsedJD,
    baseSummary,
    experiences: sourceExperiences,
    selectedProjects,
    selectedKnowledge: rankedKnowledge.map(({ item }) => ({ title: item.title, content: item.content })),
  });

  const paraphrasedMap = new Map(paraphrased.experience.map((entry) => [entry.id, entry.description]));
  const finalExperiences = sourceExperiences.map((item) => ({
    ...item,
    description: paraphrasedMap.get(item.id)?.trim() || item.description,
  }));

  const sourceTextCorpus = [
    ...sourceExperiences.map((entry) => ({ id: `experience:${entry.id}`, text: entry.description })),
    ...rankedProjects.map(({ project }) => ({ id: `project:${project.id}`, text: getProjectText(project) })),
    ...rankedKnowledge.map(({ item }) => ({ id: `knowledge:${item.id}`, text: getKnowledgeText(item) })),
    ...(profile
      ? [{ id: 'profile:summary', text: `${profile.defaultTitle} ${profile.defaultSummary}` }]
      : []),
  ];

  const normalizedCorpus = normalizeText(sourceTextCorpus.map((source) => source.text).join(' '));

  const projectTechSkills = uniqueStrings(
    rankedProjects.flatMap(({ project }) =>
      Array.isArray(project.technologies) ? (project.technologies as string[]) : []
    )
  );

  const orderedSkills = uniqueStrings([
    ...jdSkills,
    ...projectTechSkills,
    ...paraphrased.skills,
    ...fallback.skills,
  ]).filter((skill) => {
    const normalized = normalizeText(skill);
    if (!normalized) return false;
    return normalizedCorpus.includes(normalized) || projectTechSkills.some((tech) => normalizeText(tech) === normalized);
  }).slice(0, 20);

  const assembled = buildBaseResume({
    fallback,
    profile: profile
      ? {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        website: profile.website,
        linkedin: profile.linkedin,
        github: profile.github,
        defaultTitle: profile.defaultTitle,
        defaultSummary: profile.defaultSummary,
      }
      : null,
    experiences: finalExperiences,
    education,
    projects: selectedProjects,
    skills: orderedSkills,
    jdRole: parsedJD.role,
    parsedSummary: paraphrased.summary,
  });

  const validationBeforeSanitize = validateClaims(assembled, sourceTextCorpus);
  const sanitizedResume = sanitizeUnsupportedClaims(assembled, validationBeforeSanitize.unsupportedClaims);
  const validation = validateClaims(sanitizedResume, sourceTextCorpus);

  return {
    resume: sanitizedResume,
    sources: {
      projects: rankedProjects.map((entry) => ({ id: entry.project.id, score: Number(entry.score.toFixed(4)) })),
      knowledgeItems: rankedKnowledge.map((entry) => ({ id: entry.item.id, score: Number(entry.score.toFixed(4)) })),
      parsedJD,
    },
    atsEstimate: computeAtsEstimate(sanitizedResume, parsedJD),
    validation,
  };
}
