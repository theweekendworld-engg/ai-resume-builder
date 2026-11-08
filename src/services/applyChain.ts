/**
 * Share and go: the apply chain (docs/impl/07-telegram-apply.md §5).
 *
 * "Apply for me" on a shared post runs four steps without a tap in between:
 *
 *   a. Scout finishes (`finishScoutRun` calls `advanceApplyChain`). A blocking
 *      eligibility conflict stops it with one question ("Apply anyway?"); a
 *      blocking preference question is asked by the run itself, and the chain
 *      carries on when the answer re-runs it.
 *   b. Otherwise the resume is tailored in auto mode: every clarification is
 *      skipped through the "skip all" path, and the skills they asked about
 *      are remembered, so the result can say what was NOT claimed.
 *   c. The generation completes (`notifyTelegramGenerationSession` calls
 *      `settleApplyChainSession`). The application draft is written, focused,
 *      and sent with the PDF as one result. Patronus never sends the email.
 *   d. "sent it" with the draft in focus marks the job Applied
 *      (`markApplicationSent`), which is what the follow-up reminders read.
 *
 * Event-driven on hooks that already exist, never a request held open: each
 * step runs in the function that finished the previous one. Code owns every
 * transition. The state lives on the run's input (`input.apply`), and each
 * change is a conditional write keyed on the row's `updatedAt`, so a retried
 * workflow step or a double tap moves the chain once.
 */

import { Channel, GenerationStatus, Prisma } from '@prisma/client';
import { loadRun, readSections, type AgentRunRow } from '@/lib/agent/run';
import { config } from '@/lib/config';
import type { DraftView } from '@/lib/drafts/types';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import {
    ACTIVE_STAGES,
    applyUrlOf,
    chainOf,
    eligibilityBlocker,
    readApplyChain,
    roleAtCompany,
} from '@/lib/scout/applyChain';
import { SCOUT_AGENT, type ApplyChainState, type ApplyStage, type DraftFormat, type DraftTarget, type ScoutInput, type ScoutRunView, type ShareGoal } from '@/lib/scout/types';
import { toRunView } from '@/lib/scout/view';
import { track } from '@/lib/track';
import type { TailorOptions, TailorStart } from '@/services/tailor';

const JOB_KINDS = new Set(['job_posting', 'hiring_post']);

/** Where the chain can deliver: the generation notifier and the web job page. */
const CHAIN_CHANNEL: Partial<Record<Channel, 'telegram' | 'web'>> = {
    [Channel.telegram]: 'telegram',
    [Channel.web]: 'web',
};

export const UNSUPPORTED_CHANNEL_TEXT = 'Apply for me works on Telegram and the web for now. Tap Tailor resume, or open the job in Patronus.';

// ───────────────────────────────────────────────────────────────── seams

type ChainDeps = {
    tailor: (userId: string, runId: string, channel: 'web' | 'telegram' | 'whatsapp', options: TailorOptions) => Promise<Result<TailorStart>>;
    createDraft: (userId: string, runId: string, params: { target: DraftTarget; format: DraftFormat | null; note?: string | null }) => Promise<Result<DraftView>>;
};

let override: Partial<ChainDeps> = {};

async function deps(): Promise<ChainDeps> {
    const [tailor, drafts] = await Promise.all([
        override.tailor ? null : import('@/services/tailor'),
        override.createDraft ? null : import('@/services/drafts'),
    ]);
    return {
        tailor: override.tailor ?? tailor!.tailorResumeForRun,
        createDraft: override.createDraft ?? drafts!.createDraftForRun,
    };
}

/** Test seam: stand in for tailoring or drafting (each defaults to the real service). */
export const __testing = {
    setDeps(next: Partial<ChainDeps> | null) {
        override = next ?? {};
    },
};

// ───────────────────────────────────────────────────────────────── state

type InputRecord = Record<string, unknown>;

function inputOf(run: Pick<AgentRunRow, 'input'>): InputRecord {
    return run.input && typeof run.input === 'object' && !Array.isArray(run.input) ? (run.input as InputRecord) : {};
}

/**
 * Rewrite the run's input with `decide`, conditional on nobody having written
 * the row since it was read. `decide` returning null means "no change".
 * Null overall only under sustained contention, which a finished run never has.
 */
