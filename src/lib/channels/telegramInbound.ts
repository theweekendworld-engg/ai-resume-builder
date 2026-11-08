/**
 * Telegram → Scout and the career inbox. Called from `processTelegramUpdate`
 * after the account is known to be linked. Returns true when the message was
 * ours to handle.
 */

import { Channel } from '@prisma/client';
import { matchAnswer } from '@/lib/channels/answerMatch';
import { config } from '@/lib/config';
import { classifyInbound, startFailureText, TINY_HELP } from '@/lib/channels/inbound';
import { renderInboxCommand, type InboxCommand } from '@/lib/channels/inboxCommands';
import { applyOutcomeReply, decodeScoutAction, executeScoutAction, type ScoutActionReply } from '@/lib/channels/scoutActions';
import { scoutChannelDeps } from '@/lib/channels/scoutDeps';
import { sendScoutFinalTelegram, sendTelegramLines, sendTelegramRich } from '@/lib/channels/telegramScout';
import { decideShareGoal, goalByCode, splitShare, type ShareGoal } from '@/lib/scout/goal';
import { editTelegramMessageDetailed, editTelegramReplyMarkup, sendTelegramMessageDetailed } from '@/lib/telegram';
import { track } from '@/lib/track';

const FINISHED = new Set(['succeeded', 'partial', 'failed', 'awaiting_input']);

async function say(chatId: string, text: string): Promise<void> {
    await sendTelegramLines(chatId, [[{ text }]]);
}

/** First words of the progress message, so a note does not say "Reading the link". */
function openingLine(shared: { url: string | null; text: string | null }, goal: ShareGoal | null = null): string {
    // Said up front, so the user knows they can put the phone down.
    if (goal === 'apply') return '🚀 Reading the job first. Then I will tailor your resume and draft the application.';
    if (shared.url) return '🔎 Reading the link…';
    if ((shared.text ?? '').length >= 200) return '🔎 Reading the post…';
    return '📝 Recording that…';
}

/** A file's two halves, which arrived apart: the caption (the note) and the document's text (the post). */
export type ShareHint = { post: string; note?: string | null };

/** Start a run from shared text, with a progress message the notifier edits. */
export async function startTelegramScout(
    chatId: string,
    userId: string,
    raw: string,
    /** Set when chat routed the text to company research (docs/prd/10-chat.md). */
    research?: { company: string },
    hint?: ShareHint,
): Promise<void> {
    const deps = await scoutChannelDeps();
    // The post and the user's own line about it are separate things
    // (src/lib/scout/goal.ts): the post is analysed, the line is the goal.
    const shared = research ? { url: null, text: `Research the company: ${research.company}`, note: null } : splitShare(raw, hint);
    if (!shared.url && !shared.text) {
        await say(chatId, 'Send a LinkedIn job or post link, or paste the post text.');
        return;
    }

    // Keywords decide most notes for free, before the first message, so it can
    // say what is about to happen. Only an unclear note waits on the model.
    const known: ShareGoal | null = shared.note ? goalByCode(shared.note) : 'evaluate';
    const initial = await sendTelegramMessageDetailed({
        chatId,
        text: research ? `🔎 Looking into ${research.company}…` : openingLine(shared, known),
    });
    const decided = known ? { goal: known, by: shared.note ? 'code' : 'none' } : await decideShareGoal({ userId, note: shared.note });
    const goal = research ? 'evaluate' : decided.goal;
    if (shared.note) await track(userId, 'share_goal_decided', { goal, by: decided.by, channel: 'telegram' });
    const result = await deps.startScoutRun({
        userId,
        input: {
            url: shared.url,
            text: shared.text,
            source: 'telegram',
            ...(research ? { intent: 'company_research' as const, company: research.company } : {}),
            ...(goal !== 'evaluate' ? { goal } : {}),
        },
        channel: 'telegram',
        channelRef: { chatId, messageId: initial.messageId },
    });

    const replace = async (text: string) => {
        if (initial.messageId) {
            const edited = await editTelegramMessageDetailed({ chatId, messageId: initial.messageId, text });
            if (edited.ok) return;
        }
        await say(chatId, text);
    };

    if (!result.success) {
        await replace(startFailureText(result.error, result.code, config.app.url));
        return;
    }
    const view = result.data.run;
    const apply = deps.apply ?? await import('@/services/applyChain');
    if (result.data.created) {
        // A run restarted from an earlier share (it stalled, or never
        // started) keeps that share's input: give it this share's goal.
        if (goal !== 'evaluate' && view.input.goal !== goal) {
            if (goal === 'apply') await apply.requestApply(userId, view.id, { channel: 'telegram' });
            else await (await import('@/services/applyChain')).setShareGoal(view.id, goal).catch(() => undefined);
        }
        return; // The notifier takes it from here.
    }

    // The same post again, with a goal this time ("apply for me"): the run
    // exists, so the goal is applied to it rather than starting another.
    if (goal === 'apply') {
        const requested = await apply.requestApply(userId, view.id, { channel: 'telegram' });
        if (!requested.success) {
            await replace(requested.error);
            return;
        }
        const reply = applyOutcomeReply(requested.data);
        await replace(FINISHED.has(view.status) ? 'You shared this one before.' : 'Already reading this one.');
        await sendReply(chatId, reply);
        return;
    }
    if (goal !== 'evaluate') {
        const { setShareGoal } = await import('@/services/applyChain');
        await setShareGoal(view.id, goal).catch(() => undefined);
    }
    if (FINISHED.has(view.status)) {
        await replace('You shared this one before. Here is what I found:');
        await sendScoutFinalTelegram(chatId, goal === 'evaluate' ? view : { ...view, input: { ...view.input, goal } });
    } else {
        await replace('Already working on this one. This message will update.');
    }
}

