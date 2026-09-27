/**
 * Telegram → Scout and the career inbox. Called from `processTelegramUpdate`
 * after the account is known to be linked. Returns true when the message was
 * ours to handle.
 */

import { matchAnswer } from '@/lib/channels/answerMatch';
import { config } from '@/lib/config';
import { classifyInbound, startFailureText, TINY_HELP } from '@/lib/channels/inbound';
import { renderInboxCommand, type InboxCommand } from '@/lib/channels/inboxCommands';
import { decodeScoutAction, executeScoutAction, type ScoutActionReply } from '@/lib/channels/scoutActions';
import { scoutChannelDeps } from '@/lib/channels/scoutDeps';
import { sendScoutFinalTelegram, sendTelegramLines, sendTelegramRich } from '@/lib/channels/telegramScout';
import { parseSharedMessage } from '@/lib/scout/message';
import { editTelegramMessageDetailed, editTelegramReplyMarkup, sendTelegramMessageDetailed } from '@/lib/telegram';

const FINISHED = new Set(['succeeded', 'partial', 'failed', 'awaiting_input']);

async function say(chatId: string, text: string): Promise<void> {
    await sendTelegramLines(chatId, [[{ text }]]);
}

/** First words of the progress message, so a note does not say "Reading the link". */
function openingLine(shared: { url: string | null; text: string | null }): string {
    if (shared.url) return '🔎 Reading the link…';
    if ((shared.text ?? '').length >= 200) return '🔎 Reading the post…';
    return '📝 Recording that…';
}

/** Start a run from shared text, with a progress message the notifier edits. */
export async function startTelegramScout(chatId: string, userId: string, raw: string): Promise<void> {
    const deps = await scoutChannelDeps();
    const shared = parseSharedMessage(raw);
    if (!shared.url && !shared.text) {
        await say(chatId, 'Send a LinkedIn job or post link, or paste the post text.');
        return;
    }

    const initial = await sendTelegramMessageDetailed({ chatId, text: openingLine(shared) });
    const result = await deps.startScoutRun({
        userId,
        input: { url: shared.url, text: shared.text, source: 'telegram' },
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
    if (result.data.created) return; // The notifier takes it from here.

    const view = result.data.run;
    if (FINISHED.has(view.status)) {
        await replace('You shared this one before. Here is what I found:');
        await sendScoutFinalTelegram(chatId, view);
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
export async function handleTelegramScoutText(chatId: string, userId: string, text: string): Promise<boolean> {
    const deps = await scoutChannelDeps();
    if (!(await deps.isScoutEnabled(userId))) return false;

    const intent = classifyInbound(text);
    if (intent === 'share') {
        await startTelegramScout(chatId, userId, text);
        return true;
    }
    if (intent === 'reply' || intent === 'tiny') {
        const open = await deps.findOpenQuestionRun(userId);
        // Only a message that plausibly answers the question is taken as the
        // answer; anything else is new input (a note must never be swallowed).
        const value = open?.pendingQuestion ? matchAnswer(open.pendingQuestion, text) : null;
        if (open && value !== null) {
            const answered = await deps.answerScoutQuestion(userId, open.id, value);
            await say(chatId, answered.success ? 'Got it. Updating the fit…' : answered.error);
            return true;
        }
        if (intent === 'reply') {
            await startTelegramScout(chatId, userId, text);
            return true;
        }
        await say(chatId, TINY_HELP);
        return true;
    }
    return false;
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
