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
import { uniqueStrings, getProjectText, getKnowledgeText } from '@/lib/textUtils';
import { experienceRecencyScore } from '@/lib/dateUtils';
import { preprocessJobDescription as preprocessJobDescriptionService } from '@/services/jdParser';
import {
  scoreExperienceRelevance as scoreExperienceRelevanceService,
  scoreKnowledge as scoreKnowledgeService,
  scoreProject as scoreProjectService,
} from '@/services/projectScoring';
import { paraphraseStaticData as paraphraseStaticDataService } from '@/services/paraphraser';
import {
  sanitizeUnsupportedClaims as sanitizeUnsupportedClaimsService,
  validateClaims as validateClaimsService,
  type ClaimValidation,
} from '@/services/claimValidator';
import {
  computeAtsEstimate as computeAtsEstimateService,
  improveResumeForLowAts as improveResumeForLowAtsService,
} from '@/services/atsScorer';
import { buildBaseResume as buildBaseResumeService } from '@/services/resumeAssembler';

const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager'] as const;

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(/[,\n;]/g) : [String(entry ?? '')]))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n;]/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSeniorityLevel(value: unknown): (typeof SENIORITY_LEVELS)[number] {
  if (typeof value !== 'string') return 'mid';
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('junior') || normalized === 'jr') return 'junior';
  if (normalized.includes('mid') || normalized.includes('intermediate')) return 'mid';
  if (normalized.includes('senior') || normalized === 'sr') return 'senior';
  if (normalized.includes('staff')) return 'staff';
  if (normalized.includes('principal')) return 'principal';
  if (normalized.includes('lead')) return 'lead';
  if (normalized.includes('manager') || normalized.includes('head')) return 'manager';
  return 'mid';
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (['true', 'yes', 'y', '1', 'remote', 'fully remote'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'onsite', 'on-site', 'hybrid'].includes(normalized)) return false;
  }
  return false;
}

function coerceSkillGroups(value: unknown): Array<{ name: string; skills: string[] }> {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === 'string') {
        const [rawName, ...rest] = entry.split(':');
        const inferredSkills = coerceStringArray(rest.join(':') || entry);
        return {
          name: rawName.trim() || `group-${index + 1}`,
          skills: inferredSkills,
        };
      }
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        return {
          name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `group-${index + 1}`,
          skills: coerceStringArray(obj.skills),
        };
      }
      return { name: `group-${index + 1}`, skills: [] };
    }).filter((group) => group.name || group.skills.length > 0);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([name, skills]) => ({
      name: name.trim(),
      skills: coerceStringArray(skills),
    })).filter((group) => group.name || group.skills.length > 0);
  }

  return [];
}

const ParsedJDSchema = z.object({
  role: z.string().default(''),
  company: z.string().default(''),
  requiredSkills: z.preprocess((value) => coerceStringArray(value), z.array(z.string())).default([]),
  preferredSkills: z.preprocess((value) => coerceStringArray(value), z.array(z.string())).default([]),
  experienceLevel: z.string().default(''),
  keyResponsibilities: z.preprocess((value) => coerceStringArray(value), z.array(z.string())).default([]),
  industryDomain: z.string().default(''),
  skillGroups: z.preprocess(
    (value) => coerceSkillGroups(value),
    z.array(z.object({
      name: z.string().default(''),
      skills: z.array(z.string()).default([]),
    }))
  ).default([]),
  seniorityLevel: z.preprocess(
    (value) => normalizeSeniorityLevel(value),
    z.enum(SENIORITY_LEVELS)
  ).default('mid'),
  isRemote: z.preprocess((value) => coerceBoolean(value), z.boolean()).default(false),
  softSkills: z.preprocess((value) => coerceStringArray(value), z.array(z.string())).default([]),
});

