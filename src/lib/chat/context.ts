/**
 * What the router is shown, built in code from the user's own rows only.
 *
 * Kept small on purpose: a numbered list of recent jobs (so "tailor it" can be
 * resolved to an index), and three facts that change what a sensible next step
 * is. The router never sees Win text: it does not need it to route, and what
 * it is not shown it cannot leak or misquote.
 */

import { WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { listJobBoard } from '@/services/careerInbox';
import { findOpenQuestionRun } from '@/services/scout';
import type { JobBoardItem } from '@/lib/inbox/types';
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
    const [board, open, draftCount, base] = await Promise.all([
        listJobBoard(userId),
        findOpenQuestionRun(userId),
        prisma.win.count({ where: { userId, status: WinStatus.draft } }),
        prisma.resume.findFirst({ where: { userId, baseResumeId: null }, select: { id: true } }),
    ]);
    const jobs = [...board]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, CONTEXT_JOBS)
        .map(toChatJob);
    return {
        jobs,
        openQuestion: open?.pendingQuestion ? { runId: open.id, question: open.pendingQuestion.prompt } : null,
        draftCount,
        hasBaseResume: Boolean(base),
    };
}
