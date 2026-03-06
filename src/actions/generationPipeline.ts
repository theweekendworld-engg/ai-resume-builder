'use server';

import { auth } from '@clerk/nextjs/server';
import { GenerationStatus, PipelineStep, Prisma, ResumeVersionSource } from '@prisma/client';
import { z } from 'zod';
import { compileLatex } from '@/actions/ai';
import { generateSmartResumePipeline, type SmartPipelineStep, type SmartResumeArtifactSeed } from '@/actions/generateResume';
import { runResumeAgent } from '@/agents/resumeAgent';
import { prisma } from '@/lib/prisma';
import { storePdfArtifact } from '@/lib/pdfStorage';
import { config } from '@/lib/config';
import { generateLatexFromResume, type LatexTemplateType } from '@/templates/latex';
import { logUsageEvent } from '@/lib/usageTracker';
import type { ResumeData } from '@/types/resume';

type RunGenerationOptions = {
  sessionId: string;
  userId: string;
  fallbackResumeData?: ResumeData;
  focusAreas?: string[];
  maxProjects?: number;
  templatePreference?: LatexTemplateType;
};

const RetryGenerationSessionSchema = z.object({
  sessionId: z.string().cuid(),
});

export type GenerationRunResult = {
  sessionId: string;
  status: 'completed' | 'awaiting_clarification' | 'generating';
  resume?: ResumeData;
  resumeId?: string;
  atsEstimate?: number;
  pdfUrl?: string;
  reused: boolean;
};

function toPipelineStep(step: SmartPipelineStep): PipelineStep {
  switch (step) {
    case 'jd_parsing':
      return PipelineStep.jd_parsing;
    case 'semantic_search':
      return PipelineStep.semantic_search;
    case 'static_data_load':
      return PipelineStep.static_data_load;
    case 'paraphrasing':
      return PipelineStep.paraphrasing;
    case 'resume_assembly':
      return PipelineStep.resume_assembly;
    case 'claim_validation':
      return PipelineStep.claim_validation;
    case 'ats_scoring':
      return PipelineStep.ats_scoring;
    default:
      return PipelineStep.jd_parsing;
  }
}