async function updateRunInput(
    runId: string,
    decide: (input: InputRecord, run: AgentRunRow) => InputRecord | null,
): Promise<{ run: AgentRunRow; changed: boolean } | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const run = await loadRun(runId);
        if (!run) return null;
        const next = decide(inputOf(run), run);
        if (!next) return { run, changed: false };
        const written = await prisma.agentRun.updateMany({
            where: { id: runId, updatedAt: run.updatedAt },
            data: { input: next as Prisma.InputJsonValue },
        });
        if (written.count === 1) return { run: { ...run, input: next as Prisma.JsonValue }, changed: true };
    }
    return null;
}

/** Move the chain from one of `from` to `patch.stage`. Null when it was not in `from`. */
async function transition(runId: string, from: readonly ApplyStage[], patch: Partial<ApplyChainState> & { stage: ApplyStage }): Promise<ApplyChainState | null> {
    let result = null as ApplyChainState | null;
    const written = await updateRunInput(runId, (input) => {
        const current = chainOf(input as ScoutInput);
        if (!current || !from.includes(current.stage)) return null;
        result = { ...current, ...patch, at: new Date().toISOString() };
        return { ...input, apply: result };
    });
    return written?.changed ? result : null;
}

async function currentChain(runId: string): Promise<ApplyChainState | null> {
    const run = await loadRun(runId);
    return run ? chainOf(inputOf(run) as ScoutInput) : null;
}

/** Record what a share asked for on its run (a re-share of a run that exists). */
export async function setShareGoal(runId: string, goal: ShareGoal): Promise<void> {
    await updateRunInput(runId, (input) => (input.goal === goal ? null : { ...input, goal }));
}

// ─────────────────────────────────────────────────────── a. scout finished

/**
 * Take the chain one step after the analysis settles. Called by
 * `finishScoutRun` for every run (a run without `goal: 'apply'` returns at
 * once) and by `requestApply`. Never throws for an expected refusal: it is
 * stored as `stopped` with the reason, and the final message says it.
 */
export async function advanceApplyChain(runId: string): Promise<ApplyChainState | null> {
    const run = await loadRun(runId);
    if (!run || run.agent !== SCOUT_AGENT) return null;
    const chain = chainOf(inputOf(run) as ScoutInput);
    if (!chain || chain.stage !== 'pending') return chain;

    // Still reading, or paused on a blocking question: the answer re-runs the
    // analysis, and its finish brings the chain back here.
    if (run.status === 'queued' || run.status === 'running' || run.status === 'awaiting_input') return chain;

    const stop = async (reason: string, code: string) =>
        (await transition(runId, ['pending'], { stage: 'stopped', reason, code })) ?? currentChain(runId);

    if (run.status === 'failed') return stop('The analysis did not finish, so I could not apply. Send the post again, or paste its text.', 'run_failed');
    if (!run.kind || !JOB_KINDS.has(run.kind)) return stop('This is not a job posting, so there is nothing to apply to.', 'not_applicable');
    const channel = CHAIN_CHANNEL[run.channel];
    if (!channel) return stop(UNSUPPORTED_CHANNEL_TEXT, 'unsupported_channel');

    const blocker = chain.override ? null : eligibilityBlocker(readSections(run));
    if (blocker) return (await transition(runId, ['pending'], { stage: 'eligibility_hold', reason: blocker, code: null })) ?? currentChain(runId);

    // Claimed before the work: a second finish (a retried step) finds `tailoring`.
    const claimed = await transition(runId, ['pending'], { stage: 'tailoring', reason: null, code: null });
    if (!claimed) return currentChain(runId);

    let started: Result<TailorStart>;
    try {
        started = await (await deps()).tailor(run.userId, runId, channel, { auto: true });
    } catch (error) {
        console.error('[apply] tailoring threw', { runId, error: error instanceof Error ? error.message : String(error) });
        started = err('I could not start tailoring your resume. Tap Apply for me to try again.', 'tailor_failed');
    }
    if (!started.success) {
        return (await transition(runId, ['tailoring'], { stage: 'stopped', reason: started.error, code: started.code ?? null })) ?? currentChain(runId);
    }
    await track(run.userId, 'apply_chain_tailoring', { runId, channel, skipped: started.data.skipped?.length ?? 0 });
    // The session may already have completed and moved the chain on; then this is a no-op.
    return (await transition(runId, ['tailoring'], {
        stage: 'tailoring',
        sessionId: started.data.sessionId,
        skipped: started.data.skipped ?? [],
    })) ?? currentChain(runId);
}

// ───────────────────────────────────────────────────── e. "Apply for me"

export type ApplyOutcome = {
    view: ScoutRunView;
    chain: ApplyChainState | null;
    /** The chain was already working on (or done with) this job; nothing new started. */
    already: boolean;
};

