/**
 * Scout button actions, shared by Telegram and WhatsApp.
 *
 * Wire format (Telegram callback_data is ≤ 64 bytes; a cuid is ~25 chars):
 *   sc:a:<runId>:<optionIndex>          answer the pending question
 *   sc:d:<runId>:<target>:<format>      write an outreach draft
 *   sc:w:<runId>                        why not a fit
 *   sc:r:<runId>                        refresh the analysis
 *   sc:s:<runId>:<statusCode>           move the job along the tracker
 *   sc:c:<winId>                        confirm a Work Log draft
 *   sc:x:<winId>                        dismiss a Work Log draft
 *
 * Indexes and single-letter codes rather than values: an option value such as
 * "willing_to_relocate_case_by_case" would overflow the Telegram limit. The
 * first four formats are unchanged, so buttons already sitting in chats keep
 * working.
 */

import type { DraftFormat, DraftTarget, FitData, JdData, OutreachDraft, ScoutRunView } from '@/lib/scout/types';
import type { DraftFormatCode, DraftTargetCode, JobStatusCode, Line, ScoutAction } from '@/lib/channels/types';
import { JOB_ACTION_LABELS, type JobAction, type JobBoardItem } from '@/lib/inbox/types';
import type { Result } from '@/lib/result';

export const SCOUT_ACTION_PREFIX = 'sc:';

export const TARGET_CODES: Record<DraftTargetCode, DraftTarget> = {
    p: 'poster',
    r: 'recruiter',
    h: 'hiring_manager',
    f: 'referral',
    a: 'alumni',
};

export const FORMAT_CODES: Record<DraftFormatCode, DraftFormat> = {
    n: 'linkedin_note',
    m: 'linkedin_message',
    e: 'email',
};

export const STATUS_CODES: Record<JobStatusCode, JobAction> = {
    s: 'saved',
    a: 'applied',
    i: 'interviewing',
    o: 'offer',
    r: 'rejected',
    n: 'not_interested',
};

export type DecodedScoutAction =
    | { kind: 'answer'; runId: string; index: number }
    | { kind: 'draft'; runId: string; target: DraftTarget; format: DraftFormat }
    | { kind: 'why'; runId: string }
    | { kind: 'refresh'; runId: string }
    | { kind: 'status'; runId: string; status: JobAction }
    | { kind: 'confirm_win'; winId: string }
    | { kind: 'dismiss_win'; winId: string };

export function encodeScoutAction(runId: string, action: Exclude<ScoutAction, { kind: 'open' }>): string {
    switch (action.kind) {
        case 'answer':
            return `sc:a:${runId}:${action.index}`;
        case 'draft':
            return `sc:d:${runId}:${action.target}:${action.format}`;
        case 'why':
            return `sc:w:${runId}`;
        case 'refresh':
            return `sc:r:${runId}`;
        case 'status':
            return `sc:s:${runId}:${action.status}`;
        case 'confirm_win':
            return `sc:c:${action.winId}`;
        case 'dismiss_win':
            return `sc:x:${action.winId}`;
    }
}

const ID = /^[a-z0-9]{8,40}$/i;

export function decodeScoutAction(data: string): DecodedScoutAction | null {
    if (!data.startsWith(SCOUT_ACTION_PREFIX)) return null;
    const [, kind, id, a, b] = data.split(':');
    if (!id || !ID.test(id)) return null;
    switch (kind) {
        case 'a': {
            const index = Number(a);
            return Number.isInteger(index) && index >= 0 && index < 50 ? { kind: 'answer', runId: id, index } : null;
        }
        case 'd': {
            const target = TARGET_CODES[a as DraftTargetCode];
            const format = FORMAT_CODES[b as DraftFormatCode];
            return target && format ? { kind: 'draft', runId: id, target, format } : null;
        }
        case 'w':
            return { kind: 'why', runId: id };
        case 'r':
            return { kind: 'refresh', runId: id };
        case 's': {
            const status = STATUS_CODES[a as JobStatusCode];
            return status ? { kind: 'status', runId: id, status } : null;
        }
        case 'c':
            return { kind: 'confirm_win', winId: id };
        case 'x':
            return { kind: 'dismiss_win', winId: id };
        default:
            return null;
    }
}