/**
 * Free text from a linked user. Everything is recorded: a link, a pasted post
 * or a note starts a run. The one exception is an answer to the question an
 * open Scout run is waiting on. Returns false only when Scout is off for the
 * user, so the old resume-bot help still applies to them.
 */
export async function handleTelegramScoutText(chatId: string, userId: string, text: string, hint?: ShareHint): Promise<boolean> {
    const deps = await scoutChannelDeps();
    if (!(await deps.isScoutEnabled(userId))) return false;

    const intent = classifyInbound(text);
    if (intent === 'share') {
        await startTelegramScout(chatId, userId, text, undefined, hint);
        return true;
    }
    if (intent === 'reply' || intent === 'tiny') {
        const open = await deps.findOpenQuestionRun(userId);
        // Only a message that plausibly answers the question is taken as the
        // answer; anything else is new input (a note must never be swallowed).
        const value = open?.pendingQuestion && !(await draftOwnsReply(userId, open))
            ? matchAnswer(open.pendingQuestion, text)
            : null;
        if (open && value !== null) {
            const answered = await deps.answerScoutQuestion(userId, open.id, value);
            await say(chatId, answered.success ? 'Got it. Updating the fit…' : answered.error);
            return true;
        }
        if (intent === 'reply') {
            const routed = await deps.routeChannelText?.(userId, text, 'telegram');
            if (routed?.kind === 'reply') {
                await say(chatId, routed.text);
                return true;
            }
            if (routed?.kind === 'rich') {
                await sendTelegramRich(chatId, routed.message, routed.runId ?? 'none');
                return true;
            }
            await startTelegramScout(chatId, userId, text, routed?.kind === 'scout' && routed.company ? { company: routed.company } : undefined);
            return true;
        }
        // "hi", "thanks": the assistant answers when chat is on; a short
        // message is never recorded as a note, so a Scout route falls back to help.
        const routed = await deps.routeChannelText?.(userId, text, 'telegram');
        if (routed?.kind === 'rich') {
            // "shorter" while a draft is in focus: a tiny message that is an edit.
            await sendTelegramRich(chatId, routed.message, routed.runId ?? 'none');
            return true;
        }
        await say(chatId, routed?.kind === 'reply' ? routed.text : TINY_HELP);
        return true;
    }
    return false;
}