function nextPipelineStep(step: SmartPipelineStep): PipelineStep {
  switch (step) {
    case 'jd_parsing':
      return PipelineStep.semantic_search;
    case 'semantic_search':
      return PipelineStep.static_data_load;
    case 'static_data_load':
      return PipelineStep.paraphrasing;
    case 'paraphrasing':
      return PipelineStep.resume_assembly;
    case 'resume_assembly':
      return PipelineStep.claim_validation;
    case 'claim_validation':
      return PipelineStep.ats_scoring;
    case 'ats_scoring':
      return PipelineStep.pdf_generation;
    default:
      return PipelineStep.pdf_generation;
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').map((token) => token.trim()).filter((token) => token.length >= 3));
}

function overlapScore(a: string, b: string): number {
  const first = tokenSet(a);
  const second = tokenSet(b);
  if (first.size === 0 || second.size === 0) return 0;
  let overlap = 0;
  for (const token of first) {
    if (second.has(token)) overlap += 1;
  }
  const base = Math.min(first.size, second.size);
  return base > 0 ? overlap / base : 0;
}

function deriveResumeMetadata(resumeData: ResumeData, atsScore?: number) {
  const targetRole = resumeData.personalInfo.title?.trim() || resumeData.experience[0]?.role?.trim() || null;
  const targetCompany = resumeData.experience[0]?.company?.trim() || null;
  const summaryRaw = resumeData.personalInfo.summary?.trim() || '';
  const atsSummary = summaryRaw ? summaryRaw.slice(0, 180) : null;

  return {
    targetRole,
    targetCompany,
    atsScore: typeof atsScore === 'number' ? atsScore : null,
    atsSummary,
  };
}

async function saveGeneratedResumeForUser(params: {
  userId: string;
  resume: ResumeData;
  atsEstimate?: number;
}): Promise<string> {
  const title = params.resume.personalInfo.fullName?.trim()
    ? `${params.resume.personalInfo.fullName.trim()} Resume`
    : 'Generated Resume';

  const payload = params.resume as unknown as object;

  const resume = await prisma.resume.create({
    data: {
      userId: params.userId,
      title,
      content: payload,
    },
    select: { id: true, title: true },
  });

  const version = await prisma.resumeVersion.create({
    data: {
      userId: params.userId,
      resumeId: resume.id,
      content: payload,
      source: ResumeVersionSource.ai,
    },
    select: { id: true },
  });

  const metadata = deriveResumeMetadata(params.resume, params.atsEstimate);

  await prisma.resume.update({
    where: { id: resume.id },
    data: {
      currentVersionId: version.id,
      targetRole: metadata.targetRole,
      targetCompany: metadata.targetCompany,
      atsScore: metadata.atsScore,
      atsSummary: metadata.atsSummary,
      updatedAt: new Date(),
    },
  });

  return resume.id;
}

async function getSessionUsageTotals(sessionId: string) {
  const totals = await prisma.apiUsageLog.aggregate({
    where: { sessionId, status: 'success' },
    _sum: {
      totalTokens: true,
      costUsd: true,
    },
  });

  const totalTokensUsed = totals._sum.totalTokens ?? 0;
  const totalCostUsd = totals._sum.costUsd ?? 0;
  return { totalTokensUsed, totalCostUsd };
}

async function maybeReuseExistingResume(params: {
  userId: string;
  sessionId: string;
  jobDescription: string;
}): Promise<{
  reused: boolean;
  resumeId?: string;
  resume?: ResumeData;
  atsEstimate?: number;
  pdfUrl?: string;
  pdfBlobKey?: string;
}> {
  if (!config.resumeReuse.enabled) return { reused: false };

  const resumes = await prisma.resume.findMany({
    where: {
      userId: params.userId,
      atsScore: { gte: config.resumeReuse.minAtsScore },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      currentVersion: true,
    },
    take: 25,
  });

  const jd = params.jobDescription.slice(0, 8000);
  let best: {
    id: string;
    score: number;
    ats: number;
    content: ResumeData | null;
  } | null = null;

  for (const resume of resumes) {
    const role = resume.targetRole || '';
    const company = resume.targetCompany || '';
    const hints = `${resume.title} ${role} ${company} ${resume.atsSummary || ''}`;
    const similarity = overlapScore(jd, hints);
    const roleMatch = role ? normalizeText(jd).includes(normalizeText(role)) : false;
    const companyMatch = company ? normalizeText(jd).includes(normalizeText(company)) : false;
    const boosted = similarity + (roleMatch ? 0.2 : 0) + (companyMatch ? 0.15 : 0);

    if (boosted < config.resumeReuse.similarityThreshold) continue;

    const content = (resume.currentVersion?.content ?? resume.content ?? null) as ResumeData | null;
    if (!content) continue;
    const ats = resume.atsScore ?? 0;
    if (!best || boosted > best.score || (boosted === best.score && ats > best.ats)) {
      best = { id: resume.id, score: boosted, ats, content };
    }
  }

  if (!best) return { reused: false };

  let latestPdf: { blobKey: string; blobUrl: string } | null = null;
  if (config.pdfStorage.enableStoredPdfFetch) {
    latestPdf = await prisma.generatedPdf.findFirst({
      where: { userId: params.userId, resumeId: best.id },
      orderBy: { createdAt: 'desc' },
      select: { blobKey: true, blobUrl: true },
    });
  }

  return {
    reused: true,
    resumeId: best.id,
    resume: best.content ?? undefined,
    atsEstimate: best.ats,
    pdfUrl: latestPdf?.blobUrl,
    pdfBlobKey: latestPdf?.blobKey,
  };
}

async function persistStoredPdf(params: {
  userId: string;
  sessionId: string;
  resumeId: string;
  template: LatexTemplateType;
  pdfBase64: string;
}): Promise<{ blobKey: string; blobUrl: string; fileSizeBytes: number }> {
  const pdfBuffer = Buffer.from(params.pdfBase64, 'base64');
  const stored = await storePdfArtifact({
    userId: params.userId,
    resumeId: params.resumeId,
    sessionId: params.sessionId,
    template: params.template,
    pdfBuffer,
  });

  await prisma.generatedPdf.create({
    data: {
      userId: params.userId,
      resumeId: params.resumeId,
      sessionId: params.sessionId,
      blobKey: stored.blobKey,
      blobUrl: stored.blobUrl,
      fileSizeBytes: stored.fileSizeBytes,
      template: params.template,
    },
  });

  const staleRows = await prisma.generatedPdf.findMany({
    where: { userId: params.userId, resumeId: params.resumeId },
    orderBy: { createdAt: 'desc' },
    skip: 3,
    select: { id: true },
  });

  if (staleRows.length > 0) {
    await prisma.generatedPdf.deleteMany({
      where: { id: { in: staleRows.map((row) => row.id) } },
    });
  }

  await logUsageEvent({
    userId: params.userId,
    sessionId: params.sessionId,
    operation: 'pdf_storage',
    provider: config.pdfStorage.mode === 'blob' ? 'blob' : 'local_fs',
    model: params.template,
    totalTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    metadata: {
      blobKey: stored.blobKey,
      fileSizeBytes: stored.fileSizeBytes,
    },
  });

  return stored;
}

async function markFailure(params: {
  sessionId: string;
  step: PipelineStep;
  message: string;
}): Promise<void> {
  await prisma.generationSession.update({
    where: { id: params.sessionId },
    data: {
      status: GenerationStatus.failed,
      errorStep: params.step,
      errorMessage: params.message.slice(0, 5000),
      currentStep: params.step,
      completedAt: null,
    },
  });
}

async function runPrimaryResumePipeline(params: {
  sessionId: string;
  userId: string;
  jobDescription: string;
  fallbackResumeData?: ResumeData;
  focusAreas?: string[];
  maxProjects?: number;
  artifactSeed?: SmartResumeArtifactSeed;
  onStepStart?: (step: SmartPipelineStep) => Promise<void> | void;
  onStepComplete?: (step: SmartPipelineStep, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const agentResult = await runResumeAgent({
    jobDescription: params.jobDescription,
    userId: params.userId,
    sessionId: params.sessionId,
    fallbackResumeData: params.fallbackResumeData,
    focusAreas: params.focusAreas,
    maxProjects: params.maxProjects,
    onStep: async (step) => {
      if (step.status === 'started') return;
      if (step.tool === 'parseJobDescription') {
        await params.onStepStart?.('jd_parsing');
        await params.onStepComplete?.('jd_parsing', {
          parsedJD: (step.data as { data?: { data?: { parsedJD?: unknown } } })?.data?.data?.parsedJD,
        });
      }
      if (step.tool === 'runLegacyPipeline') {
        const payload = (step.data as { data?: Record<string, unknown> })?.data ?? {};
        await params.onStepStart?.('ats_scoring');
        await params.onStepComplete?.('ats_scoring', payload);
      }
    },
  });

  if (agentResult.success) {
    return agentResult.data;
  }

  return generateSmartResumePipeline(params.jobDescription, {
    fallbackResumeData: params.fallbackResumeData,
    focusAreas: params.focusAreas,
    maxProjects: params.maxProjects,
    actorUserId: params.userId,
    actorSessionId: params.sessionId,
    artifactSeed: params.artifactSeed,
    onStepStart: params.onStepStart,
    onStepComplete: params.onStepComplete,
  });
}

export async function runGenerationSession(options: RunGenerationOptions): Promise<GenerationRunResult> {
  const session = await prisma.generationSession.findUnique({
    where: { id: options.sessionId },
    select: {
      id: true,
      userId: true,
      jobDescription: true,
      status: true,
      currentStep: true,
      parsedJD: true,
      matchedProjects: true,
      matchedAchievements: true,
      staticData: true,
      draftResume: true,
      resultResumeId: true,
      pdfUrl: true,
      atsScore: true,
      startedAt: true,
    },
  });

  if (!session || session.userId !== options.userId) {
    throw new Error('Generation session not found');
  }

  if (session.status === GenerationStatus.completed) {
    const finalResume = session.draftResume as ResumeData | null;
    return {
      sessionId: session.id,
      status: 'completed',
      resume: finalResume ?? undefined,
      resumeId: session.resultResumeId ?? undefined,
      atsEstimate: session.atsScore ?? undefined,
      pdfUrl: session.pdfUrl ?? undefined,
      reused: false,
    };
  }

  let activeStep = session.currentStep ?? PipelineStep.reuse_check;
  const template = options.templatePreference ?? 'ats-simple';

  try {
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.generating,
        errorMessage: null,
        errorStep: null,
        currentStep: activeStep,
      },
    });

    if (activeStep === PipelineStep.reuse_check) {
      const reuse = await maybeReuseExistingResume({
        userId: options.userId,
        sessionId: session.id,
        jobDescription: session.jobDescription,
      });

      if (reuse.reused && reuse.resumeId && reuse.resume) {
        const totals = await getSessionUsageTotals(session.id);
        await prisma.generationSession.update({
          where: { id: session.id },
          data: {
            status: GenerationStatus.completed,
            currentStep: PipelineStep.completed,
            resultResumeId: reuse.resumeId,
            draftResume: reuse.resume as unknown as Prisma.InputJsonValue,
            atsScore: reuse.atsEstimate ?? null,
            pdfBlobKey: reuse.pdfBlobKey ?? null,
            pdfUrl: reuse.pdfUrl ?? null,
            completedAt: new Date(),
            totalLatencyMs: Date.now() - session.startedAt.getTime(),
            totalTokensUsed: totals.totalTokensUsed,
            totalCostUsd: totals.totalCostUsd,
          },
        });

        return {
          sessionId: session.id,
          status: 'completed',
          resume: reuse.resume,
          resumeId: reuse.resumeId,
          atsEstimate: reuse.atsEstimate,
          pdfUrl: reuse.pdfUrl,
          reused: true,
        };
      }

      activeStep = PipelineStep.jd_parsing;
      await prisma.generationSession.update({
        where: { id: session.id },
        data: {
          currentStep: activeStep,
        },
      });
    }

    let pipelineResult = null as Awaited<ReturnType<typeof generateSmartResumePipeline>> | null;
    const artifactSeed: SmartResumeArtifactSeed = (
      session.parsedJD
      && session.matchedProjects
      && session.matchedAchievements
      && session.staticData
    ) ? {
      parsedJD: session.parsedJD,
      matchedProjects: session.matchedProjects,
      matchedAchievements: session.matchedAchievements,
      staticData: session.staticData,
    } as unknown as SmartResumeArtifactSeed : undefined;
    if (
      activeStep === PipelineStep.jd_parsing ||
      activeStep === PipelineStep.semantic_search ||
      activeStep === PipelineStep.static_data_load ||
      activeStep === PipelineStep.paraphrasing ||
      activeStep === PipelineStep.resume_assembly ||
      activeStep === PipelineStep.claim_validation ||
      activeStep === PipelineStep.ats_scoring
    ) {
      pipelineResult = await runPrimaryResumePipeline({
        jobDescription: session.jobDescription,
        fallbackResumeData: options.fallbackResumeData,
        focusAreas: options.focusAreas,
        maxProjects: options.maxProjects,
        userId: options.userId,
        sessionId: session.id,
        artifactSeed: activeStep === PipelineStep.paraphrasing
          || activeStep === PipelineStep.resume_assembly
          || activeStep === PipelineStep.claim_validation
          || activeStep === PipelineStep.ats_scoring
          ? artifactSeed
          : undefined,
        onStepStart: async (step) => {
          activeStep = toPipelineStep(step);
          await prisma.generationSession.update({
            where: { id: session.id },
            data: {
              currentStep: activeStep,
              status: GenerationStatus.generating,
            },
          });
        },
        onStepComplete: async (step, payload) => {
          activeStep = toPipelineStep(step);
          const nextStep = nextPipelineStep(step);
          await prisma.generationSession.update({
            where: { id: session.id },
            data: {
              ...(step === 'jd_parsing' ? { parsedJD: payload.parsedJD as Prisma.InputJsonValue } : {}),
              ...(step === 'semantic_search'
                ? {
                  matchedProjects: payload.matchedProjects as Prisma.InputJsonValue,
                  matchedAchievements: payload.matchedAchievements as Prisma.InputJsonValue,
                  matchedItems: {
                    projects: payload.matchedProjects,
                    knowledgeItems: payload.matchedAchievements,
                  } as Prisma.InputJsonValue,
                }
                : {}),
              ...(step === 'static_data_load' ? { staticData: payload.staticData as Prisma.InputJsonValue } : {}),
              ...(step === 'paraphrasing'
                ? { paraphrasedContent: payload.paraphrasedContent as Prisma.InputJsonValue }
                : {}),
              ...(step === 'resume_assembly' ? { draftResume: payload.draftResume as Prisma.InputJsonValue } : {}),
              ...(step === 'claim_validation'
                ? {
                  validationResult: payload.validationResult as Prisma.InputJsonValue,
                  draftResume: payload.draftResume as Prisma.InputJsonValue,
                }
                : {}),
              ...(step === 'ats_scoring'
                ? {
                  atsScore: typeof payload.atsScore === 'number' ? payload.atsScore : null,
                  validationResult: payload.validationResult as Prisma.InputJsonValue,
                  draftResume: payload.draftResume as Prisma.InputJsonValue,
                }
                : {}),
              currentStep: nextStep,
            },
          });
          activeStep = nextStep;
        },
      });
    }

    const draftResumeFromSession = await prisma.generationSession.findUnique({
      where: { id: session.id },
      select: {
        draftResume: true,
        atsScore: true,
        resultResumeId: true,
      },
    });

    const finalResume = (pipelineResult?.resume
      ?? (draftResumeFromSession?.draftResume as ResumeData | null)
      ?? null) as ResumeData | null;
    if (!finalResume) {
      throw new Error('No generated resume available to finalize session');
    }

    const resumeId = draftResumeFromSession?.resultResumeId
      ?? await saveGeneratedResumeForUser({
        userId: options.userId,
        resume: finalResume,
        atsEstimate: pipelineResult?.atsEstimate ?? draftResumeFromSession?.atsScore ?? undefined,
      });

    activeStep = PipelineStep.pdf_generation;
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        currentStep: PipelineStep.pdf_generation,
        resultResumeId: resumeId,
      },
    });

    const latex = generateLatexFromResume(finalResume, template);
    const compiled = await compileLatex(latex, {
      userId: options.userId,
      sessionId: session.id,
    });

    if (!compiled.success || !compiled.pdfBase64) {
      throw new Error(compiled.error || 'Failed to compile PDF');
    }

    const storedPdf = await persistStoredPdf({
      userId: options.userId,
      sessionId: session.id,
      resumeId,
      template,
      pdfBase64: compiled.pdfBase64,
    });

    const totals = await getSessionUsageTotals(session.id);
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.completed,
        currentStep: PipelineStep.completed,
        resultResumeId: resumeId,
        draftResume: finalResume as unknown as Prisma.InputJsonValue,
        atsScore: pipelineResult?.atsEstimate ?? draftResumeFromSession?.atsScore ?? null,
        validationResult: pipelineResult?.validation as unknown as Prisma.InputJsonValue,
        pdfBlobKey: storedPdf.blobKey,
        pdfUrl: storedPdf.blobUrl,
        completedAt: new Date(),
        totalLatencyMs: Date.now() - session.startedAt.getTime(),
        totalTokensUsed: totals.totalTokensUsed,
        totalCostUsd: totals.totalCostUsd,
      },
    });

    return {
      sessionId: session.id,
      status: 'completed',
      resume: finalResume,
      resumeId,
      atsEstimate: pipelineResult?.atsEstimate ?? draftResumeFromSession?.atsScore ?? undefined,
      pdfUrl: storedPdf.blobUrl,
      reused: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to run generation pipeline';
    await markFailure({
      sessionId: session.id,
      step: activeStep,
      message,
    });
    throw error;
  }
}

export async function retryGenerationSession(sessionId: string): Promise<GenerationRunResult> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Not authenticated');
  }

  const parsed = RetryGenerationSessionSchema.safeParse({ sessionId });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  return runGenerationSession({
    sessionId: parsed.data.sessionId,
    userId,
  });
}
