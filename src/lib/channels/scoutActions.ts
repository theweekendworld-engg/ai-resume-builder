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
 *   sc:t:<runId>                        tailor a resume for the run's job
 *   sc:v:<draftId>:<revision>           revise a MessageDraft (s shorter, g stronger)
 *   sc:g:<runId>[:y|n]                  apply for me (the apply chain); y = apply anyway, n = stop
 *
 * `sc:d:<runId>:<target>:e` (an email) writes a versioned MessageDraft with
 * compose buttons (src/services/drafts.ts); the LinkedIn formats keep the
 * one-off draft they always had.
 *
 * Indexes and single-letter codes rather than values: an option value such as
 * "willing_to_relocate_case_by_case" would overflow the Telegram limit. The
 * first four formats are unchanged, so buttons already sitting in chats keep
 * working.
 */

import { orderStrengths } from '@/lib/scout/fit/strength';
import type { DraftFormat, DraftTarget, FitData, JdData, OutreachDraft, ScoutRunView } from '@/lib/scout/types';
import type { DraftFormatCode, DraftRevisionCode, DraftTargetCode, JobStatusCode, Line, RichMessage, ScoutAction } from '@/lib/channels/types';
import type { DraftRevision, DraftView } from '@/lib/drafts/types';
import { REVISION_INSTRUCTIONS } from '@/lib/drafts/revisions';
import { JOB_ACTION_LABELS, type JobAction, type JobBoardItem } from '@/lib/inbox/types';
import type { Result } from '@/lib/result';
import type { TailorStart } from '@/services/tailor';
import type { ApplyOutcome } from '@/services/applyChain';
import { config } from '@/lib/config';
import { questionsIntro, CLARIFICATION_REPLY_HINT } from '@/lib/channels/clarification';
import { roleAtCompany } from '@/lib/scout/applyChain';
import { rememberedNote } from '@/lib/memory/format';

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

export const REVISION_CODES: Record<DraftRevisionCode, DraftRevision> = {
    s: 'shorter',
    g: 'stronger',
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
    | { kind: 'dismiss_win'; winId: string }
    | { kind: 'tailor'; runId: string }
    | { kind: 'revise_draft'; draftId: string; revision: DraftRevision }
    | { kind: 'apply'; runId: string; confirm?: 'y' | 'n' };

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
        case 'tailor':
            return `sc:t:${runId}`;
        case 'revise_draft':
            return `sc:v:${action.draftId}:${action.revision}`;
        case 'apply':
            return action.confirm ? `sc:g:${runId}:${action.confirm}` : `sc:g:${runId}`;
    }
}

/** The fit's non-blocking follow-up on a finished run, if any. */
function followUpOf(view: { sections: Record<string, { status: string; data?: unknown } | undefined> }): { id: string; prompt: string; options?: { label: string; value: string }[] } | null {
    const fit = view.sections.fit;
    if (!fit || fit.status !== 'ok') return null;
    return ((fit.data as { followUp?: { id: string; prompt: string; options?: { label: string; value: string }[] } | null }).followUp) ?? null;
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
        case 't':
            return { kind: 'tailor', runId: id };
        case 'v': {
            const revision = REVISION_CODES[a as DraftRevisionCode];
            return revision ? { kind: 'revise_draft', draftId: id, revision } : null;
        }
        case 'g':
            if (a === undefined) return { kind: 'apply', runId: id };
            return a === 'y' || a === 'n' ? { kind: 'apply', runId: id, confirm: a } : null;
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
    tailorResumeForRun: (userId: string, runId: string, channel: 'web' | 'telegram' | 'whatsapp') => Promise<Result<TailorStart>>;
    /** The next unanswered clarification of a generation session, or null. */
    nextGenerationQuestion: (userId: string, sessionId: string) => Promise<string | null>;
    /** Versioned drafts. Optional so channel test doubles need not grow; absent means the real service. */
    drafts?: DraftActionDeps;
    /** The apply chain. Optional for the same reason; absent means `src/services/applyChain.ts`. */
    apply?: ApplyActionDeps;
};