const SemanticClaimValidationSchema = z.object({
  verdicts: z.array(z.object({
    claim: z.string(),
    supported: z.boolean(),
    reason: z.string().default(''),
  })).default([]),
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
const RICH_EXPERIENCE_MIN_WORDS = 70;
const RICH_EXPERIENCE_MIN_BULLETS = 3;
const RICH_EXPERIENCE_MIN_METRICS = 2;
const MAX_EXPERIENCES_PER_RESUME = 4;

type SourceMap = {
  projects: { id: string; score: number }[];
  knowledgeItems: { id: string; score: number }[];
  parsedJD: z.infer<typeof ParsedJDSchema>;
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
  paraphrasedContent: z.infer<typeof import('@/services/paraphraser').ParaphraseSchema>;
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

function extractMetricTokens(value: string): string[] {
  const matches = value.match(/\b\d+(?:[.,]\d+)?(?:%|\+|x|k|m|b)?\b/gi) ?? [];
  return matches.map((entry) => entry.toLowerCase());
}

function isRichExperienceRecord(item: ExperienceItem): boolean {
  const lines = item.description
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]+\s*/, '').trim())
    .filter(Boolean);
  const wordCount = item.description.split(/\s+/).filter(Boolean).length;
  const metricCount = extractMetricTokens(item.description).length;

  return lines.length >= RICH_EXPERIENCE_MIN_BULLETS
    || wordCount >= RICH_EXPERIENCE_MIN_WORDS
    || metricCount >= RICH_EXPERIENCE_MIN_METRICS;
}