// ────────────────────────────────────────────────────────── execution

type Svc<T> = Promise<{ success: true; data: T } | { success: false; error: string; code?: string }>;

export type ScoutActionDeps = {
    getScoutRun: (userId: string, runId: string) => Svc<ScoutRunView>;
    answerScoutQuestion: (userId: string, runId: string, value: string) => Svc<ScoutRunView>;
    draftScoutOutreach: (
        userId: string,
        runId: string,
        params: { target: DraftTarget; format: DraftFormat },
    ) => Svc<OutreachDraft>;
    refreshScoutRun: (userId: string, runId: string) => Svc<ScoutRunView>;
    setJobStatus: (userId: string, ref: { runId: string } | { workspaceId: string }, action: JobAction) => Promise<Result<JobBoardItem>>;
    confirmWinForUser: (userId: string, winId: string) => Promise<Result<{ winId: string; title: string }>>;
    dismissWinForUser: (userId: string, winId: string) => Promise<Result<void>>;
};

/**
 * What an action produces for the chat.
 *
 * `actions` + `runId`: follow-up buttons (after "Applied": Interviewing /
 * Offer / Rejected). `settled`: the tapped message's buttons are spent and
 * should be removed, so a second tap cannot repeat the action.
 */
export type ScoutActionReply = { lines: Line[]; actions?: ScoutAction[]; runId?: string; settled?: boolean };

function text(value: string): Line {
    return [{ text: value }];
}

async function defaultDeps(): Promise<ScoutActionDeps> {
    const [service, inbox, wins] = await Promise.all([
        import('@/services/scout'),
        import('@/services/careerInbox'),
        import('@/services/wins'),
    ]);
    return {
        getScoutRun: service.getScoutRun,
        answerScoutQuestion: service.answerScoutQuestion,
        draftScoutOutreach: service.draftScoutOutreach,
        refreshScoutRun: service.refreshScoutRun,
        setJobStatus: inbox.setJobStatus,
        confirmWinForUser: wins.confirmWinForUser,
        dismissWinForUser: wins.dismissWinForUser,
    };
}

/** Next steps after a status change: the tracker moves forward, never back. */
const FOLLOW_UPS: Partial<Record<JobAction, ScoutAction[]>> = {
    saved: [
        { kind: 'status', status: 'a', label: '📨 Applied' },
        { kind: 'status', status: 'n', label: '❌ Not interested' },
    ],
    applied: [
        { kind: 'status', status: 'i', label: '🎤 Interviewing' },
        { kind: 'status', status: 'o', label: '🏁 Offer' },
        { kind: 'status', status: 'r', label: 'Rejected' },
    ],
    interviewing: [
        { kind: 'status', status: 'o', label: '🏁 Offer' },
        { kind: 'status', status: 'r', label: 'Rejected' },
    ],
};

export function jobLabel(item: Pick<JobBoardItem, 'role' | 'company'>): string {
    return [item.company, item.role].filter(Boolean).join(' ') || 'this job';
}

/** "Already confirmed" arrives as an error from some paths; it is success to the user. */
function isAlreadyDone(result: { error: string; code?: string }): boolean {
    return result.code === 'already_confirmed' || result.code === 'invalid_state' || /already/i.test(result.error);
}

/**
 * Run a decoded action for a linked user. Ownership is enforced by the
 * services (`ownedRun`, the Win's userId): a forged callback naming someone
 * else's run or Win gets "not found", never their data.
 */
