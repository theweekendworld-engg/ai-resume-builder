/**
 * Review packet generation, one durable step per stage (PRD 03 §3.1).
 *
 * The `workflow` SDK rather than the Postgres job queue because this is a
 * user-watched 30–60s run: the person is sitting on the progress screen, and a
 * refresh must not lose it. Each step is separately retryable, and every step
 * both reads its inputs from and writes its outputs to the database — so a
 * crash between two model calls costs one call, not the whole packet.
 *
 * Intermediate state lives in `ReviewPacket.content.draft` because the schema is
 * orchestrator-owned and a `ReviewPacket` has nowhere else to keep it. It is
 * replaced by the finished content on the last step.
 */

import { PacketStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { track } from '@/lib/track';
import {
    assessCompetencies,
    getFramework,
    mapWinsToCompetencies,
    PATRONUS_DEFAULT_FRAMEWORK,
    priorMappings,
    resolveTargetLevel,
    type CompetencyAssessment,
    type FrameworkLevel,
    type FrameworkView,
    type WinCompetencyMapping,
} from '@/services/competency';
import {
    advanceProgress,
    assemblePacket,
    composePacketProse,
    countWords,
    groupWinsIntoThemes,
    initialProgress,
    loadPacketWins,
    readProgress,
    runTruthfulnessPass,
    selectPacketWins,
    writeProgress,
    type Composition,
    type PacketAudience,
    type PacketProgress,
    type PacketTypeValue,
    type PacketWin,
    type RawTheme,
    type ThemeGrouping,
} from '@/services/reviewPacket';

// ─────────────────────────────────────────────────────────── draft state

type SerializedComposition = {
    summary: string;
    themeOutcomes: { index: number; outcomeSentence: string; impact: string | null }[];
    growth: string;
};

type PacketDraft = {
    winIds: string[];
    omitted: number;
    employerName: string | null;
    grouping: ThemeGrouping | null;
    mappings: WinCompetencyMapping[];
    assessments: CompetencyAssessment[];
    composition: SerializedComposition | null;
    costUsd: number;
    startedAt: number;
};

function emptyDraft(): PacketDraft {
    return {
        winIds: [],
        omitted: 0,
        employerName: null,
        grouping: null,
        mappings: [],
        assessments: [],
        composition: null,
        costUsd: 0,
        startedAt: Date.now(),
    };
}

type PacketRow = {
    id: string;
    userId: string;
    type: PacketTypeValue;
    status: PacketStatus;
    periodStart: Date;
    periodEnd: Date;
    employerId: string | null;
    frameworkId: string | null;
    targetLevel: string | null;
    audience: string;
    content: Prisma.JsonValue | null;
    costUsd: number;
};

async function loadPacket(packetId: string): Promise<PacketRow | null> {
    const row = await prisma.reviewPacket.findUnique({
        where: { id: packetId },
        select: {
            id: true,
            userId: true,
            type: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            employerId: true,
            frameworkId: true,
            targetLevel: true,
            audience: true,
            content: true,
            costUsd: true,
        },
    });
    return row as PacketRow | null;
}

function readDraft(content: Prisma.JsonValue | null): PacketDraft {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return emptyDraft();
    const draft = (content as Record<string, unknown>).draft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return emptyDraft();
    return { ...emptyDraft(), ...(draft as Partial<PacketDraft>) } as PacketDraft;
}

async function writeDraft(
    packetId: string,
    draft: PacketDraft,
    progress: PacketProgress,
): Promise<void> {
    await prisma.reviewPacket.updateMany({
        where: { id: packetId },
        data: {
            content: { draft, progress } as unknown as Prisma.InputJsonValue,
            winIds: draft.winIds as unknown as Prisma.InputJsonValue,
        },
    });
}

async function currentProgress(packetId: string): Promise<PacketProgress> {
    const row = await prisma.reviewPacket.findUnique({
        where: { id: packetId },
        select: { content: true },
    });
    return readProgress(row?.content) ?? initialProgress();
}

/**
 * Re-reads the Wins through the same log query the packet was built from, then
 * narrows to the exact ids recorded at scope time. Every step needs the Wins and
 * none of them may re-select — a packet is reproducible or it is not a packet.
 */
async function loadDraftWins(packet: PacketRow, draft: PacketDraft): Promise<PacketWin[]> {
    const all = await loadPacketWins({
        userId: packet.userId,
        periodStart: packet.periodStart,
        periodEnd: packet.periodEnd,
        employerId: packet.employerId,
    });
    const wanted = new Set(draft.winIds);
    const selected = all.filter((win) => wanted.has(win.id));
    return selected.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

async function resolveFramework(packet: PacketRow): Promise<{
    framework: FrameworkView | null;
    shape: Pick<FrameworkView, 'name' | 'levels' | 'competencies'>;
    level: FrameworkLevel | null;
}> {
    const framework = packet.frameworkId
        ? await getFramework({ userId: packet.userId, frameworkId: packet.frameworkId })
        : null;
    const shape = framework ?? PATRONUS_DEFAULT_FRAMEWORK;
    const { level } = resolveTargetLevel(shape.levels, packet.targetLevel);
    return { framework, shape, level };
}

// ═════════════════════════════════════════════════════════ 1. read wins

export async function readWinsStep(packetId: string): Promise<void> {
    'use step';

    const packet = await loadPacket(packetId);
    if (!packet) return;

    let progress = advanceProgress(initialProgress(), 'read', { status: 'active' });
    await writeProgress(packetId, progress);

    const all = await loadPacketWins({
        userId: packet.userId,
        periodStart: packet.periodStart,
        periodEnd: packet.periodEnd,
        employerId: packet.employerId,
    });
    const { selected, omitted } = selectPacketWins(all, packet.periodEnd);

    const draft: PacketDraft = {
        ...emptyDraft(),
        winIds: selected.map((win) => win.id),
        omitted,
        employerName: selected.find((win) => win.employerName)?.employerName ?? null,
    };

    progress = advanceProgress(progress, 'read', {
        status: 'done',
        result: `${selected.length} win${selected.length === 1 ? '' : 's'}${omitted > 0 ? ` (top ${selected.length} of ${selected.length + omitted})` : ''}`,
    });

    await writeDraft(packetId, draft, progress);
}

// ═════════════════════════════════════════════════════════ 2. themes

export async function groupThemesStep(packetId: string): Promise<void> {
    'use step';

    const packet = await loadPacket(packetId);
    if (!packet) return;

    const draft = readDraft(packet.content);
    let progress = advanceProgress(await currentProgress(packetId), 'themes', { status: 'active' });
    await writeProgress(packetId, progress);

    const wins = await loadDraftWins(packet, draft);
    const grouping = await groupWinsIntoThemes({ userId: packet.userId, wins, sessionId: packetId });

    progress = advanceProgress(progress, 'themes', {
        status: 'done',
        result: `found ${grouping.themes.length} theme${grouping.themes.length === 1 ? '' : 's'}`,
    });

    await writeDraft(
        packetId,
        { ...draft, grouping, costUsd: draft.costUsd + grouping.costUsd },
        progress,
    );
}

// ═════════════════════════════════════════════════════════ 3. mapping

export async function mapCompetenciesStep(packetId: string): Promise<void> {
    'use step';

    const packet = await loadPacket(packetId);
    if (!packet) return;

    const draft = readDraft(packet.content);
    let progress = advanceProgress(await currentProgress(packetId), 'map', { status: 'active' });
    await writeProgress(packetId, progress);

    const wins = await loadDraftWins(packet, draft);
    const { shape, level } = await resolveFramework(packet);

    const mapping = await mapWinsToCompetencies({
        userId: packet.userId,
        sessionId: packetId,
        wins: wins.map((win) => ({
            id: win.id,
            category: win.category,
            title: win.title,
            narrative: win.narrative,
            occurredAt: win.occurredAt,
            metric: win.metric,
        })),
        competencies: shape.competencies,
        targetLevel: level ? { key: level.key, name: level.name } : null,
    });

    const mappings =
        mapping.mappings.length > 0 ? mapping.mappings : priorMappings(wins, shape.competencies);

    const assessments = assessCompetencies({
        competencies: shape.competencies,
        mappings,
        wins: wins.map((win) => ({
            id: win.id,
            title: win.title,
            occurredAt: win.occurredAt,
            quantified: win.quantified,
        })),
    });

    const covered = assessments.filter((item) => item.verdict !== 'absent').length;
    progress = advanceProgress(progress, 'map', {
        status: 'done',
        result: `${covered} of ${assessments.length} competencies covered`,
    });
    progress = advanceProgress(progress, 'select', { status: 'done', result: null });

    await writeDraft(
        packetId,
        { ...draft, mappings, assessments, costUsd: draft.costUsd + mapping.costUsd },
        progress,
    );
}

// ═════════════════════════════════════════════════════════ 4. compose

export async function composeStep(packetId: string): Promise<void> {
    'use step';

    const packet = await loadPacket(packetId);
    if (!packet) return;

    const draft = readDraft(packet.content);
    let progress = advanceProgress(await currentProgress(packetId), 'compose', { status: 'active' });
    await writeProgress(packetId, progress);

    const wins = await loadDraftWins(packet, draft);
    const { level } = await resolveFramework(packet);
    const themes: RawTheme[] = draft.grouping?.themes ?? [];

    let composition: SerializedComposition | null = null;
    let costUsd = draft.costUsd;

    if (themes.length > 0) {
        try {
            const composed = await composePacketProse({
                userId: packet.userId,
                sessionId: packetId,
                type: packet.type,
                audience: packet.audience as PacketAudience,
                wins,
                themes,
                assessments: draft.assessments,
                targetLevel: level,
                // `VoiceProfile` is not in the schema yet (PRD 03 depends on it
                // optionally). Absent, we default to plain declarative prose —
                // never to enthusiastic (§7.3 rule 5).
                voiceDescriptor: null,
            });
            composition = {
                summary: composed.summary,
                themeOutcomes: [...composed.themeOutcomes.entries()].map(([index, entry]) => ({
                    index,
                    ...entry,
                })),
                growth: composed.growth,
            };
            costUsd += composed.costUsd;
        } catch (error) {
            // A failed composition still yields a usable packet: themes, bullets
            // and the competency section are all deterministic.
            console.warn('[reviewPacket] composition failed; shipping the deterministic packet', {
                packetId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    progress = advanceProgress(progress, 'compose', {
        status: 'done',
        result: composition ? null : 'using your own words',
    });

    await writeDraft(packetId, { ...draft, composition, costUsd }, progress);
}

// ═════════════════════════════════════════════════ 5. truthfulness pass

export async function verifyAndFinishStep(packetId: string): Promise<void> {
    'use step';

    const packet = await loadPacket(packetId);
    if (!packet) return;

    const draft = readDraft(packet.content);
    let progress = advanceProgress(await currentProgress(packetId), 'verify', { status: 'active' });
    await writeProgress(packetId, progress);

    const wins = await loadDraftWins(packet, draft);
    const { framework, level } = await resolveFramework(packet);

    const composition: Composition | null = draft.composition
        ? {
            summary: draft.composition.summary,
            themeOutcomes: new Map(
                draft.composition.themeOutcomes.map((entry) => [
                    entry.index,
                    { outcomeSentence: entry.outcomeSentence, impact: entry.impact },
                ]),
            ),
            growth: draft.composition.growth,
            degraded: false,
            costUsd: 0,
        }
        : null;

    const grouping: ThemeGrouping = draft.grouping ?? {
        themes: [],
        unthemed: wins.map((win) => win.id),
        coherenceNote: null,
        fellBack: true,
        costUsd: 0,
    };

    const assembled = assemblePacket({
        type: packet.type,
        audience: packet.audience as PacketAudience,
        periodStart: packet.periodStart,
        periodEnd: packet.periodEnd,
        employerName: draft.employerName,
        framework,
        targetLevel: level,
        wins,
        grouping,
        composition,
        assessments: draft.assessments,
        omittedWinCount: draft.omitted,
    });

    const verified = runTruthfulnessPass({ packetId, content: assembled, wins });
    verified.wordCount = countWords(verified);

    progress = advanceProgress(progress, 'verify', {
        status: 'done',
        result:
            verified.warnings.length === 0
                ? 'every claim traced to a win'
                : `${verified.warnings.length} claim${verified.warnings.length === 1 ? '' : 's'} to review`,
    });
    verified.progress = progress;

    const generationMs = Date.now() - draft.startedAt;

    await prisma.reviewPacket.updateMany({
        where: { id: packetId },
        data: {
            status: PacketStatus.ready,
            content: verified as unknown as Prisma.InputJsonValue,
            gaps: draft.assessments.filter(
                (item) => item.verdict === 'thin' || item.verdict === 'absent',
            ) as unknown as Prisma.InputJsonValue,
            wordCount: verified.wordCount,
            generationMs,
            costUsd: draft.costUsd,
        },
    });

    await track(packet.userId, 'packet_completed', {
        feature: 'review_packet',
        type: packet.type,
        themes: verified.themes.length,
        wordCount: verified.wordCount,
        generationMs,
        costUsd: draft.costUsd,
        warningCount: verified.warnings.length,
        fellBackToCategories: grouping.fellBack,
    });
}

// ═════════════════════════════════════════════════════════ failure

export async function failPacketStep(packetId: string, message: string): Promise<void> {
    'use step';

    const row = await prisma.reviewPacket.findUnique({
        where: { id: packetId },
        select: { content: true, status: true },
    });
    if (!row || row.status === PacketStatus.ready) return;

    const progress = readProgress(row.content) ?? initialProgress();
    const active = progress.stages.find((stage) => stage.status === 'active');
    const failed = active
        ? advanceProgress(progress, active.id, { status: 'error', result: message.slice(0, 160) })
        : progress;

    const base =
        row.content && typeof row.content === 'object' && !Array.isArray(row.content)
            ? (row.content as Record<string, unknown>)
            : {};

    await prisma.reviewPacket.updateMany({
        where: { id: packetId },
        data: {
            status: PacketStatus.failed,
            content: { ...base, progress: failed } as unknown as Prisma.InputJsonValue,
        },
    });
}

/**
 * Exported for the integration tests, which run the pipeline without the
 * workflow runtime. The step boundaries are the same; only the durability is
 * missing, and that is precisely what a test does not need.
 */
export const __pipeline = {
    readWinsStep,
    groupThemesStep,
    mapCompetenciesStep,
    composeStep,
    verifyAndFinishStep,
    failPacketStep,
};