/**
 * Start (or restart) the chain for a run the user owns: the "🚀 Apply for me"
 * button, "Yes, apply anyway" (`override`), or a re-share saying "apply for
 * me". A chain that is already working is left alone and reported.
 */
export async function requestApply(
    userId: string,
    runId: string,
    opts: { channel: 'telegram' | 'whatsapp' | 'web'; override?: boolean },
): Promise<Result<ApplyOutcome>> {
    const run = await loadRun(runId);
    if (!run || run.userId !== userId || run.agent !== SCOUT_AGENT) return err('I could not find that job.', 'not_found');
    if (opts.channel === 'whatsapp') return err(UNSUPPORTED_CHANNEL_TEXT, 'unsupported_channel');
    if (run.kind && !JOB_KINDS.has(run.kind)) return err('Only job links and hiring posts can be applied to.', 'not_applicable');

    // Delivered where the user asked from: the session takes the run's channel.
    if (CHAIN_CHANNEL[run.channel] !== opts.channel) {
        await prisma.agentRun.update({ where: { id: runId }, data: { channel: opts.channel === 'web' ? Channel.web : Channel.telegram } });
    }

    let already = false;
    const written = await updateRunInput(runId, (input) => {
        const current = input.goal === 'apply' ? readApplyChain(input) : null;
        if (current && ACTIVE_STAGES.has(current.stage)) {
            already = true;
            return null;
        }
        const next: ApplyChainState = {
            stage: 'pending',
            at: new Date().toISOString(),
            ...(opts.override || current?.override ? { override: true } : {}),
        };
        return { ...input, goal: 'apply', apply: next };
    });
    if (!written) return err('That job is busy updating. Try again in a moment.', 'conflict');

    if (!already) await advanceApplyChain(runId);
    const fresh = (await loadRun(runId)) ?? run;
    await track(userId, 'apply_chain_requested', { runId, channel: opts.channel, already, override: Boolean(opts.override) });
    return ok({ view: toRunView(fresh), chain: chainOf(inputOf(fresh) as ScoutInput), already });
}

/** "No, skip it" at the eligibility question. */
export async function declineApply(userId: string, runId: string): Promise<Result<void>> {
    const run = await loadRun(runId);
    if (!run || run.userId !== userId || run.agent !== SCOUT_AGENT) return err('I could not find that job.', 'not_found');
    await transition(runId, ['eligibility_hold', 'pending'], { stage: 'declined', reason: null, code: null });
    return ok(undefined);
}

// ──────────────────────────────────────────────── c. generation completed

type SettledSession = {
    id: string;
    userId: string;
    status: GenerationStatus;
    channel: Channel;
    clarifications: Prisma.JsonValue | null;
    resultResumeId: string | null;
    pdfUrl: string | null;
    errorMessage: string | null;
};

/**
 * A generation finished. When the apply chain started it, write the
 * application draft, focus it, and deliver the PDF and the draft together.
 * Returns true when the session was the chain's to announce (the plain "resume
 * ready" message must then not be sent); false for every other session, and
 * for a failed one, whose plain failure notice still goes out.
 */
export async function settleApplyChainSession(sessionId: string): Promise<boolean> {
    const session = await prisma.generationSession.findUnique({
        where: { id: sessionId },
        select: { id: true, userId: true, status: true, channel: true, clarifications: true, resultResumeId: true, pdfUrl: true, errorMessage: true },
    });
    if (!session) return false;
    const { chainLinkOf } = await import('@/services/channelGenerate');
    const link = chainLinkOf(session.clarifications);
    if (!link) return false;
    if (session.status !== GenerationStatus.completed && session.status !== GenerationStatus.failed) return false;

    const run = await loadRun(link.runId);
    if (!run || run.userId !== session.userId || run.agent !== SCOUT_AGENT) return false;
    const chain = chainOf(inputOf(run) as ScoutInput);
    if (!chain || (chain.sessionId && chain.sessionId !== session.id)) return false;

    if (session.status === GenerationStatus.failed) {
        await transition(run.id, ['tailoring'], {
            stage: 'stopped',
            reason: 'The resume could not be made. Tap Regenerate, or Apply for me to start again.',
            code: 'generation_failed',
        });
        return false;
    }
    if (chain.stage !== 'tailoring') return chain.stage === 'drafting' || chain.stage === 'drafted' || chain.stage === 'applied';

    // Claimed first: the workflow's notify step can run twice.
    const claimed = await transition(run.id, ['tailoring'], { stage: 'drafting', sessionId: session.id });
    if (!claimed) return true;

    try {
        await deliver(run, claimed, session);
    } catch (error) {
        // Past the claim, nothing may fall through to the plain announcement
        // (it would send the PDF a second time). Say it and alert.
        console.error('[apply] delivery failed', { runId: run.id, sessionId, error: error instanceof Error ? error.message : String(error) });
        const { alertOperators } = await import('@/lib/opsAlert');
        await alertOperators({
            key: 'apply_chain:delivery',
            title: 'Apply chain delivery failed',
            lines: [`run ${run.id}, session ${sessionId}`, error instanceof Error ? error.name : 'error'],
        });
    }
    return true;
}

