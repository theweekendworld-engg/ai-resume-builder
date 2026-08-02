'use server';

/**
 * Review packet, rubric and readiness server actions (PRD 03 §3, §4).
 *
 * Every one follows impl/00 §P-3 in this order:
 *   Clerk auth() -> feature flag -> zod parse -> gateMeteredAction (once, at
 *   entry) -> work -> FunnelEvent -> Result<T>.
 *
 * There is no business logic here on purpose. The pipeline lives in
 * `src/services/reviewPacket.ts` and `src/services/competency.ts`, both of which
 * take an explicit `userId` and are therefore testable against a real database
 * without standing up Clerk.
 */

import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { FrameworkSource, PacketStatus, PacketType, Tier, type Prisma } from '@prisma/client';
import { start } from 'workflow/api';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import {
    checkEntitlement,
    gateMeteredAction,
    getUserTier,
    isEntitlementError,
} from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';
import { track } from '@/lib/track';
import { getLogSummary, listEmployers } from '@/actions/wins';
import {
    createFramework,
    deleteFramework,
    getFramework,
    listFrameworks,
    parseFrameworkText,
    resolveTargetLevel,
    FrameworkShapeSchema,
    PATRONUS_DEFAULT_FRAMEWORK,
    type FrameworkShape,
    type FrameworkView,
} from '@/services/competency';
import {
    applyUserEdits,
    buildReadinessReport,
    initialProgress,
    loadPacketWins,
    parsePacketContent,
    parseUserEdits,
    readProgress,
    renderMarkdown,
    renderPlainText,
    type ExportOptions,
    type PacketAudience,
    type PacketContent,
    type PacketProgress,
    type PacketTypeValue,
    type PacketWin,
    type ReadinessReport,
} from '@/services/reviewPacket';
import { handleReviewPacketWorkflow } from '@/workflows/reviewPacket';

const FEATURE = { feature: 'review_packet' } as const;

// ───────────────────────────────────────────────────────────── schemas

const IsoDate = z.coerce.date();

const PacketTypeSchema = z.enum(['performance_review', 'promotion_case', 'self_appraisal', 'brag_doc']);
const AudienceSchema = z.enum(['manager', 'skip_level', 'self']);

const ScopeSchema = z
    .object({
        periodStart: IsoDate,
        periodEnd: IsoDate,
        type: PacketTypeSchema.default('performance_review'),
        audience: AudienceSchema.default('manager'),
        employerId: z.string().max(64).nullable().optional(),
        frameworkId: z.string().max(64).nullable().optional(),
        targetLevel: z.string().max(80).nullable().optional(),
    })
    .refine((value) => value.periodStart < value.periodEnd, {
        message: 'periodStart must be before periodEnd',
        path: ['periodStart'],
    });

const IdSchema = z.string().min(1).max(64);

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
}

async function requireAccess(): Promise<
    { ok: true; userId: string } | { ok: false; error: string; code: string }
> {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: 'Not signed in', code: 'unauthenticated' };
    // ADR-7: flag first, entitlement second. "Is it built and on for you" is a
    // different question from "are you allowed to use it".
    if (!(await isEnabled(userId, 'review_packet'))) {
        return { ok: false, error: 'Not available yet', code: 'not_found' };
    }
    return { ok: true, userId };
}

// ═══════════════════════════════════════════════════════════ 1. the scope screen

export type PacketScope = {
    periodStart: Date;
    periodEnd: Date;
    /** Live input count for the F1 footer. */
    confirmedWins: number;
    withEvidence: number;
    withNumbers: number;
    /** PRD §3.1: warn under 8, never block. */
    thin: boolean;
    employers: { id: string; name: string; role: string; current: boolean }[];
    frameworks: FrameworkView[];
    /** Free tier may generate a brag doc only (§8). */
    allowedTypes: PacketTypeValue[];
    tier: Tier;
    remaining: number;
    requiresUpgrade: boolean;
};

const ALL_PACKET_TYPES: PacketTypeValue[] = [
    'performance_review',
    'promotion_case',
    'self_appraisal',
    'brag_doc',
];

