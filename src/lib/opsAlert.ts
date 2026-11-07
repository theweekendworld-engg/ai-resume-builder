/**
 * Push an operator alert to the admins' linked Telegram chats.
 *
 * Why this exists: on the Hobby plan Vercel keeps runtime logs for one hour and
 * there is no error tracker, so an unhandled server error or a job that dies
 * after its last retry was invisible unless someone happened to be watching.
 * The daily operator digest rides on the cron, so it cannot report the cron's
 * own failures either.
 *
 * Rules:
 * - Never throws and never blocks the caller for long: alerting must not turn
 *   one failure into two.
 * - Throttled per key (same error, same route) inside one warm instance, so a
 *   crash loop sends one message, not hundreds. Cold starts reset the window,
 *   which is acceptable: the goal is "you hear about it", not exact counts.
 * - No user content. Error message (truncated), where it happened, and an id
 *   to look up in /admin. Never request bodies, emails or resume text.
 */

import { Channel } from '@prisma/client';

const THROTTLE_MS = 15 * 60_000;
const MAX_KEYS = 200;
const lastSent = new Map<string, number>();

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Exported for tests. True when this key was not alerted within the window. */
export function claimAlertSlot(key: string, now: number = Date.now()): boolean {
    const previous = lastSent.get(key);
    if (previous !== undefined && now - previous < THROTTLE_MS) return false;
    if (lastSent.size >= MAX_KEYS) {
        const oldest = lastSent.keys().next().value;
        if (oldest !== undefined) lastSent.delete(oldest);
    }
    lastSent.set(key, now);
    return true;
}

/** Exported for tests. */
export function resetAlertThrottle(): void {
    lastSent.clear();
}

export async function alertOperators(input: { key: string; title: string; lines: string[] }): Promise<void> {
    try {
        if (!claimAlertSlot(input.key)) return;
        const admins = (process.env.ADMIN_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
        if (admins.length === 0 || !process.env.TELEGRAM_BOT_TOKEN) return;

        const { prisma } = await import('@/lib/prisma');
        const chats = await prisma.channelIdentity.findMany({
            where: { userId: { in: admins }, channel: Channel.telegram, verified: true },
            select: { externalId: true },
        });
        if (chats.length === 0) return;

        const text = [
            `<b>${escapeHtml(input.title)}</b>`,
            ...input.lines.map((line) => escapeHtml(line.length > 400 ? `${line.slice(0, 400)}…` : line)),
        ].join('\n');

        const { sendTelegramMessageDetailed } = await import('@/lib/telegram');
        await Promise.allSettled(
            chats.map((chat) => sendTelegramMessageDetailed({ chatId: chat.externalId, text, parseMode: 'HTML' })),
        );
    } catch (error: unknown) {
        console.error('[opsAlert] could not send operator alert', {
            key: input.key,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}
