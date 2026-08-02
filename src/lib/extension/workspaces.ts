import { ApplicationStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  ExtensionWorkspaceResponse,
  ExtensionWorkspaceSnapshot,
  ExtensionWorkspaceUpsertRequest,
} from '@/lib/extension/schemas';

const STATUS_RANK: Record<string, number> = {
  discovered: 0,
  analyzed: 1,
  in_progress: 2,
  applied: 3,
  archived: 4,
};

function toNullableJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function chooseString(nextValue?: string | null, currentValue?: string | null) {
  const trimmed = typeof nextValue === 'string' ? nextValue.trim() : '';
  if (trimmed) return trimmed;
  return currentValue ?? null;
}

function chooseStatus(nextStatus?: string | null, currentStatus?: string | null): ApplicationStatus {
  const nextRank = STATUS_RANK[nextStatus ?? ''] ?? -1;
  const currentRank = STATUS_RANK[currentStatus ?? ''] ?? -1;
  const chosen = nextRank >= currentRank
    ? (nextStatus ?? currentStatus ?? 'discovered')
    : (currentStatus ?? 'discovered');
  // STATUS_RANK keys are all valid ApplicationStatus members; default covers the rest.
  return (chosen in ApplicationStatus ? chosen : 'discovered') as ApplicationStatus;
}

