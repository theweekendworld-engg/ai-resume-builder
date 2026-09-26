/**
 * The career inbox: everything a user sends (link, post, note) recorded and
 * arranged so it helps at every step, not just the day it was shared.
 *
 * Built on rows that already exist, never on a second copy of them:
 *   jobs      → ApplicationWorkspace (the tracker the dashboard and extension
 *               already use), linked to the Scout run that analysed it
 *   insights  → SavedInsight
 *   notes     → Win (source = chat), which the Work Log owns
 *   companies → derived from the above; no table of its own
 */

import type { FitVerdict, TrackedStatus, WorkMode } from '@/lib/scout/types';

/**
 * The status words a person uses, mapped onto the tracker's enum. The enum
 * has twelve values because the extension needed them; a person needs six.
 */
export const JOB_ACTIONS = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'not_interested'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export const JOB_ACTION_STATUS: Record<JobAction, TrackedStatus> = {
    saved: 'analyzed',
    applied: 'applied',
    interviewing: 'interview',
    offer: 'offer',
    rejected: 'rejected',
    not_interested: 'archived',
};

export const JOB_ACTION_LABELS: Record<JobAction, string> = {
    saved: 'Saved',
    applied: 'Applied',
    interviewing: 'Interviewing',
    offer: 'Offer',
    rejected: 'Rejected',
    not_interested: 'Not interested',
};

/** Board columns, in order. Every TrackedStatus lands in exactly one. */
export const BOARD_COLUMNS = ['to_review', 'applied', 'interviewing', 'offer', 'closed'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COLUMN_OF_STATUS: Record<TrackedStatus, BoardColumn> = {
    discovered: 'to_review',
    analyzed: 'to_review',
    drafting: 'to_review',
    in_progress: 'to_review',
    submitted: 'applied',
    applied: 'applied',
    in_review: 'applied',
    interview: 'interviewing',
    offer: 'offer',
    rejected: 'closed',
    ghosted: 'closed',
    archived: 'closed',
};

export const COLUMN_LABELS: Record<BoardColumn, string> = {
    to_review: 'To review',
    applied: 'Applied',
    interviewing: 'Interviewing',
    offer: 'Offer',
    closed: 'Closed',
};

export type JobBoardItem = {
    workspaceId: string;
    /** Null for jobs tracked before Scout (extension-only rows). */
    runId: string | null;
    company: string | null;
    role: string | null;
    location: string | null;
    workMode: WorkMode | null;
    fitScore: number | null;
    verdict: FitVerdict | null;
    status: TrackedStatus;
    column: BoardColumn;
    sourceUrl: string | null;
    /** One quoted pay figure with its source host, when Scout found one. */
    compHint: string | null;
    /** What the user did that fits best (evidence line), when known. */
    topStrength: string | null;
    /** The first reason it may not fit, when known. */
    topConcern: string | null;
    createdAt: string;
    updatedAt: string;
};

export type JobBoardFilters = {
    columns?: BoardColumn[];
    verdicts?: FitVerdict[];
    /** Case-insensitive substring over location. */
    location?: string | null;
    workModes?: WorkMode[];
    /** Only jobs added within N days. */
    sinceDays?: number | null;
    /** 'fit' (default: best fit first, unknown last) or 'recent'. */
    sort?: 'fit' | 'recent';
    limit?: number;
};

export type InsightItem = {
    id: string;
    runId: string | null;
    title: string;
    takeaways: string[];
    tags: string[];
    url: string | null;
    author: string | null;
    createdAt: string;
};

export type CompanyItem = {
    name: string;
    /** Jobs in the tracker for this company. */
    jobs: number;
    bestFit: { score: number | null; verdict: FitVerdict | null; role: string | null; workspaceId: string; runId: string | null } | null;
    /** Company-news posts that mentioned it. */
    mentions: number;
    /** Radar already follows its job board. */
    radarTracked: boolean;
    lastSeenAt: string;
};

export type NoteItem = {
    winId: string;
    title: string;
    status: 'draft' | 'confirmed' | 'dismissed' | 'archived';
    source: string;
    createdAt: string;
};

export type InboxCounts = {
    toReview: number;
    applied: number;
    interviewing: number;
    insights: number;
    draftNotes: number;
};