export async function executeScoutAction(
    userId: string,
    action: DecodedScoutAction,
    deps?: ScoutActionDeps,
): Promise<ScoutActionReply> {
    const svc = deps ?? (await defaultDeps());

    switch (action.kind) {
        case 'answer': {
            const run = await svc.getScoutRun(userId, action.runId);
            if (!run.success) return { lines: [text('I could not find that analysis.')] };
            const option = run.data.pendingQuestion?.options?.[action.index];
            if (!run.data.pendingQuestion || !option) {
                return { lines: [text('That question has already been answered.')] };
            }
            const answered = await svc.answerScoutQuestion(userId, action.runId, option.value);
            if (!answered.success) return { lines: [text(answered.error)] };
            return { lines: [text(`Got it: ${option.label}. Updating the fit…`)] };
        }
        case 'draft': {
            const drafted = await svc.draftScoutOutreach(userId, action.runId, { target: action.target, format: action.format });
            if (!drafted.success) return { lines: [text(drafted.error)] };
            return { lines: renderDraft(drafted.data) };
        }
        case 'why': {
            const run = await svc.getScoutRun(userId, action.runId);
            if (!run.success) return { lines: [text('I could not find that analysis.')] };
            return { lines: renderWhyNotFit(run.data) };
        }
        case 'refresh': {
            const refreshed = await svc.refreshScoutRun(userId, action.runId);
            if (!refreshed.success) return { lines: [text(refreshed.error)] };
            return { lines: [text('Re-running the analysis. I will update this chat when it is done.')] };
        }
        case 'status': {
            const moved = await svc.setJobStatus(userId, { runId: action.runId }, action.status);
            if (!moved.success) return { lines: [text(moved.error)] };
            const label = JOB_ACTION_LABELS[action.status];
            const note = action.status === 'not_interested' ? ' It stays in your tracker under Closed.' : '';
            return {
                lines: [text(`Marked ${label} · ${jobLabel(moved.data)}.${note}`)],
                actions: FOLLOW_UPS[action.status],
                runId: action.runId,
            };
        }
        case 'confirm_win': {
            const confirmed = await svc.confirmWinForUser(userId, action.winId);
            if (confirmed.success) {
                return { lines: [text(`Added to your Work Log ✓ ${confirmed.data.title}`)], settled: true };
            }
            if (isAlreadyDone(confirmed)) return { lines: [text('Already in your Work Log ✓')], settled: true };
            return { lines: [text(confirmed.error)] };
        }
        case 'dismiss_win': {
            const dismissed = await svc.dismissWinForUser(userId, action.winId);
            if (!dismissed.success) return { lines: [text(dismissed.error)] };
            return { lines: [text('Dismissed. It will not appear in your Work Log.')], settled: true };
        }
    }
}

/** A job's short label from a run view, for replies that have no board item. */
export function jobLabelFromView(view: ScoutRunView): string {
    const jd = view.sections.jd;
    if (jd && jd.status === 'ok') {
        const data = jd.data as JdData;
        return jobLabel({ role: data.role, company: data.company });
    }
    return view.headline;
}

export function renderDraft(draft: OutreachDraft): Line[] {
    const lines: Line[] = [[{ text: 'Draft', bold: true }, { text: ' (edit before sending)' }], []];
    if (draft.subject) lines.push([{ text: 'Subject: ', bold: true }, { text: draft.subject }], []);
    for (const paragraph of draft.body.split('\n')) lines.push(text(paragraph));
    return lines;
}

function shorten(value: string, max: number): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '')}…`;
}

export function renderWhyNotFit(view: ScoutRunView): Line[] {
    const fit = view.sections.fit;
    if (!fit || fit.status !== 'ok') return [text('The fit check has not finished for this one.')];
    const data = fit.data as FitData;
    // notFitReasons already names every blocking gap and conflict; the
    // gaps/checks are only a fallback for runs stored without reasons. Adding
    // both listed every gap twice ("No evidence for X" then "Missing: X").
    const reasons = data.notFitReasons.length > 0
        ? data.notFitReasons
        : [
            ...data.preferenceChecks.filter((check) => check.status === 'conflict').map((check) => check.detail),
            ...data.gaps.filter((gap) => gap.severity === 'blocking').map((gap) => `No evidence in your record for: "${gap.text}"`),
        ];
    const unique = [...new Set(reasons)].slice(0, 8);
    if (unique.length === 0) return [text('Nothing here rules you out.')];
    const lines: Line[] = [[{ text: 'Why this may not fit', bold: true }], ...unique.map((reason) => text(`• ${reason}`))];
    const strengths = data.matched.filter((match) => match.strength !== 'partial').slice(0, 3);
    if (strengths.length > 0) {
        lines.push([], [{ text: 'What you already have', bold: true }]);
        for (const match of strengths) lines.push(text(`• ${shorten(match.text, 90)}`));
    }
    return lines;
}