async function formatWorkspaceSnapshot(workspaceId: string): Promise<ExtensionWorkspaceSnapshot> {
  const workspace = await prisma.applicationWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      _count: {
        select: {
          questions: true,
        },
      },
      questions: {
        select: {
          finalAnswer: true,
        },
      },
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const answeredQuestionCount = workspace.questions.filter((question) => Boolean(question.finalAnswer?.trim())).length;

  return {
    id: workspace.id,
    userId: workspace.userId,
    sourcePlatform: workspace.sourcePlatform as ExtensionWorkspaceSnapshot['sourcePlatform'],
    sourceUrl: workspace.sourceUrl,
    companyName: workspace.companyName,
    roleTitle: workspace.roleTitle,
    location: workspace.location,
    employmentType: workspace.employmentType,
    compensationText: workspace.compensationText,
    jobDescription: workspace.jobDescription,
    applicationStatus: workspace.applicationStatus as ExtensionWorkspaceSnapshot['applicationStatus'],
    fitScore: workspace.fitScore,
    fitSummary: workspace.fitSummary,
    companySnapshot: workspace.companySnapshot,
    linkedJobTargetId: workspace.linkedJobTargetId,
    latestGenerationSessionId: workspace.latestGenerationSessionId,
    selectedResumeId: workspace.selectedResumeId,
    selectedGeneratedPdfId: workspace.selectedGeneratedPdfId,
    questionCount: workspace._count.questions,
    answeredQuestionCount,
    lastViewedAt: workspace.lastViewedAt?.toISOString() ?? null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

async function findMatchingWorkspace(userId: string, input: ExtensionWorkspaceUpsertRequest) {
  if (input.workspaceId) {
    const byId = await prisma.applicationWorkspace.findFirst({
      where: {
        id: input.workspaceId,
        userId,
      },
      select: { id: true },
    });
    if (byId) return { id: byId.id, matchedBy: 'id' as const };
  }

  const byUrl = await prisma.applicationWorkspace.findFirst({
    where: {
      userId,
      sourceUrl: input.sourceUrl,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (byUrl) return { id: byUrl.id, matchedBy: 'source_url' as const };

  if (input.companyName?.trim() && input.roleTitle?.trim()) {
    const byCompanyRole = await prisma.applicationWorkspace.findFirst({
      where: {
        userId,
        companyName: input.companyName.trim(),
        roleTitle: input.roleTitle.trim(),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (byCompanyRole) return { id: byCompanyRole.id, matchedBy: 'company_role' as const };
  }

  return null;
}

export async function upsertExtensionWorkspace(params: {
  userId: string;
  input: ExtensionWorkspaceUpsertRequest;
}): Promise<ExtensionWorkspaceResponse> {
  const match = await findMatchingWorkspace(params.userId, params.input);

  if (match) {
    const existing = await prisma.applicationWorkspace.findUnique({
      where: { id: match.id },
    });

    if (!existing) {
      throw new Error('Workspace not found');
    }

    const updated = await prisma.applicationWorkspace.update({
      where: { id: existing.id },
      data: {
        sourcePlatform: params.input.sourcePlatform ?? existing.sourcePlatform,
        sourceUrl: match.matchedBy === 'company_role' ? existing.sourceUrl : (params.input.sourceUrl || existing.sourceUrl),
        companyName: chooseString(params.input.companyName, existing.companyName),
        roleTitle: chooseString(params.input.roleTitle, existing.roleTitle),
        location: chooseString(params.input.location, existing.location),
        employmentType: chooseString(params.input.employmentType, existing.employmentType),
        compensationText: chooseString(params.input.compensationText, existing.compensationText),
        jobDescription: chooseString(params.input.jobDescription, existing.jobDescription),
        applicationStatus: chooseStatus(params.input.applicationStatus, existing.applicationStatus),
        fitScore: typeof params.input.fitScore === 'number' ? params.input.fitScore : existing.fitScore,
        fitSummary: chooseString(params.input.fitSummary, existing.fitSummary),
        companySnapshot: params.input.companySnapshot !== undefined
          ? toNullableJsonInput(params.input.companySnapshot)
          : toNullableJsonInput(existing.companySnapshot),
        linkedJobTargetId: chooseString(params.input.linkedJobTargetId, existing.linkedJobTargetId),
        latestGenerationSessionId: chooseString(params.input.latestGenerationSessionId, existing.latestGenerationSessionId),
        selectedResumeId: chooseString(params.input.selectedResumeId, existing.selectedResumeId),
        selectedGeneratedPdfId: chooseString(params.input.selectedGeneratedPdfId, existing.selectedGeneratedPdfId),
        lastViewedAt: new Date(),
      },
      select: { id: true },
    });

    return {
      success: true,
      workspace: await formatWorkspaceSnapshot(updated.id),
      matchedBy: match.matchedBy,
    };
  }

  const created = await prisma.applicationWorkspace.create({
    data: {
      userId: params.userId,
      sourcePlatform: params.input.sourcePlatform,
      sourceUrl: params.input.sourceUrl,
      companyName: params.input.companyName?.trim() || null,
      roleTitle: params.input.roleTitle?.trim() || null,
      location: params.input.location?.trim() || null,
      employmentType: params.input.employmentType?.trim() || null,
      compensationText: params.input.compensationText?.trim() || null,
      jobDescription: params.input.jobDescription?.trim() || null,
      applicationStatus: params.input.applicationStatus ?? 'discovered',
      fitScore: params.input.fitScore,
      fitSummary: params.input.fitSummary?.trim() || null,
      companySnapshot: toNullableJsonInput(params.input.companySnapshot),
      linkedJobTargetId: params.input.linkedJobTargetId?.trim() || null,
      latestGenerationSessionId: params.input.latestGenerationSessionId?.trim() || null,
      selectedResumeId: params.input.selectedResumeId?.trim() || null,
      selectedGeneratedPdfId: params.input.selectedGeneratedPdfId?.trim() || null,
      lastViewedAt: new Date(),
    },
    select: { id: true },
  });

  return {
    success: true,
    workspace: await formatWorkspaceSnapshot(created.id),
    matchedBy: 'created',
  };
}

export type ExtensionWorkspaceListItem = {
  id: string;
  sourceUrl: string;
  sourcePlatform: string | null;
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  applicationStatus: ApplicationStatus;
  fitScore: number | null;
  questionCount: number;
  answeredQuestionCount: number;
  selectedResumeId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type ExtensionWorkspaceListResponse = {
  success: boolean;
  workspaces: ExtensionWorkspaceListItem[];
};

/**
 * List the user's application workspaces for the extension inbox. Mirrors the
 * web dashboard's `listApplicationWorkspaces` (src/actions/dashboard.ts) but
 * scoped to extension auth and serialized with ISO date strings.
 */
export async function listExtensionWorkspaces(params: {
  userId: string;
  limit?: number;
}): Promise<ExtensionWorkspaceListResponse> {
  const workspaces = await prisma.applicationWorkspace.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(params.limit ?? 25, 1), 100),
    include: {
      _count: { select: { questions: true } },
      questions: { select: { finalAnswer: true } },
    },
  });

  return {
    success: true,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      sourceUrl: workspace.sourceUrl,
      sourcePlatform: workspace.sourcePlatform,
      companyName: workspace.companyName,
      roleTitle: workspace.roleTitle,
      location: workspace.location,
      applicationStatus: workspace.applicationStatus,
      fitScore: workspace.fitScore,
      questionCount: workspace._count.questions,
      answeredQuestionCount: workspace.questions.filter((q) => Boolean(q.finalAnswer?.trim())).length,
      selectedResumeId: workspace.selectedResumeId,
      updatedAt: workspace.updatedAt.toISOString(),
      createdAt: workspace.createdAt.toISOString(),
    })),
  };
}

export async function getExtensionWorkspace(params: {
  userId: string;
  workspaceId: string;
}): Promise<ExtensionWorkspaceResponse> {
  const workspace = await prisma.applicationWorkspace.findFirst({
    where: {
      id: params.workspaceId,
      userId: params.userId,
    },
    select: { id: true },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  await prisma.applicationWorkspace.update({
    where: { id: workspace.id },
    data: {
      lastViewedAt: new Date(),
    },
  });

  return {
    success: true,
    workspace: await formatWorkspaceSnapshot(workspace.id),
    matchedBy: 'id',
  };
}
