'use server';

import { auth } from '@clerk/nextjs/server';
import { KnowledgeType, type KnowledgeItem, type UserProject, type Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { z } from 'zod';
import { calculateATSScore } from '@/actions/ai';
import { generateEmbedding, searchQdrantByVector } from '@/actions/embed';
import { parseWithRetry, ResumeDataSchema } from '@/lib/aiSchemas';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { trackedChatCompletion } from '@/lib/usageTracker';
import { initialResumeData, type ResumeData, type ExperienceItem, type ProjectItem } from '@/types/resume';

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
  projects: z.array(z.object({ id: z.string(), description: z.string().default('') })).default([]),
  skills: z.array(z.string()).default([]),
});

const SmartGenerateOptionsSchema = z.object({
  templatePreference: z.enum(['ats-simple', 'modern', 'classic']).optional(),
  maxProjects: z.number().int().min(1).max(6).optional(),
  focusAreas: z.array(z.string().max(100)).max(20).optional(),
  fallbackResumeData: ResumeDataSchema.optional(),
  actorUserId: z.string().min(1).max(255).optional(),
  actorSessionId: z.string().cuid().optional(),
  artifactSeed: z.object({
    parsedJD: ParsedJDSchema,
    matchedProjects: z.array(z.object({ id: z.string(), score: z.number().default(0) })).default([]),
    matchedAchievements: z.array(z.object({
      id: z.string(),
      score: z.number().default(0),
      type: z.nativeEnum(KnowledgeType),
    })).default([]),
    staticData: z.object({
      profile: z.object({
        fullName: z.string().default(''),
        email: z.string().default(''),
        phone: z.string().default(''),
        location: z.string().default(''),
        website: z.string().default(''),
        linkedin: z.string().default(''),
        github: z.string().default(''),
        defaultTitle: z.string().default(''),
        defaultSummary: z.string().default(''),
      }).nullable(),
      experiences: z.array(z.object({
        id: z.string(),
        company: z.string().default(''),
        role: z.string().default(''),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
        current: z.boolean().default(false),
        location: z.string().default(''),
        description: z.string().default(''),
      })).default([]),
      education: z.array(z.object({
        id: z.string(),
        institution: z.string().default(''),
        degree: z.string().default(''),
        fieldOfStudy: z.string().default(''),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
        current: z.boolean().default(false),
      })).default([]),
    }),
  }).optional(),
});

const jdCache = new Map<string, z.infer<typeof ParsedJDSchema>>();
const JD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROJECT_README_CONTEXT_CHARS = 1200;

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
  unsupportedMetricClaims: string[];
};

type SmartResumeResult = {
  resume: ResumeData;
  sources: SourceMap;
  atsEstimate: number;
  validation: ClaimValidation;
};

type SmartResumePipelineArtifacts = {
  parsedJD: z.infer<typeof ParsedJDSchema>;
  matchedProjects: Array<{ id: string; score: number }>;
  matchedAchievements: Array<{ id: string; score: number; type: KnowledgeType }>;
  staticData: {
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
  };
  paraphrasedContent: z.infer<typeof ParaphraseSchema>;
  draftResume: ResumeData;
  validationResult: ClaimValidation;
};

export type SmartResumePipelineResult = SmartResumeResult & {
  artifacts: SmartResumePipelineArtifacts;
};

export type SmartResumeArtifactSeed = z.infer<typeof SmartGenerateOptionsSchema>['artifactSeed'];

export type SmartPipelineStep =
  | 'jd_parsing'
  | 'semantic_search'
  | 'static_data_load'
  | 'paraphrasing'
  | 'resume_assembly'
  | 'claim_validation'
  | 'ats_scoring';

const BOILERPLATE_SECTIONS = [
  /equal opportunity employer[\s\S]*$/i,
  /benefits[\s\S]*$/i,
  /how to apply[\s\S]*$/i,
  /about (the )?company[\s\S]*$/i,
];

const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i;

