/**
 * Daily operator digest: what broke and what it cost, sent to the Telegram
 * chats the admins have linked (ADMIN_USER_IDS → ChannelIdentity). No new
 * secret and no vendor: the bot already exists.
 *
 * Until 2026-10-02 nothing told the operator anything; every failure surface
 * (dead jobs, model errors, cost) only worked if someone opened /admin/ops.
 * The digest always sends, so a silent day is "nothing to report", not "the
 * alerting is broken".
 */

import { Channel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { configHealth } from '@/lib/health';
import type { JobHandler, JobResultObject } from '@/lib/jobs/types';

export const OPERATOR_DIGEST_JOB_KIND = 'operator_digest' as const;

const DAY = 86_400_000;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type OperatorSummary = {
    deadJobs: { kind: string; count: number }[];
    runs: { total: number; failed: number };
    modelCalls: { total: number; failed: number };
    costUsd: number;
    topSpender: { userId: string; costUsd: number } | null;
    newUsers: number;
    chatMessages: number;
    configErrors: string[];
};

export async function summarizeLastDay(now: Date = new Date()): Promise<OperatorSummary> {
    const since = new Date(now.getTime() - DAY);
    const [dead, runTotal, runFailed, callTotal, callFailed, cost, spenders, newUsers, chats] = await Promise.all([
        prisma.job.groupBy({ by: ['kind'], where: { status: 'dead', finishedAt: { gte: since } }, _count: { id: true } }),
        prisma.agentRun.count({ where: { createdAt: { gte: since } } }),
        prisma.agentRun.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
        prisma.apiUsageLog.count({ where: { createdAt: { gte: since } } }),
        prisma.apiUsageLog.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
        prisma.apiUsageLog.aggregate({ where: { createdAt: { gte: since } }, _sum: { costUsd: true } }),
        prisma.apiUsageLog.groupBy({ by: ['userId'], where: { createdAt: { gte: since } }, _sum: { costUsd: true }, orderBy: { _sum: { costUsd: 'desc' } }, take: 1 }),
        prisma.userProfile.count({ where: { createdAt: { gte: since } } }),
        prisma.chatMessage.count({ where: { createdAt: { gte: since }, role: 'user' } }),
    ]);
    return {
        deadJobs: dead.map((d) => ({ kind: d.kind, count: (d._count as { id: number }).id })),
        runs: { total: runTotal, failed: runFailed },
        modelCalls: { total: callTotal, failed: callFailed },
        costUsd: cost._sum.costUsd ?? 0,
        topSpender: spenders[0] ? { userId: spenders[0].userId, costUsd: spenders[0]._sum.costUsd ?? 0 } : null,
        newUsers,
        chatMessages: chats,
        configErrors: configHealth().filter((c) => !c.ok && c.severity === 'error').map((c) => c.id),
    };
}

export function renderOperatorDigest(s: OperatorSummary, appUrl: string): string {
    const pct = (failed: number, total: number) => (total === 0 ? '0%' : `${Math.round((failed / total) * 100)}%`);
    const problems: string[] = [];
    if (s.deadJobs.length) problems.push(`Dead jobs: ${s.deadJobs.map((d) => `${d.kind} ×${d.count}`).join(', ')}`);
    if (s.runs.total >= 5 && s.runs.failed / s.runs.total > 0.2) problems.push(`Scout runs failing: ${pct(s.runs.failed, s.runs.total)}`);
    if (s.modelCalls.total >= 20 && s.modelCalls.failed / s.modelCalls.total > 0.1) problems.push(`Model calls failing: ${pct(s.modelCalls.failed, s.modelCalls.total)}`);
    if (s.configErrors.length) problems.push(`Config errors: ${s.configErrors.join(', ')}`);
    return [
        `<b>Patronus, last 24h</b> ${problems.length ? `⚠️ ${problems.length} to look at` : '✅ nothing broke'}`,
        ...problems.map((p) => `• ${escape(p)}`),
        '',
        `Users +${s.newUsers} · chat messages ${s.chatMessages}`,
        `Scout runs ${s.runs.total} (${s.runs.failed} failed) · model calls ${s.modelCalls.total} (${s.modelCalls.failed} failed)`,
        `Spend $${s.costUsd.toFixed(2)}${s.topSpender ? ` · top user $${s.topSpender.costUsd.toFixed(2)} (${escape(s.topSpender.userId)})` : ''}`,
        `${appUrl.replace(/\/$/, '')}/admin/ops`,
    ].join('\n');
}

export const operatorDigestHandler: JobHandler = async (_payload, ctx): Promise<JobResultObject> => {
    const admins = (process.env.ADMIN_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (admins.length === 0) return { sent: 0, reason: 'no_admins' };
    const chats = await prisma.channelIdentity.findMany({
        where: { userId: { in: admins }, channel: Channel.telegram, verified: true },
        select: { externalId: true },
    });
    if (chats.length === 0) {
        ctx.log('operator_digest: no admin has linked Telegram');
        return { sent: 0, reason: 'no_linked_admin_chat' };
    }
    const { config } = await import('@/lib/config');
    const { sendTelegramMessageDetailed } = await import('@/lib/telegram');
    const text = renderOperatorDigest(await summarizeLastDay(), config.app.url);
    let sent = 0;
    for (const chat of chats) {
        const result = await sendTelegramMessageDetailed({ chatId: chat.externalId, text, parseMode: 'HTML' });
        if (result.ok) sent += 1;
    }
    return { sent };
};