export type ApplyActionDeps = {
    requestApply: (userId: string, runId: string, opts: { channel: 'telegram' | 'whatsapp' | 'web'; override?: boolean }) => Promise<Result<ApplyOutcome>>;
    declineApply: (userId: string, runId: string) => Promise<Result<void>>;
};

type ActionChannel = 'telegram' | 'whatsapp';

export type DraftActionDeps = {
    createDraftForRun: (
        userId: string,
        runId: string,
        params: { target: DraftTarget; format: DraftFormat | null; note?: string | null },
    ) => Promise<Result<DraftView>>;
    reviseDraft: (userId: string, draftId: string, instruction: string) => Promise<Result<DraftView>>;
    /** Point the channel's focus at this version, so a typed follow-up edits it. */
    focusDraft: (userId: string, channel: ActionChannel, draft: DraftView) => Promise<void>;
    render: (draft: DraftView, channel: ActionChannel) => RichMessage;
};

async function defaultDraftDeps(): Promise<DraftActionDeps> {
    const [drafts, focus, render, prismaClient] = await Promise.all([
        import('@/services/drafts'),
        import('@/lib/chat/focus'),
        import('@/lib/drafts/render'),
        import('@prisma/client'),
    ]);
    return {
        createDraftForRun: drafts.createDraftForRun,
        reviseDraft: drafts.reviseDraft,
        focusDraft: (userId, channel, draft) => focus.setFocus(userId, prismaClient.Channel[channel], {
            kind: 'draft',
            draftId: draft.id,
            runId: draft.runId,
            workspaceId: draft.workspaceId,
        }),
        render: (draft, channel) => (channel === 'whatsapp' ? render.renderDraftForWhatsApp(draft) : render.renderDraftForTelegram(draft)),
    };
}

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
    const [service, inbox, wins, tailor, generation] = await Promise.all([
        import('@/services/scout'),
        import('@/services/careerInbox'),
        import('@/services/wins'),
        import('@/services/tailor'),
        import('@/lib/channels/generationQuestion'),
    ]);
    return {
        tailorResumeForRun: tailor.tailorResumeForRun,
        nextGenerationQuestion: generation.nextGenerationQuestion,
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
    context: { channel: 'telegram' | 'whatsapp' } = { channel: 'telegram' },
): Promise<ScoutActionReply> {
    const svc = deps ?? (await defaultDeps());

    switch (action.kind) {
        case 'answer': {
            const run = await svc.getScoutRun(userId, action.runId);
            if (!run.success) return { lines: [text('I could not find that analysis.')] };
            // A blocking question, or the fit's non-blocking follow-up (the pay floor).
            const question = run.data.pendingQuestion ?? followUpOf(run.data);
            const option = question?.options?.[action.index];
            if (!question || !option) {
                return { lines: [text('That question has already been answered.')] };
            }
            const answered = await svc.answerScoutQuestion(userId, action.runId, option.value);
            if (!answered.success) return { lines: [text(answered.error)] };
            return { lines: [text(`Got it: ${option.label}. Updating the fit…`)] };
        }
        case 'draft': {
            if (action.format === 'email') return draftEmailReply(userId, action.runId, action.target, svc, context.channel);
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
        case 'tailor':
            return tailorReply(userId, action.runId, svc, context.channel);
        case 'revise_draft':
            return reviseReply(userId, action.draftId, action.revision, svc, context.channel);
        case 'apply':
            return applyReply(userId, action.runId, action.confirm, svc, context.channel);
    }
}

async function defaultApplyDeps(): Promise<ApplyActionDeps> {
    const chain = await import('@/services/applyChain');
    return { requestApply: chain.requestApply, declineApply: chain.declineApply };
}

/**
 * "🚀 Apply for me", and the eligibility question's Yes / No. The chain does
 * the work in the background; this says what it is doing now.
 */
async function applyReply(
    userId: string,
    runId: string,
    confirm: 'y' | 'n' | undefined,
    svc: ScoutActionDeps,
    channel: ActionChannel,
): Promise<ScoutActionReply> {
    const chain = svc.apply ?? (await defaultApplyDeps());
    if (confirm === 'n') {
        const declined = await chain.declineApply(userId, runId);
        if (!declined.success) return { lines: [text(declined.error)] };
        return { lines: [text('OK, I will not apply to this one. It stays in your tracker.')], settled: true };
    }
    const requested = await chain.requestApply(userId, runId, { channel, override: confirm === 'y' });
    if (!requested.success) {
        const next = nextStepFor(requested.code);
        return { lines: [text(requested.error)], actions: next ? [next] : undefined, runId };
    }
    return { ...applyOutcomeReply(requested.data), settled: true };
}

/** What the chain is doing, as a reply. Pure, for the button and for a re-share. */
export function applyOutcomeReply(outcome: ApplyOutcome): ScoutActionReply {
    const { view, chain, already } = outcome;
    const { label } = roleAtCompany(view.sections);
    const runId = view.id;
    if (view.status === 'awaiting_input' && view.pendingQuestion) {
        const question = view.pendingQuestion;
        return {
            lines: [
                text(`I will apply to ${label} as soon as you answer this:`),
                [{ text: question.prompt, bold: true }],
                ...((question.options ?? []).length ? [] : [[{ text: 'Reply here with your answer.', italic: true }]]),
            ],
            actions: (question.options ?? []).map((option, index) => ({ kind: 'answer' as const, index, label: option.label })),
            runId,
        };
    }
    if (view.status === 'queued' || view.status === 'running') {
        return { lines: [text(`Still reading ${label}. I will tailor your resume and draft the application as soon as the analysis is done.`)] };
    }
    switch (chain?.stage) {
        case 'eligibility_hold':
            return {
                lines: [[{ text: `${chain.reason ?? 'You may not be eligible for this one.'} Apply anyway?`, bold: true }]],
                actions: [
                    { kind: 'apply', confirm: 'y', label: 'Yes, apply anyway' },
                    { kind: 'apply', confirm: 'n', label: 'No, skip it' },
                ],
                runId,
            };
        case 'tailoring':
        case 'drafting':
            return {
                lines: [text(already
                    ? `Already on it: tailoring your resume for ${label}. The PDF and the draft follow here.`
                    : `🚀 On it. Tailoring your resume for ${label} now; the PDF and your application draft follow here, usually within a couple of minutes.`)],
            };
        case 'drafted':
            return { lines: [text(`The PDF and the draft for ${label} are above. Send it from your mail app, then tell me "sent it" and I will mark it Applied.`)] };
        case 'applied':
            return { lines: [text(`You already applied to ${label}. It is in your tracker under Applied.`)] };
        case 'stopped': {
            const next = nextStepFor(chain.code ?? undefined);
            return { lines: [text(chain.reason ?? 'I could not apply to this one.')], actions: next ? [next] : undefined, runId };
        }
        default:
            return { lines: [text(`Applying to ${label}. I will send the PDF and the draft here.`)] };
    }
}

/** A draft version as the reply, with the focus moved to it. */
async function draftReply(drafts: DraftActionDeps, userId: string, draft: DraftView, channel: ActionChannel): Promise<ScoutActionReply> {
    // The focus is a convenience (a typed "add IIT Delhi" edits this draft);
    // failing to set it must not lose the draft the user just paid for.
    await drafts.focusDraft(userId, channel, draft).catch((error: unknown) => {
        console.warn('[scout] could not focus the draft', { draftId: draft.id, error: error instanceof Error ? error.message : String(error) });
    });
    const message = drafts.render(draft, channel);
    return { lines: message.lines, actions: message.actions, runId: draft.runId ?? undefined };
}

/** "✉️ Email jobs@x.com": version 1 of an application email, To from the posting. */
async function draftEmailReply(
    userId: string,
    runId: string,
    target: DraftTarget,
    svc: ScoutActionDeps,
    channel: ActionChannel,
): Promise<ScoutActionReply> {
    const drafts = svc.drafts ?? (await defaultDraftDeps());
    const created = await drafts.createDraftForRun(userId, runId, { target, format: 'email' });
    if (!created.success) {
        const next = nextStepFor(created.code);
        return { lines: [text(created.error)], actions: next ? [next] : undefined, runId };
    }
    return draftReply(drafts, userId, created.data, channel);
}

/** "✂️ Shorter" / "💪 Stronger": the next version of the tapped one. */
async function reviseReply(
    userId: string,
    draftId: string,
    revision: DraftRevision,
    svc: ScoutActionDeps,
    channel: ActionChannel,
): Promise<ScoutActionReply> {
    const drafts = svc.drafts ?? (await defaultDraftDeps());
    const revised = await drafts.reviseDraft(userId, draftId, REVISION_INSTRUCTIONS[revision]);
    if (!revised.success) return { lines: [text(revised.error)] };
    return draftReply(drafts, userId, revised.data, channel);
}

/** The one link that unblocks a refused generation. */
export function nextStepFor(code: string | undefined): ScoutAction | null {
    const app = config.app.url.replace(/\/$/, '');
    // "See your usage", not "See plans": during the launch there is nothing to buy.
    if (code === 'entitlement_required') return { kind: 'open', label: 'See your usage', url: `${app}/settings/plan` };
    if (code === 'no_base_resume' || code === 'empty_profile') {
        return { kind: 'open', label: 'Add your resume', url: `${app}/dashboard?section=profile` };
    }
    return null;
}

/**
 * "✍️ Tailor resume": the job's JD is already stored, so no copy-paste.
 * The finished resume arrives through the generation notifier; a question the
 * generator needs first is asked right here, and answered by replying.
 */
async function tailorReply(
    userId: string,
    runId: string,
    svc: ScoutActionDeps,
    channel: 'telegram' | 'whatsapp',
): Promise<ScoutActionReply> {
    const started = await svc.tailorResumeForRun(userId, runId, channel);
    if (!started.success) {
        // Every refusal gets the way forward, keyed on the service's code, not its wording.
        const next = nextStepFor(started.code);
        return { lines: [text(started.error)], actions: next ? [next] : undefined, runId };
    }
    const run = await svc.getScoutRun(userId, runId);
    const label = run.success ? jobLabelFromView(run.data) : 'this job';
    // Said every time memory answered in place of a question, so the user sees
    // what went in and where to change it (docs/impl/08-memory.md).
    const recalledNote = rememberedNote(started.data.remembered);
    const recalled: Line[] = recalledNote ? [[], ...recalledNote.split('\n').map((line) => [{ text: line, italic: true }])] : [];

    if (started.data.status === 'completed') {
        const url = started.data.resumeId ? `${config.app.url}/editor/${started.data.resumeId}` : null;
        return {
            lines: [text(`Your resume for ${label} is ready.`)],
            actions: url ? [{ kind: 'open', label: 'Open resume', url }] : undefined,
            runId,
        };
    }
    if (started.data.status === 'awaiting_clarification') {
        const question = started.data.nextQuestion?.question
            ?? await svc.nextGenerationQuestion(userId, started.data.sessionId);
        const progress = started.data.progress ?? { current: 1, total: 1 };
        // The same words as /generate (src/services/telegramAgent.ts): "3 quick
        // questions…", then "Question 1 of 3: …". It said "One detail first"
        // even when there were three.
        const intro = `Tailoring your resume for ${label}. Before I write it, ${questionsIntro(progress.total)}`;
        if (channel === 'whatsapp') {
            return {
                lines: [text(`${intro} Answer ${progress.total > 1 ? 'them' : 'it'} in Patronus.`), ...recalled],
                actions: [{ kind: 'open', label: 'Answer in Patronus', url: `${config.app.url}/build` }],
                runId,
            };
        }
        const numbered = progress.total > 1 ? `Question ${progress.current} of ${progress.total}: ` : '';
        return {
            lines: [
                text(intro),
                [{ text: `${numbered}${question ?? 'Reply with anything the job asks for that your record does not show yet.'}`, bold: true }],
                [{ text: CLARIFICATION_REPLY_HINT, italic: true }],
                ...recalled,
            ],
        };
    }
    return { lines: [text(`Tailoring your resume for ${label}. I will send it here when it is ready, usually within a minute.`), ...recalled] };
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
    const strengths = orderStrengths(data.matched).filter((match) => match.strength !== 'partial').slice(0, 3);
    if (strengths.length > 0) {
        lines.push([], [{ text: 'What you already have', bold: true }]);
        for (const match of strengths) lines.push(text(`• ${shorten(match.text, 90)}`));
    }
    return lines;
}