export async function getPacketScope(range: {
    periodStart: Date;
    periodEnd: Date;
}): Promise<Result<PacketScope>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = z
        .object({ periodStart: IsoDate, periodEnd: IsoDate })
        .safeParse(range);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    // Read Wins through the Work Log actions so the sensitivity and history
    // rules stay in exactly one place.
    const [summary, employers, frameworks, entitlement, tier] = await Promise.all([
        getLogSummary({ from: parsed.data.periodStart, to: parsed.data.periodEnd }),
        listEmployers(),
        listFrameworks({ userId: access.userId }),
        checkEntitlement(access.userId, 'review_packet'),
        getUserTier(access.userId),
    ]);

    if (!summary.success) return err(summary.error, summary.code);

    return ok({
        periodStart: parsed.data.periodStart,
        periodEnd: parsed.data.periodEnd,
        confirmedWins: summary.data.totalConfirmed,
        withEvidence: summary.data.withEvidence,
        withNumbers: summary.data.withImpact,
        thin: summary.data.totalConfirmed < 8,
        employers: employers.success ? employers.data : [],
        frameworks,
        allowedTypes: tier === Tier.free ? ['brag_doc'] : ALL_PACKET_TYPES,
        tier,
        remaining: Number.isFinite(entitlement.remaining) ? entitlement.remaining : Number.MAX_SAFE_INTEGER,
        requiresUpgrade: entitlement.requiresUpgrade,
    });
}

// ═══════════════════════════════════════════════════════════ 2. generate

/**
 * Production hands the run to the workflow runtime; local development runs the
 * same stages in-process.
 *
 * `start()` only has a runner on Vercel. Locally it accepts the call and
 * returns, and nothing ever executes — which is indistinguishable from success
 * at the call site and leaves the packet on `generating` forever.
 *
 * The previous dev branch tried to cover that by importing
 * `handleReviewPacketWorkflow` and awaiting it, which the SDK explicitly
 * forbids ("You attempted to execute workflow … directly"). The rejection went
 * into a `.catch()` that only logged, so packet generation had in fact never
 * worked outside production and nothing said so. Both halves now drive
 * {@link runReviewPacketStages}, so the only difference between environments
 * is durability, not behaviour.
 */
function shouldUseLocalInlineRun(): boolean {
    return process.env.NODE_ENV !== 'production';
}

