/**
 * Home: the one screen with everything (2026-10-04).
 *
 * Pure reads, one round of parallel queries. Every number links to where it
 * is acted on, and a section whose feature is off is absent, not empty. The
 * "Needs you" list is the point of the page: each item is one thing to do,
 * ranked by how soon it matters.
 */

import { ApplicationEventKind, ApplicationStatus, Channel, GenerationStatus, JobEmailStatus, WinStatus } from '@prisma/client';

import { COLUMN_OF_STATUS, type BoardColumn } from '@/lib/inbox/types';
import type { TrackedStatus } from '@/lib/scout/types';
import { prisma } from '@/lib/prisma';

export type OverviewFlags = {
    chat: boolean;
    scout: boolean;
    workLog: boolean;
    missions: boolean;
    journey: boolean;
};

export type NeedsYouKind = 'interview' | 'email' | 'follow_up' | 'question' | 'drafts' | 'review' | 'goal';

export type NeedsYouItem = {
    key: string;
    kind: NeedsYouKind;
    title: string;
    detail: string | null;
    href: string;
    action: string;
    /** Sort key: sooner is more urgent. */
    at: string | null;
};

export type Overview = {
    firstName: string | null;
    needsYou: NeedsYouItem[];
    pipeline: Array<{ column: BoardColumn; label: string; count: number; href: string }> | null;
    upcoming: Array<{ id: string; title: string; job: string; at: string; href: string }> | null;
    activity: Array<{ id: string; kind: string; title: string; job: string | null; at: string; href: string }>;
    record: { winsThisMonth: number; confirmed: number; drafts: number } | null;
    goal: { title: string; percent: number; nextStep: string | null } | null;
    resumes: Array<{ id: string; title: string; target: string | null; updatedAt: string }>;
    setup: Array<{ key: string; label: string; done: boolean; href: string }>;
};

const COLUMN_LABEL: Record<BoardColumn, string> = {
    to_review: 'To review',
    applied: 'Applied',
    interviewing: 'Interviewing',
    offer: 'Offer',
    closed: 'Closed',
};

const REPLY_KINDS = ['recruiter_outreach', 'interview_request', 'scheduling', 'assessment', 'offer', 'other_job'] as const;
const DAY = 86_400_000;

function jobName(role: string | null, company: string | null): string {
    return `${role ?? 'A role'}${company ? ` at ${company}` : ''}`;
}