function isGitHubUrl(value: string): boolean {
  return /(^|\/\/)(www\.)?github\.com\//i.test(value.trim());
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

function parseYearsExperience(raw: string): number {
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function resolveLengthConstraints(targetLength: '1-page' | '2-page' | 'auto', yearsExperience: number) {
  const resolved = targetLength === 'auto'
    ? (yearsExperience >= 5 ? '2-page' : '1-page')
    : targetLength;

  if (resolved === '1-page') {
    return { maxExperiences: MAX_EXPERIENCES_PER_RESUME, maxProjects: 3, maxSkills: 15 };
  }

  return { maxExperiences: MAX_EXPERIENCES_PER_RESUME, maxProjects: 4, maxSkills: 20 };
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
role, company, requiredSkills, preferredSkills, experienceLevel, keyResponsibilities, industryDomain, skillGroups, seniorityLevel, isRemote, softSkills.
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
  const normalizedPrimary = (project.url || '').trim();
  const normalizedRepo = (project.githubUrl || '').trim();
  const liveUrl = normalizedPrimary && (!normalizedRepo || normalizedPrimary !== normalizedRepo)
    ? normalizedPrimary
    : '';
  const repoUrl = normalizedRepo || (isGitHubUrl(normalizedPrimary) ? normalizedPrimary : '');
  const url = liveUrl || repoUrl || normalizedPrimary;

  return {
    id: project.id,
    name: project.name,
    description: project.description || project.readme.slice(0, 400),
    url,
    liveUrl,
    repoUrl,
    technologies: Array.isArray(project.technologies) ? (project.technologies as string[]) : [],
  };
}

async function semanticValidateTopClaims(params: {
  resume: ResumeData;
  sources: Array<{ id: string; text: string }>;
  userId: string;
  sessionId?: string;
}): Promise<{ unsupported: string[] }> {
  const claims = [
    ...params.resume.experience.flatMap((exp) => exp.description.split('\n').map((line) => line.trim()).filter(Boolean)),
    ...params.resume.projects.map((project) => project.description.trim()).filter(Boolean),
  ];

  if (claims.length === 0) return { unsupported: [] };

  const rankedClaims = [...claims]
    .sort((a, b) => {
      const scoreA = (/\d/.test(a) ? 2 : 0) + (a.length > 80 ? 1 : 0);
      const scoreB = (/\d/.test(b) ? 2 : 0) + (b.length > 80 ? 1 : 0);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  const prompt = `Verify resume claims against source evidence.
Return ONLY JSON with key "verdicts" where each verdict has { claim, supported, reason }.

Claims:
${JSON.stringify(rankedClaims)}

Sources:
${JSON.stringify(params.sources.map((source) => ({ id: source.id, text: source.text.slice(0, 500) })))}
`;

  try {
    const response = await trackedChatCompletion({
      model: config.openai.models.claimValidation,
      messages: [
        {
          role: 'system',
          content: 'You verify resume claims strictly against source evidence. Mark unsupported if evidence is weak or missing.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }, {
      userId: params.userId,
      sessionId: params.sessionId,
      operation: 'claim_semantic_validation',
    });

    const content = response.choices[0].message.content ?? '{}';
    const parsed = await parseWithRetry(content, SemanticClaimValidationSchema);
    if (!parsed.success) return { unsupported: [] };
    const unsupported = parsed.data.verdicts
      .filter((entry) => !entry.supported)
      .map((entry) => entry.claim.trim())
      .filter(Boolean);
    return { unsupported };
  } catch (error: unknown) {
    void error;
    return { unsupported: [] };
  }
}

function identifyThinSections(resume: ResumeData): Array<'summary' | 'experience' | 'projects' | 'skills'> {
  const thin: Array<'summary' | 'experience' | 'projects' | 'skills'> = [];
  if (!resume.personalInfo.summary || resume.personalInfo.summary.trim().length < 80) thin.push('summary');
  const hasThinExperience = resume.experience.some((exp) => {
    const bullets = exp.description.split('\n').map((line) => line.trim()).filter(Boolean);
    return bullets.length < 2;
  });
  if (hasThinExperience) thin.push('experience');
  if (resume.projects.some((project) => project.description.trim().length < 30)) thin.push('projects');
  if (resume.skills.length < 8) thin.push('skills');
  return thin;
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
  const preprocessed = preprocessJobDescriptionService(jobDescription ?? '');
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
  const experienceSemanticScores = new Map<string, number>();

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
    const skillGroups = parsedJD.skillGroups.length > 0
      ? parsedJD.skillGroups
      : [{ name: 'core', skills: uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills]).slice(0, 8) }];
    const semanticQueries = skillGroups
      .slice(0, 3)
      .map((group) => `${parsedJD.role}. ${group.skills.join(', ')}`.trim())
      .filter(Boolean);
    const baseQuery = buildFocusedSemanticQuery(parsedJD, parsedOptions.focusAreas ?? []);
    if (semanticQueries.length === 0) {
      semanticQueries.push(baseQuery);
    }

    const queryEmbeddings = await Promise.all(
      semanticQueries.map((query) => generateEmbedding({
        text: query,
        userId,
        sessionId,
        operation: 'embedding_generate',
        metadata: {
          reason: 'semantic_search_query',
          type: 'all',
        },
      }))
    );

    const allSearchResults = await Promise.all(
      queryEmbeddings.map(async (vector) => {
        const [projectSearch, experienceSearch, ...knowledgeSearches] = await Promise.all([
          searchQdrantByVector({ userId, sessionId, vector, type: 'project', limit: 6 }),
          searchQdrantByVector({ userId, sessionId, vector, type: 'experience', limit: 6 }),
          ...knowledgeTypes.map((type) => searchQdrantByVector({ userId, sessionId, vector, type, limit: 3 })),
        ]);
        return { projectSearch, experienceSearch, knowledgeSearches };
      })
    );

    for (const batchResults of allSearchResults) {
      for (const result of batchResults.projectSearch) {
        const payload = (result.payload ?? {}) as Record<string, unknown>;
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!sourceId) continue;
        const score = Number(result.score ?? 0);
        const previous = projectScores.get(sourceId) ?? 0;
        if (score > previous) {
          projectScores.set(sourceId, score);
          if (!projectIds.includes(sourceId)) projectIds.push(sourceId);
        }
      }

      for (const result of batchResults.experienceSearch) {
        const payload = (result.payload ?? {}) as Record<string, unknown>;
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!sourceId) continue;
        const score = Number(result.score ?? 0);
        const previous = experienceSemanticScores.get(sourceId) ?? 0;
        if (score > previous) {
          experienceSemanticScores.set(sourceId, score);
        }
      }

      for (const searchBatch of batchResults.knowledgeSearches) {
        for (const result of searchBatch) {
          const payload = (result.payload ?? {}) as Record<string, unknown>;
          const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
          if (!sourceId) continue;
          const score = Number(result.score ?? 0);
          const previous = knowledgeScores.get(sourceId) ?? 0;
          if (score > previous) {
            knowledgeScores.set(sourceId, score);
            if (!knowledgeIds.includes(sourceId)) knowledgeIds.push(sourceId);
          }
        }
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
      score: scoreProjectService({
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
      score: scoreKnowledgeService({
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
  const experienceScores = new Map(
    sourceExperiences.map((item) => ([
      item.id,
      (scoreExperienceRelevanceService({ item, jdSkills, parsedJD }) * 0.75) + ((experienceSemanticScores.get(item.id) ?? 0) * 0.25),
    ]))
  );
  const selectedExperiences = [...sourceExperiences]
    .sort((a, b) => experienceRecencyScore(b) - experienceRecencyScore(a))
    .slice(0, lengthConstraints.maxExperiences);
  const experienceRelevance = new Map(selectedExperiences.map((item) => [item.id, experienceScores.get(item.id) ?? 0]));

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
  const paraphrased = await paraphraseStaticDataService({
    parsedJD,
    targetContext: `${parsedJD.role || 'Role'} @ ${parsedJD.company || 'Company'} ${parsedJD.industryDomain ? `| ${parsedJD.industryDomain}` : ''}`.trim(),
    baseSummary,
    experiences: selectedExperiences,
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
  const hasRichKnowledgeContext = rankedKnowledge.length >= 3;
  const finalExperiences = selectedExperiences.map((item) => {
    const rewritten = paraphrasedMap.get(item.id)?.trim();
    const canParaphrase = isRichExperienceRecord(item) || hasRichKnowledgeContext;
    if (!canParaphrase || !rewritten) return item;
    return {
      ...item,
      description: rewritten,
    };
  });
  const finalProjects = selectedProjects.map((item) => ({
    ...item,
    description: paraphrasedProjectsMap.get(item.id)?.trim() || item.description,
  }));

  const normalizeText = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

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
  const assembled = buildBaseResumeService({
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
  const validationBeforeSanitize = validateClaimsService(assembled, sourceTextCorpus);
  const sanitizedResume = sanitizeUnsupportedClaimsService(assembled, validationBeforeSanitize.unsupportedClaims);
  let validatedResume = sanitizedResume;
  let validation = validateClaimsService(validatedResume, sourceTextCorpus);
  const semanticValidation = await semanticValidateTopClaims({
    resume: validatedResume,
    sources: sourceTextCorpus,
    userId,
    sessionId,
  });
  if (semanticValidation.unsupported.length > 0) {
    validatedResume = sanitizeUnsupportedClaimsService(validatedResume, semanticValidation.unsupported);
    validation = validateClaimsService(validatedResume, sourceTextCorpus);
  }

  if (validation.coverageRate < 0.5) {
    throw new Error('Truth enforcement rejected generation: less than 50% of claims are traceable to source data');
  }
  await onStepComplete?.('claim_validation', { validationResult: validation, draftResume: validatedResume });

  await onStepStart?.('ats_scoring');
  let finalResume = validatedResume;
  let atsEstimate = computeAtsEstimateService(validatedResume, parsedJD);

  try {
    const atsPrimary = await calculateATSScore(validatedResume, trimmedJobDescription, {
      userId,
      sessionId,
      operation: 'ats_scoring',
    });
    atsEstimate = atsPrimary.overall;

    let currentResume = finalResume;
    let currentScore = atsPrimary.overall;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const thinSections = identifyThinSections(currentResume);
      if (currentScore >= 75 && thinSections.length === 0) break;

      let improved = improveResumeForLowAtsService({
        resume: currentResume,
        parsedJD,
        missingKeywords: atsPrimary.missingKeywords,
        sourceTextCorpus: sourceTextCorpus.map((entry) => entry.text).join(' '),
      });

      if (thinSections.includes('summary')) {
        improved = {
          ...improved,
          personalInfo: {
            ...improved.personalInfo,
            summary: improved.personalInfo.summary.trim().length >= 80
              ? improved.personalInfo.summary
              : `Results-focused ${parsedJD.role || improved.personalInfo.title || 'professional'} with hands-on experience in ${improved.skills.slice(0, 4).join(', ')} and a track record of delivering measurable outcomes.`,
          },
        };
      }

      const improvedValidation = validateClaimsService(improved, sourceTextCorpus);
      if (improvedValidation.coverageRate < 0.5) {
        break;
      }

      const deterministicImprovedScore = computeAtsEstimateService(improved, parsedJD);
      if (deterministicImprovedScore < currentScore && thinSections.length === 0) {
        break;
      }

      currentResume = improved;
      currentScore = deterministicImprovedScore;
      validation = improvedValidation;
    }

    if (currentScore >= atsEstimate) {
      finalResume = currentResume;
      atsEstimate = currentScore;
    }
  } catch (error: unknown) {
    void error;
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