async function runPacketInline(packetId: string): Promise<void> {
    const { runReviewPacketStages } = await import('@/workflows/reviewPacket');

    // Detached deliberately: the caller is a server action and the user is
    // watching the progress screen, which polls. Failures inside the stages
    // already mark the packet `failed` via `failPacketStep`.
    void runReviewPacketStages(packetId).catch((error: unknown) => {
        console.error('[actions/packets] inline packet run failed', {
            packetId,
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

export async function startPacket(input: {
    periodStart: Date;
    periodEnd: Date;
    type?: PacketTypeValue;
    audience?: PacketAudience;
    employerId?: string | null;
    frameworkId?: string | null;
    targetLevel?: string | null;
}): Promise<Result<{ packetId: string }>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = ScopeSchema.safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');
    const scope = parsed.data;

    // PRD §8: the free tier's single lifetime packet is a brag doc. Everything
    // else is the peak-intent paywall, and it is deliberately precise.
    const tier = await getUserTier(access.userId);
    if (tier === Tier.free && scope.type !== 'brag_doc') {
        return err(
            'A full review packet with the competency breakdown is part of the paid plan.',
            'entitlement_required',
        );
    }

    // §10: validate the target level against the framework at scope time rather
    // than generating against a level that is not on the ladder.
    if (scope.frameworkId && scope.targetLevel) {
        const framework = await getFramework({
            userId: access.userId,
            frameworkId: scope.frameworkId,
        });
        if (!framework) return err('Framework not found', 'not_found');
        const resolved = resolveTargetLevel(framework.levels, scope.targetLevel);
        if (!resolved.level) {
            return err(
                `"${scope.targetLevel}" is not a level in ${framework.name}. Pick one of: ${framework.levels
                    .map((level) => level.name)
                    .join(', ')}.`,
                'invalid_level',
            );
        }
        scope.targetLevel = resolved.level.key;
    }

    try {
        await gateMeteredAction(access.userId, 'review_packet');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    const packet = await prisma.reviewPacket.create({
        data: {
            userId: access.userId,
            type: scope.type as PacketType,
            status: PacketStatus.generating,
            periodStart: scope.periodStart,
            periodEnd: scope.periodEnd,
            employerId: scope.employerId ?? null,
            frameworkId: scope.frameworkId ?? null,
            targetLevel: scope.targetLevel ?? null,
            audience: scope.audience,
            content: { progress: initialProgress() } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    await track(access.userId, 'packet_started', {
        ...FEATURE,
        type: scope.type,
        periodDays: Math.round(
            (scope.periodEnd.getTime() - scope.periodStart.getTime()) / 86_400_000,
        ),
        hasFramework: Boolean(scope.frameworkId),
        targetLevel: scope.targetLevel ?? null,
    });

    try {
        if (shouldUseLocalInlineRun()) {
            await runPacketInline(packet.id);
        } else {
            await start(handleReviewPacketWorkflow, [packet.id]);
        }
    } catch (error) {
        await prisma.reviewPacket.updateMany({
            where: { id: packet.id },
            data: { status: PacketStatus.failed },
        });
        return err(
            error instanceof Error ? error.message : 'Could not start generation',
            'workflow_start_failed',
        );
    }

    return ok({ packetId: packet.id });
}

// ═══════════════════════════════════════════════════════════ 3. read

export type PacketView = {
    id: string;
    type: PacketTypeValue;
    status: PacketStatus;
    periodStart: Date;
    periodEnd: Date;
    audience: PacketAudience;
    frameworkId: string | null;
    targetLevel: string | null;
    wordCount: number;
    createdAt: Date;
    updatedAt: Date;
    progress: PacketProgress | null;
    /** Null while generating or on failure. Already has `userEdits` merged over it. */
    content: PacketContent | null;
    /** Every Win the packet drew on, for the hover-to-source affordance. */
    wins: PacketWin[];
    /** §8: the free tier sees real competency names, values locked. */
    competencyLocked: boolean;
};

function packetTypeOf(value: PacketType): PacketTypeValue {
    return value as PacketTypeValue;
}

export async function getPacket(packetId: string): Promise<Result<PacketView>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsedId = IdSchema.safeParse(packetId);
    if (!parsedId.success) return err('Invalid packet id', 'invalid_input');

    const row = await prisma.reviewPacket.findFirst({
        where: { id: parsedId.data, userId: access.userId },
    });
    if (!row) return err('Packet not found', 'not_found');

    const raw = parsePacketContent(row.content);
    const edits = parseUserEdits(row.userEdits);
    const content = raw ? applyUserEdits(raw, edits) : null;

    const wins = content
        ? (
            await loadPacketWins({
                userId: access.userId,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                employerId: row.employerId,
            })
        ).filter((win) => content.appendix.winIds.includes(win.id))
        : [];

    const tier = await getUserTier(access.userId);

    return ok({
        id: row.id,
        type: packetTypeOf(row.type),
        status: row.status,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        audience: row.audience as PacketAudience,
        frameworkId: row.frameworkId,
        targetLevel: row.targetLevel,
        wordCount: row.wordCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        progress: readProgress(row.content),
        content,
        wins,
        competencyLocked: tier === Tier.free,
    });
}

export type PacketSummary = {
    id: string;
    type: PacketTypeValue;
    status: PacketStatus;
    periodStart: Date;
    periodEnd: Date;
    wordCount: number;
    createdAt: Date;
};

export async function listPackets(): Promise<Result<PacketSummary[]>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const rows = await prisma.reviewPacket.findMany({
        where: { userId: access.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
            id: true,
            type: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            wordCount: true,
            createdAt: true,
        },
    });

    return ok(rows.map((row) => ({ ...row, type: packetTypeOf(row.type) })));
}

/**
 * The generation screen polls this. Same semantics as the resume SSE route — a
 * database poll — expressed as an action so the progress state a refresh reads
 * is exactly the state the workflow wrote.
 */
export async function getPacketProgress(
    packetId: string,
): Promise<Result<{ status: PacketStatus; progress: PacketProgress | null }>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsedId = IdSchema.safeParse(packetId);
    if (!parsedId.success) return err('Invalid packet id', 'invalid_input');

    const row = await prisma.reviewPacket.findFirst({
        where: { id: parsedId.data, userId: access.userId },
        select: { status: true, content: true },
    });
    if (!row) return err('Packet not found', 'not_found');

    return ok({ status: row.status, progress: readProgress(row.content) });
}

// ═══════════════════════════════════════════════════════════ 4. editing

/**
 * Block edits are stored as `userEdits` overrides rather than written into
 * `content`, so regeneration can offer "keep my edits" without a diff (§3.3).
 */
export async function editPacketBlock(
    packetId: string,
    blockKey: string,
    text: string,
): Promise<Result<PacketView>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = z
        .object({
            packetId: IdSchema,
            blockKey: z.string().min(1).max(120),
            text: z.string().max(8_000),
        })
        .safeParse({ packetId, blockKey, text });
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const row = await prisma.reviewPacket.findFirst({
        where: { id: parsed.data.packetId, userId: access.userId },
        select: { id: true, userEdits: true },
    });
    if (!row) return err('Packet not found', 'not_found');

    const edits = parseUserEdits(row.userEdits);
    edits[parsed.data.blockKey] = parsed.data.text;

    await prisma.reviewPacket.update({
        where: { id: row.id },
        data: { userEdits: edits as unknown as Prisma.InputJsonValue },
    });

    return getPacket(row.id);
}

export async function revertPacketBlock(
    packetId: string,
    blockKey: string,
): Promise<Result<PacketView>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const row = await prisma.reviewPacket.findFirst({
        where: { id: packetId, userId: access.userId },
        select: { id: true, userEdits: true },
    });
    if (!row) return err('Packet not found', 'not_found');

    const edits = parseUserEdits(row.userEdits);
    delete edits[blockKey];

    await prisma.reviewPacket.update({
        where: { id: row.id },
        data: { userEdits: edits as unknown as Prisma.InputJsonValue },
    });

    return getPacket(row.id);
}

/**
 * Regeneration. `keepEdits` (the default) merges the existing `userEdits` over
 * the new content by block key; "start fresh" discards them.
 *
 * Regenerating does NOT consume another `review_packet` unit — the quota is
 * per packet, and a redo of a packet the user already paid for is not a second
 * packet (§8).
 */
export async function regeneratePacket(
    packetId: string,
    options?: { keepEdits?: boolean },
): Promise<Result<{ packetId: string }>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const row = await prisma.reviewPacket.findFirst({
        where: { id: packetId, userId: access.userId },
        select: { id: true, status: true },
    });
    if (!row) return err('Packet not found', 'not_found');
    if (row.status === PacketStatus.generating) return err('Already generating', 'conflict');

    await prisma.reviewPacket.update({
        where: { id: row.id },
        data: {
            status: PacketStatus.generating,
            content: { progress: initialProgress() } as unknown as Prisma.InputJsonValue,
            ...(options?.keepEdits === false ? { userEdits: {} as Prisma.InputJsonValue } : {}),
        },
    });

    try {
        if (shouldUseLocalInlineRun()) {
            await runPacketInline(row.id);
        } else {
            await start(handleReviewPacketWorkflow, [row.id]);
        }
    } catch (error) {
        await prisma.reviewPacket.updateMany({
            where: { id: row.id },
            data: { status: PacketStatus.failed },
        });
        return err(
            error instanceof Error ? error.message : 'Could not start generation',
            'workflow_start_failed',
        );
    }

    return ok({ packetId: row.id });
}

export async function deletePacket(packetId: string): Promise<Result<void>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const result = await prisma.reviewPacket.deleteMany({
        where: { id: packetId, userId: access.userId },
    });
    return result.count > 0 ? ok(undefined) : err('Packet not found', 'not_found');
}

// ═══════════════════════════════════════════════════════════ 5. export

export type PacketExportFormat = 'markdown' | 'text';

export async function exportPacket(
    packetId: string,
    format: PacketExportFormat,
    options?: { includeConfidential?: boolean },
): Promise<Result<{ format: PacketExportFormat; body: string; filename: string }>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = z
        .object({
            packetId: IdSchema,
            format: z.enum(['markdown', 'text']),
            includeConfidential: z.boolean().optional(),
        })
        .safeParse({ packetId, format, includeConfidential: options?.includeConfidential });
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const view = await getPacket(parsed.data.packetId);
    if (!view.success) return err(view.error, view.code);
    if (!view.data.content) return err('Packet is not ready yet', 'not_ready');

    // §3.3: default include for a manager audience, default exclude when the
    // packet is for the user themselves.
    const includeConfidential =
        parsed.data.includeConfidential ?? view.data.audience !== 'self';

    const exportOptions: ExportOptions = { includeConfidential };
    const body =
        parsed.data.format === 'markdown'
            ? renderMarkdown(view.data.content, view.data.wins, exportOptions)
            : renderPlainText(view.data.content, view.data.wins, exportOptions);

    const stamp = view.data.periodEnd.toISOString().slice(0, 7);
    const filename = `${view.data.type}-${stamp}.${parsed.data.format === 'markdown' ? 'md' : 'txt'}`;

    const row = await prisma.reviewPacket.findFirst({
        where: { id: parsed.data.packetId, userId: access.userId },
        select: { exports: true },
    });
    const history = Array.isArray(row?.exports) ? row.exports : [];
    await prisma.reviewPacket.updateMany({
        where: { id: parsed.data.packetId, userId: access.userId },
        data: {
            exports: [
                ...history,
                { format: parsed.data.format, at: new Date().toISOString(), includeConfidential },
            ].slice(-20) as unknown as Prisma.InputJsonValue,
        },
    });

    await track(access.userId, 'packet_exported', {
        ...FEATURE,
        format: parsed.data.format,
        includedConfidential: includeConfidential,
    });

    return ok({ format: parsed.data.format, body, filename });
}

