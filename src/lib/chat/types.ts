/**
 * Chat contracts (docs/prd/10-chat.md).
 *
 * The router picks one ACTION from a closed list and fills its arguments; the
 * code runs it and answers with CARDS. A card is data, not markup: the web
 * renders it with buttons, a channel renders it as text. Nothing in here can
 * confirm, send or delete on its own; every write a card offers is a button
 * the user taps, through the same server action its full page uses.
 */

import type { BoardColumn, JobAction } from '@/lib/inbox/types';
import type {
    DraftFormat,
    DraftTarget,
    FitVerdict,
    OutreachDraft,
    ScoutKind,
    ScoutRunView,
    TrackedStatus,
} from '@/lib/scout/types';

export const CHAT_ACTIONS = [
    'analyze_job',
    'research_company',
    'log_work',
    'tailor_resume',
    'draft_outreach',
    'update_job',
    'show_jobs',
    'find_jobs',
    'ask_record',
    'build_resume',
    'answer',
    'clarify',
] as const;
export type ChatAction = (typeof CHAT_ACTIONS)[number];

export const DRAFT_TARGETS = ['poster', 'recruiter', 'hiring_manager', 'referral', 'alumni'] as const satisfies readonly DraftTarget[];
export const DRAFT_FORMATS = ['linkedin_note', 'linkedin_message', 'email'] as const satisfies readonly DraftFormat[];

/** What the router decided. Flat and nullable: every field is always present. */
export type RouteDecision = {
    action: ChatAction;
    /** One short line to show above the cards, or the whole answer for `answer`/`clarify`. */
    reply: string;
    url: string | null;
    /** The note to log, or pasted posting/post text to analyse. */
    text: string | null;
    company: string | null;
    /** 1-based index into the numbered job list the router was shown. */
    jobIndex: number | null;
    jobAction: JobAction | null;
    draftTarget: DraftTarget | null;
    draftFormat: DraftFormat | null;
    /** A steer for a draft, or search keywords. */
    query: string | null;
    location: string | null;
    remoteOnly: boolean | null;
    column: BoardColumn | null;
};

// ───────────────────────────────────────────────────────────── cards

export type ChatJob = {
    workspaceId: string;
    runId: string | null;
    company: string | null;
    role: string | null;
    status: TrackedStatus;
    verdict: FitVerdict | null;
    fitScore: number | null;
    sourceUrl: string | null;
    topStrength: string | null;
    topConcern: string | null;
};

export type ChatPosting = {
    id: string;
    company: string;
    title: string;
    location: string | null;
    url: string;
    postedAt: string | null;
    /** As the posting disclosed it, never converted. */
    pay: string | null;
};

export type ChatRecordItem = {
    winId: string;
    title: string;
    narrative: string;
    occurredAt: string;
    category: string;
};

export type ChatCard =
    | { type: 'scout_run'; runId: string; status: ScoutRunView['status']; kind: ScoutKind | null; headline: string }
    | {
        type: 'win_draft';
        winId: string;
        title: string;
        narrative: string;
        category: string;
        /** `merge_proposed`: nothing new was written; it matches an existing Win. */
        status: 'draft' | 'merge_proposed';
        /** The Win's state when the thread was read, so a reload never offers Confirm twice. */
        current?: 'draft' | 'confirmed' | 'dismissed';
        /** Who may see it. Only `shareable` reaches resumes and search; the user decides. */
        sensitivity?: 'shareable' | 'internal_only' | 'confidential';
    }
    | {
        type: 'generation';
        sessionId: string;
        resumeId: string | null;
        status: 'awaiting_clarification' | 'generating' | 'completed';
        title: string;
        question: string | null;
    }
    | { type: 'outreach'; runId: string; draft: OutreachDraft }
    | { type: 'jobs'; title: string; items: ChatJob[] }
    | { type: 'postings'; query: string; items: ChatPosting[]; note: string | null }
    | { type: 'record'; query: string; items: ChatRecordItem[] }
    | { type: 'link'; label: string; href: string; description: string };

export type ChatRole = 'user' | 'assistant';

export type ChatMessageView = {
    id: string;
    role: ChatRole;
    text: string;
    cards: ChatCard[];
    action: ChatAction | null;
    createdAt: string;
};

/** The context the router is shown, built in code from the user's own rows. */
export type ChatContext = {
    jobs: ChatJob[];
    openQuestion: { runId: string; question: string } | null;
    draftCount: number;
    hasBaseResume: boolean;
    /** From job-search preferences (Settings → Job search), so "find me jobs" means theirs. */
    looking: { roles: string[]; locations: string[]; remote: boolean };
};