async function deliver(run: AgentRunRow, chain: ApplyChainState, session: SettledSession): Promise<void> {
    const view = toRunView(run);
    const target: DraftTarget = run.kind === 'hiring_post' ? 'poster' : 'recruiter';

    let draft: DraftView | null = null;
    let draftError: string | null = null;
    try {
        // Format null: an email when the posting gives an address, else a
        // LinkedIn message to the recruiter or poster (src/services/drafts.ts).
        const created = await (await deps()).createDraft(run.userId, run.id, { target, format: null });
        if (created.success) draft = created.data;
        else draftError = created.error;
    } catch (error) {
        console.warn('[apply] draft failed', { runId: run.id, error: error instanceof Error ? error.message : String(error) });
        draftError = 'Could not write that draft. Try again.';
    }
    // The web thread gets its message BEFORE the chain reads `drafted`: the
    // chat's progress card re-reads the thread the moment it sees that stage.
    if (session.channel === Channel.web) {
        await appendApplyResultWeb({ run, view, chain, session, draft, draftError }).catch((error: unknown) => {
            console.warn('[apply] could not add the result to the web chat', { runId: run.id, error: error instanceof Error ? error.message : String(error) });
        });
    }
    await transition(run.id, ['drafting'], { stage: 'drafted', draftId: draft?.id ?? null, reason: draftError });

    if (session.channel === Channel.telegram) {
        if (draft) {
            const { setFocus } = await import('@/lib/chat/focus');
            await setFocus(run.userId, Channel.telegram, { kind: 'draft', draftId: draft.id, runId: draft.runId, workspaceId: draft.workspaceId })
                .catch((error: unknown) => console.warn('[apply] could not focus the draft', { error: String(error) }));
        }
        await sendApplyResultTelegram({ run, view, chain, session, draft, draftError });
    }

    const { generationStateKey } = await import('@/services/telegramGenerationNotifications');
    await prisma.generationSession.update({ where: { id: session.id }, data: { lastNotifiedState: generationStateKey(session) } });
    await track(run.userId, 'apply_chain_drafted', { runId: run.id, channel: session.channel, format: draft?.format ?? null, drafted: Boolean(draft) });
}

/**
 * The web's result: one assistant message in the user's web chat, with the
 * tailored resume (Open, PDF) and the draft (To, Subject, Body, Open in
 * Gmail / Mail app or Open the application, Copy, Mark as applied). The job
 * page has the same draft, with Shorter / Stronger.
 */