function preprocessJobDescription(raw: string): { cleaned: string; searchText: string } {
  let text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    throw new Error('Job description is required');
  }

  if (URL_ONLY_PATTERN.test(text)) {
    throw new Error('Please paste the full job description text instead of a URL');
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (text.length < 100 || wordCount < 20) {
    throw new Error('Job description is too short. Please provide at least 20 words of job details');
  }

  for (const pattern of BOILERPLATE_SECTIONS) {
    text = text.replace(pattern, '').trim();
  }

  const searchText = text.slice(0, 15000);
  return { cleaned: text, searchText };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function extractMetricTokens(value: string): string[] {
  const matches = value.match(/\b\d+(?:[.,]\d+)?(?:%|\+|x|k|m|b)?\b/gi) ?? [];
  return matches.map((entry) => entry.toLowerCase());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getProjectText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme'>): string {
  const technologies = Array.isArray(project.technologies) ? (project.technologies as string[]) : [];
  return [project.name, project.description, technologies.join(' '), project.readme.slice(0, PROJECT_README_CONTEXT_CHARS)].join(' ').trim();
}

function getKnowledgeText(item: Pick<KnowledgeItem, 'title' | 'content'>): string {
  return `${item.title} ${item.content}`.trim();
}

function toCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

function formatExperienceContext(experiences: ExperienceItem[], relevanceById: Map<string, number>): string {
  return experiences.map((item) => {
    const relevance = relevanceById.get(item.id) ?? 0;
    return `[Experience:${item.id}] ${item.role} at ${item.company} (${item.startDate} - ${item.current ? 'Present' : item.endDate || 'N/A'}, ${item.location})
Relevance:${relevance.toFixed(2)}
${item.description}`;
  }).join('\n\n');
}

function formatProjectContext(projects: ProjectItem[]): string {
  return projects.map((item) => {
    const tech = item.technologies.length > 0 ? item.technologies.join(', ') : 'N/A';
    return `[Project:${item.id}] ${item.name}
Tech:${tech}
${item.description}`;
  }).join('\n\n');
}

function formatKnowledgeContext(items: Pick<KnowledgeItem, 'title' | 'content'>[]): string {
  return items.map((item) => `[Knowledge] ${item.title}: ${item.content}`).join('\n');
}

function buildFocusedSemanticQuery(parsedJD: z.infer<typeof ParsedJDSchema>, focusAreas: string[] = []): string {
  const role = parsedJD.role.trim();
  const company = parsedJD.company.trim();
  const required = uniqueStrings([...parsedJD.requiredSkills, ...focusAreas]).join(', ');
  const preferred = uniqueStrings(parsedJD.preferredSkills).join(', ');
  const responsibilities = uniqueStrings(parsedJD.keyResponsibilities).slice(0, 6).join('. ');
  const domain = parsedJD.industryDomain.trim();

  return [
    role ? `Role: ${role}` : '',
    company ? `Company: ${company}` : '',
    required ? `Required skills: ${required}` : '',
    preferred ? `Preferred skills: ${preferred}` : '',
    responsibilities ? `Key responsibilities: ${responsibilities}` : '',
    domain ? `Domain: ${domain}` : '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 4000);
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

function scoreExperienceRelevance(params: {
  item: ExperienceItem;
  jdSkills: string[];
  parsedJD: z.infer<typeof ParsedJDSchema>;
}): number {
  const text = normalizeText([
    params.item.role,
    params.item.company,
    params.item.description,
  ].join(' '));

  const skillHits = params.jdSkills.filter((skill) => text.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;
  const roleSignal = params.parsedJD.role
    ? (text.includes(normalizeText(params.parsedJD.role)) ? 1 : 0)
    : 0;
  const responsibilityHits = params.parsedJD.keyResponsibilities
    .slice(0, 8)
    .filter((entry) => text.includes(normalizeText(entry))).length;
  const responsibilityCoverage = params.parsedJD.keyResponsibilities.length > 0
    ? Math.min(1, responsibilityHits / Math.min(8, params.parsedJD.keyResponsibilities.length))
    : 0;

  return (skillCoverage * 0.55) + (roleSignal * 0.2) + (responsibilityCoverage * 0.25);
}

function parseYearsExperience(raw: string): number {
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function resolveLengthConstraints(targetLength: '1-page' | '2-page' | 'auto', yearsExperience: number) {
  const resolved = targetLength === 'auto'
    ? (yearsExperience >= 5 ? '2-page' : '1-page')
    : targetLength;

  if (resolved === '1-page') {
    return { maxExperiences: 3, maxProjects: 3, maxSkills: 15 };
  }

  return { maxExperiences: 5, maxProjects: 4, maxSkills: 20 };
}

async function parseJobDescription(params: {
  jobDescription: string;
  userId: string;
  sessionId?: string;
}): Promise<z.infer<typeof ParsedJDSchema>> {
  const jobDescription = params.jobDescription;
  const hash = createHash('sha256').update(jobDescription.trim()).digest('hex');
  const cached = jdCache.get(hash);
  if (cached) return cached;

  const persisted = await prisma.parsedJDCache.findUnique({
    where: { jdHash: hash },
    select: { parsedJD: true, expiresAt: true },
  });
  if (persisted && persisted.expiresAt.getTime() > Date.now()) {
    const parsed = ParsedJDSchema.safeParse(persisted.parsedJD);
    if (parsed.success) {
      jdCache.set(hash, parsed.data);
      return parsed.data;
    }
  }

  const prompt = `Parse the job description into structured JSON.
Return ONLY JSON with keys:
role, company, requiredSkills, preferredSkills, experienceLevel, keyResponsibilities, industryDomain.
If missing, use empty strings/arrays.

JOB DESCRIPTION:\n${jobDescription}`;

  const response = await trackedChatCompletion({
    model: config.openai.models.jdParse,
    messages: [
      {
        role: 'system',
        content: 'You are a job description parser. Extract only explicit facts present in the JD and never invent missing details.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  }, {
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'jd_parse',
  });

  const content = response.choices[0].message.content ?? '{}';
  const parsed = await parseWithRetry(content, ParsedJDSchema);
  if (!parsed.success) {
    throw new Error(`Failed to parse JD: ${parsed.error}`);
  }

  await prisma.parsedJDCache.upsert({
    where: { jdHash: hash },
    update: {
      parsedJD: parsed.data as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + JD_CACHE_TTL_MS),
    },
    create: {
      jdHash: hash,
      parsedJD: parsed.data as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + JD_CACHE_TTL_MS),
    },
  });
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
  const sourceMetricTokens = new Set(
    sources.flatMap((source) => extractMetricTokens(source.text))
  );

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
  const unsupportedMetricClaims: string[] = [];

  for (const line of claimLines) {
    const claimTokens = tokenize(line);
    if (claimTokens.length < 3) {
      mappings[line] = 'short-claim';
      continue;
    }

    const metricTokens = extractMetricTokens(line);
    const hasUnsupportedMetric = metricTokens.some((token) => !sourceMetricTokens.has(token));
    if (hasUnsupportedMetric) {
      unsupportedClaims.push(line);
      unsupportedMetricClaims.push(line);
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
    unsupportedMetricClaims,
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
        description: filtered.join('\n'),
      };
    }),
    projects: resume.projects.map((project) => ({
      ...project,
      description: bad.has(project.description.trim()) ? '' : project.description,
    })),
  };
}

function improveResumeForLowAts(params: {
  resume: ResumeData;
  parsedJD: z.infer<typeof ParsedJDSchema>;
  missingKeywords: string[];
  sourceTextCorpus: string;
}): ResumeData {
  const sourceText = normalizeText(params.sourceTextCorpus);
  const candidateSkills = uniqueStrings([
    ...params.resume.skills,
    ...params.parsedJD.requiredSkills,
    ...params.parsedJD.preferredSkills,
    ...params.missingKeywords,
  ]).filter((entry) => {
    const normalized = normalizeText(entry);
    return normalized.length > 0 && sourceText.includes(normalized);
  });

  const ordered = uniqueStrings([
    ...params.parsedJD.requiredSkills,
    ...params.parsedJD.preferredSkills,
    ...candidateSkills,
  ]).slice(0, 20);

  return {
    ...params.resume,
    skills: ordered.length > 0 ? ordered : params.resume.skills,
  };
}

async function paraphraseStaticData(params: {
  parsedJD: z.infer<typeof ParsedJDSchema>;
  targetContext: string;
  baseSummary: string;
  experiences: ExperienceItem[];
  experienceRelevance: Map<string, number>;
  selectedProjects: ProjectItem[];
  selectedKnowledge: Pick<KnowledgeItem, 'title' | 'content'>[];
  tonePreference: 'formal' | 'conversational' | 'technical';
  userId: string;
  sessionId?: string;
}): Promise<z.infer<typeof ParaphraseSchema>> {
  const experienceContext = formatExperienceContext(params.experiences, params.experienceRelevance);
  const projectContext = formatProjectContext(params.selectedProjects);
  const knowledgeContext = formatKnowledgeContext(params.selectedKnowledge);
  const prompt = `You are tailoring resume content for a specific job.
Rules:
- Keep facts, metrics, companies, and dates truthful to source data.
- Do not invent numbers, tools, projects, or achievements.
- Only rewrite wording and ordering to emphasize relevance.
- Tone preference: ${params.tonePreference}
- Output ONLY JSON.

Target context: ${params.targetContext}
Parsed JD: ${toCompactJson(params.parsedJD)}

Current summary:\n${params.baseSummary}

Experiences:\n${experienceContext}

Selected projects:\n${projectContext}

Selected achievements/knowledge:\n${knowledgeContext}

Return JSON as:
{
  "summary": "string",
  "experience": [{"id": "experience-id", "description": "rewritten bullet text"}],
  "projects": [{"id": "project-id", "description": "rewritten project description"}],
  "skills": ["ordered", "skills", "for", "this", "JD"]
}`;

  const response = await trackedChatCompletion({
    model: config.openai.models.paraphrase,
    messages: [
      {
        role: 'system',
        content: 'You are an expert resume writer focused on ATS optimization. Preserve factual truth and never fabricate achievements or metrics.',
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
  sectionOrder: ResumeData['sectionOrder'];
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
    sectionOrder: params.sectionOrder,
  };
}

export async function generateSmartResumePipeline(
  jobDescription: string,
  options?: {
    templatePreference?: 'ats-simple' | 'modern' | 'classic';
    maxProjects?: number;
    focusAreas?: string[];
    fallbackResumeData?: ResumeData;
    actorUserId?: string;
    actorSessionId?: string;
    artifactSeed?: z.infer<typeof SmartGenerateOptionsSchema>['artifactSeed'];
    onStepStart?: (step: SmartPipelineStep) => Promise<void> | void;
    onStepComplete?: (step: SmartPipelineStep, payload: Record<string, unknown>) => Promise<void> | void;
  }
): Promise<SmartResumePipelineResult> {
  const preprocessed = preprocessJobDescription(jobDescription ?? '');
  const trimmedJobDescription = preprocessed.cleaned;

  const onStepStart = options?.onStepStart;
  const onStepComplete = options?.onStepComplete;
  const parsedOptions = SmartGenerateOptionsSchema.parse(options ?? {});
  const fallback = parsedOptions.fallbackResumeData ?? structuredClone(initialResumeData);

  const resolvedUserId = parsedOptions.actorUserId?.trim();
  const userId = resolvedUserId || (await auth()).userId;
  if (!userId) throw new Error('Not authenticated');
  const sessionId = parsedOptions.actorSessionId?.trim();

  const seeded = parsedOptions.artifactSeed;
  let parsedJD = seeded?.parsedJD ?? null;
  if (!parsedJD) {
    await onStepStart?.('jd_parsing');
    parsedJD = await parseJobDescription({
      jobDescription: preprocessed.searchText,
      userId,
      sessionId,
    });
    await onStepComplete?.('jd_parsing', { parsedJD });
  }
  if (!parsedJD) {
    throw new Error('Failed to parse job description');
  }
  const jdSkills = uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills, ...(parsedOptions.focusAreas ?? [])]);

  const profileForPreferences = await prisma.userProfile.findUnique({
    where: { userId },
    select: { preferences: true, yearsExperience: true },
  });
  const preferences = parseUserGenerationPreferences(profileForPreferences?.preferences);
  const yearsExperience = parseYearsExperience(profileForPreferences?.yearsExperience ?? '');
  const lengthConstraints = resolveLengthConstraints(preferences.targetLength, yearsExperience);

  const knowledgeTypes: KnowledgeType[] = [
    KnowledgeType.achievement,
    KnowledgeType.certification,
    KnowledgeType.award,
    KnowledgeType.publication,
    KnowledgeType.custom,
  ];
  if (preferences.includeOSS) {
    knowledgeTypes.push(KnowledgeType.oss_contribution);
  }

  const projectScores = new Map<string, number>();
  const projectIds: string[] = [];
  const knowledgeScores = new Map<string, number>();
  const knowledgeIds: string[] = [];

  if (seeded) {
    for (const item of seeded.matchedProjects) {
      if (!projectScores.has(item.id)) {
        projectScores.set(item.id, item.score);
        projectIds.push(item.id);
      }
    }
    for (const item of seeded.matchedAchievements) {
      if (!knowledgeScores.has(item.id)) {
        knowledgeScores.set(item.id, item.score);
        knowledgeIds.push(item.id);
      }
    }
  } else {
    await onStepStart?.('semantic_search');
    const semanticQuery = buildFocusedSemanticQuery(parsedJD, parsedOptions.focusAreas ?? []);
    const queryEmbedding = await generateEmbedding({
      text: semanticQuery,
      userId,
      sessionId,
      operation: 'embedding_generate',
      metadata: {
        reason: 'semantic_search_query',
        type: 'all',
      },
    });

    const [projectSearch, ...knowledgeSearches] = await Promise.all([
      searchQdrantByVector({ userId, sessionId, vector: queryEmbedding, type: 'project', limit: 10 }),
      ...knowledgeTypes.map((type) => searchQdrantByVector({ userId, sessionId, vector: queryEmbedding, type, limit: 4 })),
    ]);

    for (const result of projectSearch) {
      const payload = (result.payload ?? {}) as Record<string, unknown>;
      const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
      if (!sourceId || projectScores.has(sourceId)) continue;
      projectScores.set(sourceId, Number(result.score ?? 0));
      projectIds.push(sourceId);
    }

    for (const batch of knowledgeSearches) {
      for (const result of batch) {
        const payload = (result.payload ?? {}) as Record<string, unknown>;
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!sourceId || knowledgeScores.has(sourceId)) continue;
        knowledgeScores.set(sourceId, Number(result.score ?? 0));
        knowledgeIds.push(sourceId);
      }
    }
  }

  const [profile, experiencesRaw, educationRaw, projectsRaw, knowledgeRaw] = await Promise.all([
    seeded?.staticData.profile
      ? Promise.resolve(seeded.staticData.profile)
      : prisma.userProfile.findUnique({ where: { userId } }),
    seeded?.staticData.experiences
      ? Promise.resolve(seeded.staticData.experiences)
      : prisma.userExperience.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    seeded?.staticData.education
      ? Promise.resolve(seeded.staticData.education)
      : prisma.userEducation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    projectIds.length > 0
      ? prisma.userProject.findMany({ where: { userId, id: { in: projectIds } } })
      : Promise.resolve([]),
    knowledgeIds.length > 0
      ? prisma.knowledgeItem.findMany({ where: { userId, id: { in: knowledgeIds } } })
      : Promise.resolve([]),
  ]);

  const projectLimit = Math.min(
    parsedOptions.maxProjects ?? preferences.maxProjects,
    lengthConstraints.maxProjects
  );
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
  if (!seeded) {
    await onStepComplete?.('semantic_search', {
      matchedProjects: rankedProjects.map((entry) => ({ id: entry.project.id, score: Number(entry.score.toFixed(4)) })),
      matchedAchievements: rankedKnowledge.map((entry) => ({
        id: entry.item.id,
        score: Number(entry.score.toFixed(4)),
        type: entry.item.type,
      })),
    });
  }

  const selectedProjects = rankedProjects.map((entry) => toResumeProject(entry.project));

  const sourceExperiences: ExperienceItem[] = experiencesRaw.map((item) => ({
    id: item.id,
    company: item.company,
    role: item.role,
    startDate: item.startDate,
    endDate: item.endDate,
    current: item.current,
    location: item.location,
    description: 'highlights' in item
      ? buildExperienceDescription(item as { description: string; highlights: unknown })
      : (item.description || '').trim(),
  }));
  const rankedExperiences = sourceExperiences
    .map((item) => ({
      item,
      score: scoreExperienceRelevance({ item, jdSkills, parsedJD }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, lengthConstraints.maxExperiences);
  const experienceRelevance = new Map(rankedExperiences.map((entry) => [entry.item.id, entry.score]));
  const scopedExperiences = rankedExperiences.map((entry) => {
    if (entry.score >= 0.25) return entry.item;
    const topLines = entry.item.description
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2);
    return {
      ...entry.item,
      description: topLines.join('\n') || entry.item.description,
    };
  });

  const education = educationRaw.map((item) => ({
    id: item.id,
    institution: item.institution,
    degree: item.degree,
    fieldOfStudy: item.fieldOfStudy,
    startDate: item.startDate,
    endDate: item.endDate,
    current: item.current,
  }));

  if (!seeded) {
    await onStepStart?.('static_data_load');
  }
  const baseSummary = profile?.defaultSummary || fallback.personalInfo.summary;
  if (!seeded) {
    await onStepComplete?.('static_data_load', {
      staticData: {
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
        experiences: sourceExperiences,
        education,
      },
    });
  }

  await onStepStart?.('paraphrasing');
  const paraphrased = await paraphraseStaticData({
    parsedJD,
    targetContext: `${parsedJD.role || 'Role'} @ ${parsedJD.company || 'Company'} ${parsedJD.industryDomain ? `| ${parsedJD.industryDomain}` : ''}`.trim(),
    baseSummary,
    experiences: scopedExperiences,
    experienceRelevance,
    selectedProjects,
    selectedKnowledge: rankedKnowledge.map(({ item }) => ({ title: item.title, content: item.content })),
    tonePreference: preferences.tonePreference,
    userId,
    sessionId,
  });
  await onStepComplete?.('paraphrasing', { paraphrasedContent: paraphrased });

  const paraphrasedMap = new Map(paraphrased.experience.map((entry) => [entry.id, entry.description]));
  const paraphrasedProjectsMap = new Map(paraphrased.projects.map((entry) => [entry.id, entry.description]));
  const finalExperiences = scopedExperiences.map((item) => ({
    ...item,
    description: paraphrasedMap.get(item.id)?.trim() || item.description,
  }));
  const finalProjects = selectedProjects.map((item) => ({
    ...item,
    description: paraphrasedProjectsMap.get(item.id)?.trim() || item.description,
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
  }).slice(0, lengthConstraints.maxSkills);

  await onStepStart?.('resume_assembly');
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
    projects: finalProjects,
    skills: orderedSkills,
    jdRole: parsedJD.role,
    parsedSummary: paraphrased.summary,
    sectionOrder: preferences.defaultSectionOrder,
  });
  await onStepComplete?.('resume_assembly', { draftResume: assembled });

  await onStepStart?.('claim_validation');
  const validationBeforeSanitize = validateClaims(assembled, sourceTextCorpus);
  const sanitizedResume = sanitizeUnsupportedClaims(assembled, validationBeforeSanitize.unsupportedClaims);
  let validation = validateClaims(sanitizedResume, sourceTextCorpus);

  if (validation.coverageRate < 0.5) {
    throw new Error('Truth enforcement rejected generation: less than 50% of claims are traceable to source data');
  }
  await onStepComplete?.('claim_validation', { validationResult: validation, draftResume: sanitizedResume });

  await onStepStart?.('ats_scoring');
  let finalResume = sanitizedResume;
  let atsEstimate = computeAtsEstimate(sanitizedResume, parsedJD);

  try {
    const atsPrimary = await calculateATSScore(sanitizedResume, trimmedJobDescription, {
      userId,
      sessionId,
      operation: 'ats_scoring',
    });
    atsEstimate = atsPrimary.overall;

    if (atsPrimary.overall < 70) {
      const improved = improveResumeForLowAts({
        resume: sanitizedResume,
        parsedJD,
        missingKeywords: atsPrimary.missingKeywords,
        sourceTextCorpus: sourceTextCorpus.map((entry) => entry.text).join(' '),
      });

      const improvedValidation = validateClaims(improved, sourceTextCorpus);
      if (improvedValidation.coverageRate >= 0.5) {
        const deterministicImprovedScore = computeAtsEstimate(improved, parsedJD);
        if (deterministicImprovedScore >= atsPrimary.overall) {
          finalResume = improved;
          validation = improvedValidation;
          atsEstimate = deterministicImprovedScore;
        }
      }
    }
  } catch {
    // Fall back to deterministic ATS estimate if AI ATS scoring fails.
  }
  await onStepComplete?.('ats_scoring', {
    atsScore: atsEstimate,
    validationResult: validation,
    draftResume: finalResume,
  });

  return {
    resume: finalResume,
    sources: {
      projects: rankedProjects.map((entry) => ({ id: entry.project.id, score: Number(entry.score.toFixed(4)) })),
      knowledgeItems: rankedKnowledge.map((entry) => ({ id: entry.item.id, score: Number(entry.score.toFixed(4)) })),
      parsedJD,
    },
    atsEstimate,
    validation,
    artifacts: {
      parsedJD,
      matchedProjects: rankedProjects.map((entry) => ({ id: entry.project.id, score: Number(entry.score.toFixed(4)) })),
      matchedAchievements: rankedKnowledge.map((entry) => ({
        id: entry.item.id,
        score: Number(entry.score.toFixed(4)),
        type: entry.item.type,
      })),
      staticData: {
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
        experiences: sourceExperiences,
        education,
      },
      paraphrasedContent: paraphrased,
      draftResume: assembled,
      validationResult: validation,
    },
  };
}

export async function generateSmartResume(
  jobDescription: string,
  options?: {
    templatePreference?: 'ats-simple' | 'modern' | 'classic';
    maxProjects?: number;
    focusAreas?: string[];
    fallbackResumeData?: ResumeData;
    actorUserId?: string;
    actorSessionId?: string;
    artifactSeed?: z.infer<typeof SmartGenerateOptionsSchema>['artifactSeed'];
  }
): Promise<SmartResumeResult> {
  const result = await generateSmartResumePipeline(jobDescription, options);
  return {
    resume: result.resume,
    sources: result.sources,
    atsEstimate: result.atsEstimate,
    validation: result.validation,
  };
}

export async function generateSmartResumeFromArtifacts(params: {
  jobDescription: string;
  artifactSeed: SmartResumeArtifactSeed;
  fallbackResumeData?: ResumeData;
  focusAreas?: string[];
  actorUserId?: string;
  actorSessionId?: string;
}): Promise<SmartResumeResult> {
  if (!params.artifactSeed) {
    throw new Error('artifactSeed is required for artifact-based generation');
  }

  return generateSmartResume(params.jobDescription, {
    fallbackResumeData: params.fallbackResumeData,
    focusAreas: params.focusAreas,
    actorUserId: params.actorUserId,
    actorSessionId: params.actorSessionId,
    artifactSeed: params.artifactSeed,
  });
}