/**
 * A reply goes to the draft, not to an open Scout question, when the draft is
 * the newer thing in the conversation: "sent it" after the apply chain's
 * email must not become the answer to the pay-floor question asked minutes
 * earlier (an open-ended question takes any short reply for 30 minutes).
 * Also when the question is the follow-up of a run the user asked to apply
 * to: the chain's message does not show it, so nothing typed answers it.
 */
async function draftOwnsReply(userId: string, open: { status: string; input: { goal?: unknown }; pendingQuestion: { askedAt?: string } | null }): Promise<boolean> {
    if (open.status !== 'awaiting_input' && open.input?.goal === 'apply') return true;
    const askedAt = open.pendingQuestion?.askedAt ? Date.parse(open.pendingQuestion.askedAt) : NaN;
    const { draftFocusedSince } = await import('@/lib/chat/focus');
    return draftFocusedSince(userId, Channel.telegram, Number.isFinite(askedAt) ? new Date(askedAt) : new Date(0)).catch(() => false);
}

/** `/scout <link or text>`. */
export async function handleTelegramScoutCommand(chatId: string, userId: string, payload: string): Promise<void> {
    const deps = await scoutChannelDeps();
    if (!(await deps.isScoutEnabled(userId))) {
        await say(chatId, 'Scout is not available on your account yet.');
        return;
    }
    if (!payload.trim()) {
        await say(chatId, 'Usage: /scout <LinkedIn job or post link>. Or just send me the link.');
        return;
    }
    await startTelegramScout(chatId, userId, payload);
}

/** `/jobs`, `/applied`, `/insights`, `/notes`, `/help` for a linked user. */
export async function handleTelegramInboxCommand(chatId: string, userId: string, command: InboxCommand): Promise<void> {
    const deps = await scoutChannelDeps();
    if (command !== 'help' && !(await deps.isScoutEnabled(userId))) {
        await say(chatId, 'Your career inbox is not available on your account yet.');
        return;
    }
    const message = await renderInboxCommand(command, userId, deps, config.app.url, { bare: false });
    await sendTelegramRich(chatId, message, 'none');
}

async function sendReply(chatId: string, reply: ScoutActionReply): Promise<void> {
    if (reply.actions?.length) {
        await sendTelegramRich(chatId, { lines: reply.lines, actions: reply.actions }, reply.runId ?? 'none');
        return;
    }
    await sendTelegramLines(chatId, reply.lines);
}

export type TelegramKeyboardRows = Array<Array<Record<string, unknown>>>;

/**
 * The keyboard minus the buttons a settled action spent: the tapped one, and
 * for a Win its sibling (Confirm ↔ Dismiss). Everything else stays — on the
 * `/notes` list, confirming one draft must not take away the other four.
 */
export function withoutSpentButtons(rows: TelegramKeyboardRows, data: string): TelegramKeyboardRows {
    const win = /^sc:[cx]:([a-z0-9]+)$/i.exec(data)?.[1];
    const spent = new Set(win ? [`sc:c:${win}`, `sc:x:${win}`] : [data]);
    return rows
        .map((row) => row.filter((button) => !spent.has(String(button.callback_data ?? ''))))
        .filter((row) => row.length > 0);
}

/**
 * A `sc:` button tap. Returns false when the data is not a Scout action.
 *
 * `messageId` / `keyboard` describe the message the tapped button sits on.
 * When an action is spent (a Win confirmed or dismissed) its buttons are
 * removed there, so a second tap has nothing to press rather than relying on
 * idempotency alone.
 */
export async function handleTelegramScoutCallback(
    chatId: string,
    userId: string,
    data: string,
    messageId?: number | null,
    keyboard?: TelegramKeyboardRows | null,
): Promise<boolean> {
    const action = decodeScoutAction(data);
    if (!action) return false;
    const deps = await scoutChannelDeps();
    if (!(await deps.isScoutEnabled(userId))) {
        await say(chatId, 'Scout is not available on your account yet.');
        return true;
    }
    const reply = await executeScoutAction(userId, action, deps, { channel: 'telegram' });
    if (reply.settled && messageId) {
        await editTelegramReplyMarkup({ chatId, messageId, rows: withoutSpentButtons(keyboard ?? [], data) });
    }
    await sendReply(chatId, reply);
    return true;
}
