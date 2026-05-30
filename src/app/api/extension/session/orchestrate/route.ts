import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireExtensionAuth, isExtensionAuthError } from '@/lib/extension/auth';

export const runtime = 'nodejs';
export const maxDuration = 15;

// Receives the live ApplicationSession blob from the extension's background
// worker and mirrors the multi-step state onto the associated
// ApplicationWorkspace. This is the server-side persistence layer for the
// per-tab session — so a user closing the browser tab does not lose progress.

const StepHistoryEntrySchema = z.object({
    stepIndex: z.number().int().min(0),
    url: z.string().max(3000),
    visitedAt: z.string(),
    pageKind: z.string().max(80),
    fieldsFilled: z.number().int().min(0).default(0),
    questionsAnswered: z.number().int().min(0).default(0),
});

const SessionSchema = z.object({
    id: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(255).nullable(),
    platform: z.string().max(40),
    startedAt: z.string(),
    lastActiveAt: z.string(),
    ttlExpiresAt: z.string(),
    origin: z.string().max(500),
    currentUrl: z.string().max(3000),
    step: z.object({
        index: z.number().int().min(0),
        total: z.number().int().min(0).nullable(),
        label: z.string().max(200).nullable(),
    }),
    history: z.array(StepHistoryEntrySchema).max(50),
});

const OrchestrateSchema = z.object({
    workspaceId: z.string().min(1).max(255).optional(),
    session: SessionSchema,
    pageSummary: z
        .object({
            url: z.string().max(3000),
            companyName: z.string().max(500).optional(),
            roleTitle: z.string().max(500).optional(),
            location: z.string().max(500).optional(),
            platform: z.string().max(40).optional(),
            pageKind: z.string().max(40).optional(),
        })
        .optional(),
});

export async function POST(req: NextRequest) {
    let userId: string;
    try {
        ({ userId } = await requireExtensionAuth(req));
    } catch (err) {
        if (isExtensionAuthError(err)) {
            return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
        }
        return NextResponse.json({ success: false, error: 'Auth error' }, { status: 500 });
    }

    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = OrchestrateSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            {
                success: false,
                error: parsed.error.issues.map((issue) => issue.message).join('; '),
            },
            { status: 400 }
        );
    }

    const { session, workspaceId, pageSummary } = parsed.data;

    // Locate or create the workspace. Prefer explicit workspaceId; otherwise
    // upsert by (userId, sourceUrl).
    let workspace = null as { id: string } | null;
    if (workspaceId) {
        workspace = await prisma.applicationWorkspace.findFirst({
            where: { id: workspaceId, userId },
            select: { id: true },
        });
    }
    if (!workspace) {
        workspace = await prisma.applicationWorkspace.upsert({
            where: {
                userId_sourceUrl: { userId, sourceUrl: session.currentUrl },
            },
            create: {
                userId,
                sourceUrl: session.currentUrl,
                sourcePlatform: pageSummary?.platform ?? session.platform,
                companyName: pageSummary?.companyName,
                roleTitle: pageSummary?.roleTitle ?? session.step.label ?? undefined,
                location: pageSummary?.location,
                applicationStatus: 'in_progress',
            },
            update: {
                sourcePlatform: pageSummary?.platform ?? session.platform,
                companyName: pageSummary?.companyName,
                roleTitle: pageSummary?.roleTitle ?? session.step.label ?? undefined,
                location: pageSummary?.location,
            },
            select: { id: true },
        });
    }

    const updated = await prisma.applicationWorkspace.update({
        where: { id: workspace.id },
        data: {
            activeSessionId: session.id,
            sessionState: session as unknown as Prisma.InputJsonValue,
            currentStepIndex: session.step.index,
            totalSteps: session.step.total ?? null,
            currentStepLabel: session.step.label ?? null,
            stepHistory: session.history as unknown as Prisma.InputJsonValue,
            lastViewedAt: new Date(),
        },
        select: {
            id: true,
            companyName: true,
            roleTitle: true,
            applicationStatus: true,
            currentStepIndex: true,
            totalSteps: true,
        },
    });

    return NextResponse.json({ success: true, workspace: updated });
}
