import { Channel, GenerationStatus, PipelineStep } from '@prisma/client';
import { enqueueGenerationSession } from '@/lib/generationQueue';
import { gateMeteredAction, refundMeteredAction } from '@/lib/entitlements';
import { getGenerationProgressPercent, getGenerationStageLabel } from '@/lib/generationProgress';
import { buildPdfDownloadUrl, findLatestGeneratedPdf } from '@/lib/pdfLinks';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import type {
  ExtensionResumeGenerateRequest,
  ExtensionResumeGenerateResponse,
  ExtensionWorkspaceSnapshot,
} from '@/lib/extension/schemas';
import { getExtensionWorkspace } from '@/lib/extension/workspaces';

function buildEditorUrl(resumeId: string): string {
  return `${config.app.url.replace(/\/$/, '')}/editor/${encodeURIComponent(resumeId)}`;
}

async function loadWorkspace(params: {
  userId: string;
  workspaceId: string;
}) {
  return prisma.applicationWorkspace.findFirst({
    where: {
      id: params.workspaceId,
      userId: params.userId,
    },
  });
}

async function upsertJobTarget(params: {
  userId: string;
  existingJobTargetId?: string | null;
  companyName?: string | null;
  roleTitle?: string | null;
  jobDescription: string;
}) {
  const payload = {
    company: params.companyName?.trim() || '',
    role: params.roleTitle?.trim() || '',
    description: params.jobDescription.trim(),
  };

  if (params.existingJobTargetId) {
    const existing = await prisma.jobTarget.findFirst({
      where: {
        id: params.existingJobTargetId,
        userId: params.userId,
      },
      select: { id: true },
    });

    if (existing) {
      const updated = await prisma.jobTarget.update({
        where: { id: existing.id },
        data: payload,
        select: { id: true },
      });
      return updated.id;
    }
  }

  const created = await prisma.jobTarget.create({
    data: {
      userId: params.userId,
      ...payload,
    },
    select: { id: true },
  });

  return created.id;
}

