/**
 * Job-watch buttons on Telegram (docs/prd/12-job-watch.md §6).
 *
 * The morning message carries one row per job: Track, Outreach, Not for me.
 * Each tap goes through the same service the `/watch` page uses, scoped to the
 * user this chat is linked to: a callback's data is whatever the client sends,
 * so a match id from another account must do nothing.
 */

import { isEnabled } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { editTelegramReplyMarkup, sendTelegramMessageDetailed } from '@/lib/telegram';
import { escapeTelegramHtml } from '@/lib/channels/format';
import { startTelegramScout } from '@/lib/channels/telegramInbound';
import { decodeWatchAction, withoutSpentWatchButtons, type ChatButton } from '@/lib/watch/alert';
import { dismissMatch, trackMatch } from '@/services/jobWatch';

async function say(chatId: string, text: string): Promise<void> {
    await sendTelegramMessageDetailed({ chatId, text: escapeTelegramHtml(text) });
}

/** Returns false when the data is not a job-watch action. */
export async function handleTelegramWatchCallback(
    chatId: string,
    userId: string,
    data: string,
    messageId?: number | null,
    keyboard?: ChatButton[][] | null,
): Promise<boolean> {
    const action = decodeWatchAction(data);
    if (!action) return false;

    if (!(await isEnabled(userId, 'job_watch'))) {
        await say(chatId, 'Job alerts are not available on your account right now.');
        return true;
    }
    const match = await prisma.jobMatch.findFirst({
        where: { id: action.matchId, userId },
        select: { id: true, status: true, posting: { select: { title: true, absoluteUrl: true, source: { select: { companyName: true } } } } },
    });
    if (!match) {
        await say(chatId, 'That job is no longer in your watch.');
        return true;
    }
    const label = `${match.posting.title} at ${match.posting.source.companyName}`;

    let settled = false;
    switch (action.kind) {
        case 'track': {
            const result = await trackMatch(userId, match.id);
            if (!result.success) {
                await say(chatId, `Could not track ${label}: ${result.error}`);
                return true;
            }
            settled = true;
            await say(chatId, `Tracked: ${label}. It is on your job board, with follow-up reminders once you apply.\n${config.app.url.replace(/\/$/, '')}/scout`);
            break;
        }
        case 'pass': {
            if (match.status === 'tracked') {
                await say(chatId, `${label} is already on your job board; move it there if you are no longer interested.`);
                return true;
            }
            await dismissMatch(userId, match.id);
            settled = true;
            await say(chatId, `Passed on ${label}. It will not come back.`);
            break;
        }
        case 'outreach': {
            // A full Scout run on the posting: company research, the people
            // list, and draft buttons for each of them. Metered there.
            if (!(await isEnabled(userId, 'scout'))) {
                await say(chatId, `Outreach drafts need Scout, which is not on for your account yet. The posting: ${match.posting.absoluteUrl}`);
                return true;
            }
            await startTelegramScout(chatId, userId, match.posting.absoluteUrl);
            break;
        }
    }

    if (settled && messageId && keyboard?.length) {
        await editTelegramReplyMarkup({ chatId, messageId, rows: withoutSpentWatchButtons(keyboard, action) }).catch(() => {});
    }
    return true;
}