async function appendApplyResultWeb(params: {
    run: AgentRunRow;
    view: ScoutRunView;
    chain: ApplyChainState;
    session: SettledSession;
    draft: DraftView | null;
    draftError: string | null;
}): Promise<void> {
    const pdf = await prisma.generatedPdf.findFirst({
        where: {
            userId: params.run.userId,
            sessionId: params.session.id,
            ...(params.session.resultResumeId ? { resumeId: params.session.resultResumeId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    const [{ applyResultReply }, { appendAssistantMessage }] = await Promise.all([
        import('@/lib/chat/applyResult'),
        import('@/services/chat'),
    ]);
    const reply = applyResultReply({
        runId: params.run.id,
        label: roleAtCompany(params.view.sections).label,
        sessionId: params.session.id,
        resumeId: params.session.resultResumeId,
        pdfUrl: pdf ? `/api/pdfs/${encodeURIComponent(pdf.id)}` : null,
        draft: params.draft,
        draftError: params.draftError,
        skipped: params.chain.skipped ?? [],
        applyUrl: applyUrlOf(params.view.sections, params.view.input.url),
    });
    await appendAssistantMessage(params.run.userId, reply, { channel: Channel.web, action: 'draft_outreach' });
}

/** The PDF (named, captioned, Open resume · Regenerate), then the draft with its compose buttons. */
async function sendApplyResultTelegram(params: {
    run: AgentRunRow;
    view: ScoutRunView;
    chain: ApplyChainState;
    session: SettledSession;
    draft: DraftView | null;
    draftError: string | null;
}): Promise<void> {
    const notifications = await import('@/services/telegramGenerationNotifications');
    const chatId = await notifications.telegramChatFor(params.run.userId);
    if (!chatId) return;

    const resumeUrl = params.session.resultResumeId ? `${config.app.url}/editor/${params.session.resultResumeId}` : null;
    const pdf = await notifications.sendTailoredPdf({
        chatId,
        userId: params.run.userId,
        sessionId: params.session.id,
        resumeId: params.session.resultResumeId,
        replyMarkup: notifications.completionKeyboard(params.session.id, resumeUrl),
    });
    const [{ sendTelegramMessage }, { escapeTelegramHtml }, { sendTelegramRich }, { renderApplicationDraftForTelegram, renderApplicationDraftFailure }] = await Promise.all([
        import('@/lib/telegram'),
        import('@/lib/channels/format'),
        import('@/lib/channels/telegramScout'),
        import('@/lib/drafts/render'),
    ]);
    if (!pdf.sent) {
        await sendTelegramMessage({
            chatId,
            parseMode: 'HTML',
            text: `${escapeTelegramHtml(pdf.caption)}${resumeUrl ? `\n<a href="${escapeTelegramHtml(resumeUrl)}">Open resume</a>` : ''}`,
            replyMarkup: notifications.completionKeyboard(params.session.id, resumeUrl),
        });
    }

    const applyUrl = applyUrlOf(params.view.sections, params.view.input.url);
    const message = params.draft
        ? renderApplicationDraftForTelegram(params.draft, { pdfAttached: pdf.sent, skipped: params.chain.skipped ?? [], applyUrl })
        : renderApplicationDraftFailure({
            label: roleAtCompany(params.view.sections).label,
            error: params.draftError ?? 'Could not write that draft. Try again.',
            target: params.run.kind === 'hiring_post' ? 'p' : 'r',
            applyUrl,
        });
    await sendTelegramRich(chatId, message, params.run.id);
}

// ─────────────────────────────────────────────────── d. "sent it"

/**
 * The user said they sent a draft that was in focus. When it is an
 * application (an email to the posting's apply address, or the chain's own
 * draft), mark the job Applied, which is what the weekly follow-up reminder
 * (`journey_daily`) looks for. Never moves a job backwards: one already at
 * Applied or further is left alone and still counts. False when the draft was
 * not an application (a referral note) or there is no job to mark.
 */
export async function markApplicationSent(
    userId: string,
    draft: Pick<DraftView, 'id' | 'runId' | 'workspaceId' | 'format' | 'target' | 'toEmail'>,
): Promise<boolean> {
    const run = draft.runId ? await loadRun(draft.runId) : null;
    const owned = run && run.userId === userId && run.agent === SCOUT_AGENT ? run : null;
    const chain = owned ? chainOf(inputOf(owned) as ScoutInput) : null;
    const chainOwns = chain?.stage === 'drafted' || chain?.stage === 'applied';
    const toApplyInbox = draft.format === 'email' && Boolean(draft.toEmail);
    const application = (draft.target === 'recruiter' || draft.target === 'poster') && (toApplyInbox || chainOwns);
    if (!application) return false;

    const workspace = await prisma.applicationWorkspace.findFirst({
        where: draft.workspaceId ? { id: draft.workspaceId, userId } : { scoutRunId: draft.runId ?? '', userId },
        select: { id: true, applicationStatus: true },
    });
    if (!workspace) return false;

    const ALREADY: ReadonlySet<string> = new Set(['submitted', 'applied', 'in_review', 'interview', 'offer']);
    if (!ALREADY.has(workspace.applicationStatus)) {
        const { setJobStatus } = await import('@/services/careerInbox');
        const moved = await setJobStatus(userId, { workspaceId: workspace.id }, 'applied');
        if (!moved.success) return false;
    }
    if (owned && chain) await transition(owned.id, ['drafted'], { stage: 'applied' });
    await track(userId, 'apply_chain_sent', { runId: draft.runId, chain: Boolean(chainOwns) });
    return true;
}

/** What "sent it" gets back when the job was marked Applied. */
export const APPLIED_REPLY = 'Marked Applied. I\'ll remind you to follow up in a week.';
