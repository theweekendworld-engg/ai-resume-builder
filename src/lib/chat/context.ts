/**
 * What the router is shown, built in code from the user's own rows only.
 *
 * Kept small on purpose: a numbered list of recent jobs (so "tailor it" can be
 * resolved to an index), and three facts that change what a sensible next step
 * is. The router never sees Win text: it does not need it to route, and what
 * it is not shown it cannot leak or misquote.
 *
 * It does see long-term memory (`memoryIndex`, ≤ ~1,500 chars): the user's
 * own short answers from earlier days, so a small model can answer "have I
 * told you about my Claude work?" without asking again. The reply is the
 * user's to read, not an artifact, so private lines are included here.
 */

import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { listJobBoard } from '@/services/careerInbox';
import { findOpenQuestionRun } from '@/services/scout';
import type { JobBoardItem } from '@/lib/inbox/types';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { memoryIndex } from '@/services/memory';
import type { ChatContext, ChatJob } from './types';

export const CONTEXT_JOBS = 8;

export function toChatJob(item: JobBoardItem): ChatJob {
    return {
        workspaceId: item.workspaceId,
        runId: item.runId,
        company: item.company,
        role: item.role,
        status: item.status,
        verdict: item.verdict,
        fitScore: item.fitScore,
        sourceUrl: item.sourceUrl,
        topStrength: item.topStrength,
        topConcern: item.topConcern,
    };
}

export async function buildChatContext(userId: string): Promise<ChatContext> {
    const [board, open, draftCount, base, profile, memory] = await Promise.all([
        listJobBoard(userId),
        findOpenQuestionRun(userId),
        prisma.win.count({ where: { userId, status: WinStatus.draft } }),
        prisma.resume.findFirst({ where: { userId, baseResumeId: null }, select: { id: true } }),
        prisma.userProfile.findUnique({ where: { userId }, select: { preferences: true } }),
        // What the user told us on earlier days, so "do I know Claude?" is
        // answered from their own words. A read failure costs only this line.
        memoryIndex(userId).catch(() => ''),
    ]);
    const prefs = parseUserGenerationPreferences(profile?.preferences);
    const jobs = [...board]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, CONTEXT_JOBS)
        .map(toChatJob);
    return {
        jobs,
        openQuestion: open?.pendingQuestion ? { runId: open.id, question: open.pendingQuestion.prompt } : null,
        draftCount,
        hasBaseResume: Boolean(base),
        looking: {
            roles: prefs.targetRoles,
            locations: prefs.targetLocations,
            remote: prefs.preferredWorkModes.includes('remote'),
        },
        memoryIndex: memory,
    };
}