/**
 * Record a PDF export.
 *
 * PDF does not go through `exportPacket` because it has no body to return —
 * the browser makes the file from the print route, so there is nothing for a
 * server action to hand back. What there still is, is the audit trail: §3.3
 * remembers the confidential choice per packet, and a packet that went to a
 * manager as a PDF should be as visible in `exports` as one that went as
 * markdown. Without this the history would quietly under-report.
 *
 * Idempotency is deliberately NOT enforced. Re-opening the print view is a
 * second export — the user is producing another copy, possibly with a
 * different confidential setting, and that is worth a second row.
 */
export async function recordPdfExport(
    packetId: string,
    includeConfidential: boolean,
): Promise<Result<void>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = z
        .object({ packetId: IdSchema, includeConfidential: z.boolean() })
        .safeParse({ packetId, includeConfidential });
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const row = await prisma.reviewPacket.findFirst({
        where: { id: parsed.data.packetId, userId: access.userId },
        select: { exports: true },
    });
    if (!row) return err('Packet not found', 'not_found');

    const history = Array.isArray(row.exports) ? row.exports : [];
    await prisma.reviewPacket.updateMany({
        where: { id: parsed.data.packetId, userId: access.userId },
        data: {
            exports: [
                ...history,
                {
                    format: 'pdf',
                    at: new Date().toISOString(),
                    includeConfidential: parsed.data.includeConfidential,
                },
            ].slice(-20) as unknown as Prisma.InputJsonValue,
        },
    });

    await track(access.userId, 'packet_exported', {
        ...FEATURE,
        format: 'pdf',
        includedConfidential: parsed.data.includeConfidential,
    });

    return ok(undefined);
}