export async function getOverview(userId: string, flags: OverviewFlags, now: Date = new Date()): Promise<Overview> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const week = new Date(now.getTime() + 7 * DAY);
    const twoWeeks = new Date(now.getTime() + 14 * DAY);

    const [
        profile,
        byStatus,
        upcomingRows,
        emailRows,
        followUpRows,
        activityRows,
        winsThisMonth,
        confirmed,
        drafts,
        openQuestion,
        mission,
        resumes,
        telegram,
        inbox,
        calendar,
        experienceCount,
    ] = await Promise.all([
        prisma.userProfile.findUnique({ where: { userId }, select: { fullName: true } }),
        flags.scout ? prisma.applicationWorkspace.groupBy({ by: ['applicationStatus'], where: { userId }, _count: { _all: true } }) : Promise.resolve([]),
        flags.journey
            ? prisma.applicationEvent.findMany({
                where: { userId, kind: ApplicationEventKind.interview, occurredAt: { gte: now, lte: twoWeeks } },
                orderBy: { occurredAt: 'asc' },
                take: 6,
                select: { id: true, title: true, occurredAt: true, workspace: { select: { roleTitle: true, companyName: true } } },
            })
            : Promise.resolve([]),
        flags.journey
            ? prisma.jobEmail.findMany({
                where: { userId, status: JobEmailStatus.processed, handledAt: null, kind: { in: [...REPLY_KINDS] } },
                orderBy: { receivedAt: 'desc' },
                take: 5,
                select: { id: true, subject: true, fromName: true, fromEmail: true, summary: true, receivedAt: true },
            })
            : Promise.resolve([]),
        flags.journey
            ? prisma.applicationEvent.findMany({
                where: {
                    userId,
                    kind: ApplicationEventKind.follow_up_due,
                    occurredAt: { gte: new Date(now.getTime() - 7 * DAY) },
                    workspace: { applicationStatus: { in: [ApplicationStatus.submitted, ApplicationStatus.applied, ApplicationStatus.in_review] } },
                },
                orderBy: { occurredAt: 'desc' },
                take: 5,
                select: { id: true, detail: true, occurredAt: true, workspaceId: true, workspace: { select: { roleTitle: true, companyName: true } } },
            })
            : Promise.resolve([]),
        flags.journey || flags.scout
            ? prisma.applicationEvent.findMany({
                where: { userId, kind: { in: [ApplicationEventKind.status_change, ApplicationEventKind.email, ApplicationEventKind.interview] }, occurredAt: { lte: now } },
                orderBy: { occurredAt: 'desc' },
                take: 8,
                select: { id: true, kind: true, title: true, occurredAt: true, workspace: { select: { roleTitle: true, companyName: true } } },
            })
            : Promise.resolve([]),
        flags.workLog ? prisma.win.count({ where: { userId, status: WinStatus.confirmed, occurredAt: { gte: monthStart } } }) : Promise.resolve(0),
        flags.workLog ? prisma.win.count({ where: { userId, status: WinStatus.confirmed } }) : Promise.resolve(0),
        prisma.win.count({ where: { userId, status: WinStatus.draft } }),
        prisma.generationSession.findFirst({
            where: { userId, status: GenerationStatus.awaiting_clarification, updatedAt: { gte: new Date(now.getTime() - 2 * DAY) } },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, clarifications: true, updatedAt: true },
        }),
        flags.missions
            ? prisma.mission.findFirst({
                where: { userId, status: 'active' },
                orderBy: { updatedAt: 'desc' },
                select: { title: true, steps: { orderBy: { order: 'asc' }, select: { title: true, status: true } } },
            })
            : Promise.resolve(null),
        prisma.resume.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 3, select: { id: true, title: true, targetRole: true, targetCompany: true, updatedAt: true } }),
        prisma.channelIdentity.count({ where: { userId, channel: Channel.telegram, verified: true } }),
        flags.journey ? prisma.emailInbox.findUnique({ where: { userId }, select: { lastReceivedAt: true } }) : Promise.resolve(null),
        flags.journey ? prisma.googleConnection.count({ where: { userId } }) : Promise.resolve(0),
        prisma.userExperience.count({ where: { userId } }),
    ]);

    const count = (column: BoardColumn) => byStatus
        .filter((row) => COLUMN_OF_STATUS[row.applicationStatus as TrackedStatus] === column)
        .reduce((sum, row) => sum + row._count._all, 0);

    // ── Needs you, most urgent first.
    const needsYou: NeedsYouItem[] = [];
    for (const row of upcomingRows) {
        if (row.occurredAt > week) continue;
        needsYou.push({
            key: `interview:${row.id}`, kind: 'interview', title: row.title,
            detail: jobName(row.workspace.roleTitle, row.workspace.companyName),
            href: '/scout', action: 'Prepare', at: row.occurredAt.toISOString(),
        });
    }
    if (openQuestion) {
        needsYou.push({
            key: `question:${openQuestion.id}`, kind: 'question', title: 'Your resume is waiting on a question',
            detail: 'Answer it to finish the resume, or skip it.', href: '/dashboard?section=resumes', action: 'Answer', at: openQuestion.updatedAt.toISOString(),
        });
    }
    for (const row of emailRows) {
        needsYou.push({
            key: `email:${row.id}`, kind: 'email', title: `Reply to ${row.fromName ?? row.fromEmail}`,
            detail: row.summary ?? row.subject, href: '/scout?tab=email', action: 'Draft reply', at: row.receivedAt.toISOString(),
        });
    }
    for (const row of followUpRows) {
        needsYou.push({
            key: `follow:${row.id}`, kind: 'follow_up', title: `Follow up on ${jobName(row.workspace.roleTitle, row.workspace.companyName)}`,
            detail: row.detail, href: '/scout', action: 'Draft follow-up', at: row.occurredAt.toISOString(),
        });
    }
    if (flags.workLog && drafts > 0) {
        needsYou.push({
            key: 'drafts', kind: 'drafts', title: `${drafts} Work Log draft${drafts === 1 ? '' : 's'} to confirm`,
            detail: 'Confirmed wins are what your resumes are built from.', href: '/log', action: 'Review', at: null,
        });
    }
    if (flags.scout && count('to_review') > 0) {
        const n = count('to_review');
        needsYou.push({
            key: 'review', kind: 'review', title: `${n} job${n === 1 ? '' : 's'} to review`,
            detail: 'Scored against your record. Save, apply or pass.', href: '/scout', action: 'Review', at: null,
        });
    }
    let goal: Overview['goal'] = null;
    if (mission) {
        const done = mission.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
        const next = mission.steps.find((step) => step.status === 'active' || step.status === 'pending') ?? null;
        goal = { title: mission.title, percent: mission.steps.length ? Math.round((done / mission.steps.length) * 100) : 0, nextStep: next?.title ?? null };
        if (next) {
            needsYou.push({ key: 'goal', kind: 'goal', title: next.title, detail: `Next step toward ${mission.title}`, href: '/home', action: 'Open', at: null });
        }
    }
    const rank: Record<NeedsYouKind, number> = { interview: 0, question: 1, email: 2, follow_up: 3, drafts: 4, review: 5, goal: 6 };
    needsYou.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.at && b.at ? a.at.localeCompare(b.at) : 0));

    const setup = [
        { key: 'resume', label: 'Add your resume or work history', done: experienceCount > 0, href: '/dashboard?section=profile' },
        { key: 'telegram', label: 'Link Telegram to log and share from your phone', done: telegram > 0, href: '/settings/channels' },
        ...(flags.journey
            ? [
                { key: 'email', label: 'Forward job email to Patronus', done: !!inbox?.lastReceivedAt, href: '/settings/email' },
                { key: 'calendar', label: 'Connect Google Calendar', done: calendar > 0, href: '/settings/email' },
            ]
            : []),
    ];

    return {
        firstName: profile?.fullName?.trim().split(/\s+/)[0] || null,
        needsYou: needsYou.slice(0, 8),
        pipeline: flags.scout
            ? (['to_review', 'applied', 'interviewing', 'offer'] as BoardColumn[]).map((column) => ({ column, label: COLUMN_LABEL[column], count: count(column), href: '/scout' }))
            : null,
        upcoming: flags.journey
            ? upcomingRows.map((row) => ({ id: row.id, title: row.title, job: jobName(row.workspace.roleTitle, row.workspace.companyName), at: row.occurredAt.toISOString(), href: '/scout' }))
            : null,
        activity: activityRows.map((row) => ({
            id: row.id, kind: row.kind, title: row.title, job: jobName(row.workspace.roleTitle, row.workspace.companyName),
            at: row.occurredAt.toISOString(), href: '/scout',
        })),
        record: flags.workLog ? { winsThisMonth, confirmed, drafts } : null,
        goal,
        resumes: resumes.map((r) => ({
            id: r.id, title: r.title || 'Untitled resume',
            target: [r.targetRole, r.targetCompany].filter(Boolean).join(' at ') || null,
            updatedAt: r.updatedAt.toISOString(),
        })),
        setup,
    };
}