async function buildGenerationSessionStatus(params: {
  userId: string;
  sessionId: string;
}) {
  const session = await prisma.generationSession.findFirst({
    where: {
      id: params.sessionId,
      userId: params.userId,
    },
    select: {
      id: true,
      status: true,
      currentStep: true,
      atsScore: true,
      errorMessage: true,
      resultResumeId: true,
      startedAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  if (!session) {
    throw new Error('Generation session not found');
  }

  const latestPdf = await findLatestGeneratedPdf({
    userId: params.userId,
    sessionId: session.id,
    resumeId: session.resultResumeId,
  });

  return {
    id: session.id,
    status: session.status,
    currentStep: session.currentStep,
    stageLabel: getGenerationStageLabel(session.currentStep),
    progressPercent: getGenerationProgressPercent(session.currentStep),
    atsScore: session.atsScore,
    errorMessage: session.errorMessage,
    resumeId: session.resultResumeId,
    editorUrl: session.resultResumeId ? buildEditorUrl(session.resultResumeId) : undefined,
    pdfId: latestPdf?.id,
    pdfUrl: latestPdf ? buildPdfDownloadUrl(latestPdf.id) : undefined,
    elapsedMs: Math.max(0, Date.now() - session.startedAt.getTime()),
    startedAt: session.startedAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

async function syncWorkspaceWithSession(params: {
  userId: string;
  workspaceId: string;
  sessionId: string;
}): Promise<ExtensionWorkspaceSnapshot | undefined> {
  const status = await buildGenerationSessionStatus({
    userId: params.userId,
    sessionId: params.sessionId,
  });

  const updateData: {
    latestGenerationSessionId: string;
    selectedResumeId?: string | null;
    selectedGeneratedPdfId?: string | null;
  } = {
    latestGenerationSessionId: params.sessionId,
  };

  if (status.status === GenerationStatus.completed) {
    updateData.selectedResumeId = status.resumeId ?? null;
    updateData.selectedGeneratedPdfId = status.pdfId ?? null;
  }

  await prisma.applicationWorkspace.updateMany({
    where: {
      id: params.workspaceId,
      userId: params.userId,
    },
    data: updateData,
  });

  const response = await getExtensionWorkspace({
    userId: params.userId,
    workspaceId: params.workspaceId,
  });

  return response.workspace;
}

export async function startExtensionResumeGeneration(params: {
  userId: string;
  input: ExtensionResumeGenerateRequest;
}): Promise<ExtensionResumeGenerateResponse> {
  // Entitlement gate: one tailored-generation unit per initiated generation.
  // Throws EntitlementError (→ 402) when over quota and enforcement is on.
  await gateMeteredAction(params.userId, 'tailored_generation');

  const workspace = params.input.workspaceId
    ? await loadWorkspace({
      userId: params.userId,
      workspaceId: params.input.workspaceId,
    })
    : null;

  // Every terminal failure below refunds the unit consumed above (PRD 06 §8):
  // the gate runs at entry by convention, and a request that produces no
  // resume must not cost the user one of their generations.
  if (params.input.workspaceId && !workspace) {
    await refundMeteredAction(params.userId, 'tailored_generation');
    throw new Error('Application workspace not found');
  }

  const jobDescription = params.input.jobDescription?.trim()
    || workspace?.jobDescription?.trim()
    || '';
  if (jobDescription.length < 20) {
    await refundMeteredAction(params.userId, 'tailored_generation');
    throw new Error('A saved or parsed job description is required before generating a tailored resume.');
  }

  const companyName = params.input.companyName?.trim() || workspace?.companyName?.trim() || null;
  const roleTitle = params.input.roleTitle?.trim() || workspace?.roleTitle?.trim() || null;
  const sourceResumeId = params.input.sourceResumeId?.trim() || workspace?.selectedResumeId || null;

  const jobTargetId = await upsertJobTarget({
    userId: params.userId,
    existingJobTargetId: workspace?.linkedJobTargetId,
    companyName,
    roleTitle,
    jobDescription,
  });

  const session = await prisma.generationSession.create({
    data: {
      userId: params.userId,
      sourceResumeId,
      jobTargetId,
      channel: Channel.web,
      jobDescription,
      currentStep: PipelineStep.reuse_check,
      stepStartedAt: new Date(),
      status: GenerationStatus.generating,
    },
    select: { id: true },
  });

  if (workspace) {
    await prisma.applicationWorkspace.update({
      where: { id: workspace.id },
      data: {
        companyName,
        roleTitle,
        sourceUrl: params.input.sourceUrl?.trim() || workspace.sourceUrl,
        linkedJobTargetId: jobTargetId,
        latestGenerationSessionId: session.id,
      },
    });
  }

  try {
    await enqueueGenerationSession(session.id, { force: true });
  } catch (error: unknown) {
    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.failed,
        errorMessage: error instanceof Error ? error.message : 'Failed to enqueue resume generation',
      },
    });
    await refundMeteredAction(params.userId, 'tailored_generation');
    throw error;
  }

  const workspaceSnapshot = workspace
    ? await syncWorkspaceWithSession({
      userId: params.userId,
      workspaceId: workspace.id,
      sessionId: session.id,
    })
    : undefined;

  return {
    success: true,
    session: await buildGenerationSessionStatus({
      userId: params.userId,
      sessionId: session.id,
    }),
    workspace: workspaceSnapshot,
  };
}

export async function getExtensionGenerationStatus(params: {
  userId: string;
  sessionId: string;
  workspaceId?: string;
}): Promise<ExtensionResumeGenerateResponse> {
  const session = await buildGenerationSessionStatus({
    userId: params.userId,
    sessionId: params.sessionId,
  });

  const workspace = params.workspaceId
    ? await syncWorkspaceWithSession({
      userId: params.userId,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
    })
    : undefined;

  return {
    success: true,
    session,
    workspace,
  };
}