// ═══════════════════════════════════════════════════════════ 6. rubrics

export type FrameworkDraft = {
    /** Client-side handle; nothing is persisted until the user confirms. */
    draftId: string;
    shape: FrameworkShape;
    degraded: boolean;
};

const MAX_RUBRIC_CHARS = 60_000;

/**
 * Parse a pasted rubric into a **draft**. Deliberately writes nothing: the
 * confirmation screen is mandatory, and the cheapest way to guarantee we never
 * generate against an unconfirmed framework is to have no row to generate
 * against (§4.1, §10).
 */
export async function parseRubric(input: {
    text: string;
    companyName?: string | null;
}): Promise<Result<FrameworkDraft>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = z
        .object({
            text: z.string().min(40).max(MAX_RUBRIC_CHARS),
            companyName: z.string().max(120).nullable().optional(),
        })
        .safeParse(input);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    try {
        await gateMeteredAction(access.userId, 'rubric_upload');
    } catch (error) {
        if (isEntitlementError(error)) return err(error.message, 'entitlement_required');
        throw error;
    }

    try {
        const result = await parseFrameworkText({
            userId: access.userId,
            text: parsed.data.text,
            companyName: parsed.data.companyName ?? null,
        });
        return ok({ draftId: randomUUID(), shape: result.shape, degraded: result.degraded });
    } catch (error) {
        console.error('[actions/packets] parseRubric failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return err('Could not read that document — try pasting the text instead', 'ai_unavailable');
    }
}

