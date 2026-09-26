/**
 * Scout on Telegram: the progress message and the final answer.
 *
 * One progress message per run, edited in place as sections finish — a new
 * message per section would be eight notifications for one link. The final
 * answer IS a new message, because edits do not notify and the user has
 * usually put the phone down by then.
 *
 * `channelRef` carries `{chatId, messageId, progressHash, finalHash}`. The
 * hashes make both writes idempotent: the pipeline calls `progress` after
 * every stage and a retried workflow step may call `finished` twice, and
 * neither may produce a duplicate edit or a second copy of the answer.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AgentRunRow } from '@/lib/agent/run';
import { config } from '@/lib/config';
import { formatForTelegram, toTelegramKeyboard } from '@/lib/channels/format';
import { renderScoutFinal, renderScoutProgress } from '@/lib/channels/scoutRender';
import type { FormattedMessage, Line, RichMessage } from '@/lib/channels/types';
import { prisma } from '@/lib/prisma';
import { registerScoutNotifier, type ScoutNotifyPhase } from '@/lib/scout/notify';
import type { ScoutRunView } from '@/lib/scout/types';
import { toRunView } from '@/lib/scout/view';
import { editTelegramMessageDetailed, sendTelegramMessageDetailed } from '@/lib/telegram';

export type TelegramScoutRef = {
    chatId: string;
    messageId?: number | null;
    progressHash?: string;
    finalHash?: string;
};

export function readTelegramRef(value: unknown): TelegramScoutRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ref = value as Record<string, unknown>;
    if (typeof ref.chatId !== 'string' && typeof ref.chatId !== 'number') return null;
    return {
        chatId: String(ref.chatId),
        messageId: typeof ref.messageId === 'number' ? ref.messageId : null,
        progressHash: typeof ref.progressHash === 'string' ? ref.progressHash : undefined,
        finalHash: typeof ref.finalHash === 'string' ? ref.finalHash : undefined,
    };
}

function hash(message: FormattedMessage): string {
    return createHash('sha1').update(message.text).update(JSON.stringify(message.buttons)).digest('hex').slice(0, 16);
}

export function formatTelegram(message: RichMessage, runId: string): FormattedMessage {
    return formatForTelegram(message, runId);
}

export async function sendTelegramRich(chatId: string, message: RichMessage, runId: string): Promise<number | null> {
    const formatted = formatForTelegram(message, runId);
    const result = await sendTelegramMessageDetailed({
        chatId,
        text: formatted.text,
        replyMarkup: toTelegramKeyboard(formatted.buttons),
    });
    return result.ok ? result.messageId : null;
}

export async function sendTelegramLines(chatId: string, lines: Line[]): Promise<void> {
    await sendTelegramRich(chatId, { lines, actions: [] }, 'none');
}

/** Send the final answer for a view now, without touching channelRef. */
export async function sendScoutFinalTelegram(chatId: string, view: ScoutRunView): Promise<void> {
    await sendTelegramRich(chatId, renderScoutFinal(view, config.app.url), view.id);
}

async function saveRef(runId: string, ref: TelegramScoutRef): Promise<void> {
    await prisma.agentRun.update({
        where: { id: runId },
        data: { channelRef: ref as unknown as Prisma.InputJsonValue },
    });
}

export async function notifyTelegramScout(run: AgentRunRow, phase: ScoutNotifyPhase): Promise<void> {
    const ref = readTelegramRef(run.channelRef);
    if (!ref) return;
    const view = toRunView(run);
    const next: TelegramScoutRef = { ...ref };

    // 1. Progress: edit in place, only when the checklist actually changed.
    const progress = formatForTelegram(renderScoutProgress(view, config.app.url), run.id);
    const progressHash = hash(progress);
    if (progressHash !== ref.progressHash) {
        if (ref.messageId) {
            const edited = await editTelegramMessageDetailed({
                chatId: ref.chatId,
                messageId: ref.messageId,
                text: progress.text,
            });
            if (edited.ok) next.progressHash = progressHash;
        } else if (phase === 'progress') {
            const sent = await sendTelegramMessageDetailed({ chatId: ref.chatId, text: progress.text });
            if (sent.ok) {
                next.messageId = sent.messageId;
                next.progressHash = progressHash;
            }
        }
    }

    // 2. Final: a new message, exactly once per distinct answer.
    if (phase === 'finished') {
        const final = formatForTelegram(renderScoutFinal(view, config.app.url), run.id);
        const finalHash = hash(final);
        if (finalHash !== ref.finalHash) {
            const sent = await sendTelegramMessageDetailed({
                chatId: ref.chatId,
                text: final.text,
                replyMarkup: toTelegramKeyboard(final.buttons),
            });
            if (sent.ok) next.finalHash = finalHash;
        }
    }

    if (
        next.messageId !== ref.messageId
        || next.progressHash !== ref.progressHash
        || next.finalHash !== ref.finalHash
    ) {
        await saveRef(run.id, next);
    }
}

registerScoutNotifier('telegram', notifyTelegramScout);