/** The confirmation screen's "Looks right". The only write path for a rubric. */
export async function confirmRubric(shape: FrameworkShape): Promise<Result<FrameworkView>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const parsed = FrameworkShapeSchema.safeParse(shape);
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const framework = await createFramework({
        userId: access.userId,
        shape: parsed.data,
        sourceType: FrameworkSource.uploaded,
    });
    return ok(framework);
}

/** Adopt one of the seeded public ladders, or the Patronus default, as your own. */
export async function adoptFramework(templateId: string | null): Promise<Result<FrameworkView>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    if (templateId === null) {
        const framework = await createFramework({
            userId: access.userId,
            shape: PATRONUS_DEFAULT_FRAMEWORK,
            sourceType: FrameworkSource.default,
        });
        return ok(framework);
    }

    const template = await getFramework({ userId: access.userId, frameworkId: templateId });
    if (!template) return err('Framework not found', 'not_found');

    const framework = await createFramework({
        userId: access.userId,
        shape: {
            name: template.name,
            companyName: template.companyName,
            levels: template.levels,
            competencies: template.competencies,
        },
        sourceType: FrameworkSource.template,
    });
    return ok(framework);
}

export async function listFrameworkOptions(): Promise<Result<FrameworkView[]>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);
    return ok(await listFrameworks({ userId: access.userId }));
}

export async function removeFramework(frameworkId: string): Promise<Result<void>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const removed = await deleteFramework({ userId: access.userId, frameworkId });
    return removed ? ok(undefined) : err('Framework not found', 'not_found');
}

// ═══════════════════════════════════════════════════════════ 7. readiness

const READINESS_CACHE_MS = 15 * 60_000;

type CacheEntry = { at: number; report: ReadinessReport };
const readinessCache = new Map<string, CacheEntry>();

function cacheKey(userId: string, input: { frameworkId?: string | null; targetLevel?: string | null; periodStart: Date; periodEnd: Date }): string {
    return [
        userId,
        input.frameworkId ?? 'default',
        input.targetLevel ?? 'none',
        input.periodStart.toISOString(),
        input.periodEnd.toISOString(),
    ].join('|');
}

/**
 * The standalone readiness report. Available year-round, independent of review
 * season — which is the whole point of it (§4.3).
 *
 * Cached for 15 minutes per §6: the report is computed on demand from Wins plus
 * the framework, and is not a stored model.
 */
export async function getReadiness(input: {
    frameworkId?: string | null;
    targetLevel?: string | null;
    periodStart?: Date;
    periodEnd?: Date;
    employerId?: string | null;
}): Promise<Result<ReadinessReport>> {
    const access = await requireAccess();
    if (!access.ok) return err(access.error, access.code);

    const now = new Date();
    const parsed = z
        .object({
            frameworkId: z.string().max(64).nullable().optional(),
            targetLevel: z.string().max(80).nullable().optional(),
            periodStart: IsoDate.optional(),
            periodEnd: IsoDate.optional(),
            employerId: z.string().max(64).nullable().optional(),
        })
        .safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const periodEnd = parsed.data.periodEnd ?? now;
    const periodStart =
        parsed.data.periodStart ?? new Date(periodEnd.getTime() - 182 * 86_400_000);

    const key = cacheKey(access.userId, { ...parsed.data, periodStart, periodEnd });
    const cached = readinessCache.get(key);
    if (cached && now.getTime() - cached.at < READINESS_CACHE_MS) {
        return ok(cached.report);
    }

    const report = await buildReadinessReport({
        userId: access.userId,
        frameworkId: parsed.data.frameworkId ?? null,
        targetLevel: parsed.data.targetLevel ?? null,
        periodStart,
        periodEnd,
        employerId: parsed.data.employerId ?? null,
    });

    readinessCache.set(key, { at: now.getTime(), report });

    await track(access.userId, 'readiness_viewed', {
        ...FEATURE,
        targetLevel: report.targetLevelName,
        absentCount: report.competencies.filter((item) => item.verdict === 'absent').length,
        thinCount: report.competencies.filter((item) => item.verdict === 'thin').length,
        foundUnlogged: report.unloggedEvidence?.count ?? 0,
    });

    return ok(report);
}
