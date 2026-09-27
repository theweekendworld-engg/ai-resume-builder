/**
 * Inbound WhatsApp message → action. The WhatsApp counterpart of
 * `processTelegramUpdate`, Scout-only (the resume bot is Telegram's).
 *
 * Order:
 *   1. "link <token>"           → consume the dashboard link token
 *   2. not linked               → how to link
 *   3. Scout off for the user   → say so
 *   4. button/list reply `sc:`  → answer / draft / why / refresh / status / confirm
 *   5. "jobs" "applied" "insights" "notes" "help" (bare or with a slash)
 *   6. link or pasted post      → start (or reuse) a Scout run
 *   7. short text + open question → the answer
 *   8. any other text ≥ 15 chars → a note, recorded as a Scout run
 *   9. anything shorter         → what I can do
 */

import { matchAnswer } from '@/lib/channels/answerMatch';
import { Channel } from '@prisma/client';
import { consumeChannelLinkToken, describeAccount, unlinkChatByExternalId } from '@/actions/channelIdentity';
import { UNLINK_CONFIRM, alreadyLinkedText, conflictText, linkedText, notLinkedText, unlinkedText } from '@/lib/channels/linkCopy';
import { config } from '@/lib/config';
import { classifyInbound, startFailureText, TINY_HELP } from '@/lib/channels/inbound';
import { parseInboxCommand, renderInboxCommand } from '@/lib/channels/inboxCommands';
import { decodeScoutAction, executeScoutAction } from '@/lib/channels/scoutActions';
import { scoutChannelDeps } from '@/lib/channels/scoutDeps';
import { sendScoutFinalWhatsApp, sendWhatsAppLines, sendWhatsAppRich } from '@/lib/channels/whatsappScout';
import { prisma } from '@/lib/prisma';
import { parseSharedMessage } from '@/lib/scout/message';
import { markWhatsAppRead, type WhatsAppInbound } from '@/lib/whatsapp';

const FINISHED = new Set(['succeeded', 'partial', 'failed', 'awaiting_input']);
const LINK_COMMAND = /^link\s+([a-f0-9]{16,128})\s*$/i;

async function say(to: string, text: string): Promise<void> {
    await sendWhatsAppLines(to, [[{ text }]]);
}

function dashboardUrl(): string {
    return `${config.app.url.replace(/\/$/, '')}/dashboard?section=telegram`;
}

async function linkedUserId(waId: string): Promise<string | null> {
    const identity = await prisma.channelIdentity.findUnique({
        where: { channel_externalId: { channel: Channel.whatsapp, externalId: waId } },
        select: { userId: true, verified: true },
    });
    return identity?.verified ? identity.userId : null;
}

export async function processWhatsAppMessage(message: WhatsAppInbound): Promise<void> {
    const to = message.from;
    await markWhatsAppRead(message.id);
    const text = (message.text ?? '').trim();

    const link = LINK_COMMAND.exec(text);
    if (link) {
        const result = await consumeChannelLinkToken({ channel: Channel.whatsapp, token: link[1].toLowerCase(), externalId: to });
        if (result.success) {
            await say(to, linkedText(await describeAccount(result.userId ?? ''), { bare: true }));
        } else if (result.code === 'linked_to_other' && result.otherUserId) {
            await say(to, conflictText({ otherAccount: await describeAccount(result.otherUserId), app: 'WhatsApp', unlinkCommand: '"unlink"' }));
        } else {
            const current = await linkedUserId(to);
            await say(to, current
                ? alreadyLinkedText(await describeAccount(current))
                : `That link did not work: ${result.error ?? 'unknown error'}. Get a fresh one at ${dashboardUrl()}`);
        }
        return;
    }

    // Unlink needs a second word to confirm: WhatsApp replies cannot carry
    // a button on this path, and unlinking by accident is worse than one
    // extra word.
    if (/^unlink$/i.test(text)) {
        const current = await linkedUserId(to);
        await say(to, current
            ? `${UNLINK_CONFIRM}\n\nLinked to: ${await describeAccount(current)}\n\nReply "unlink yes" to confirm.`
            : 'This number is not linked to Patronus.');
        return;
    }
    if (/^unlink\s+yes$/i.test(text)) {
        const { removed } = await unlinkChatByExternalId(Channel.whatsapp, to);
        await say(to, removed > 0 ? unlinkedText(dashboardUrl()) : 'This number is not linked to Patronus.');
        return;
    }

    const userId = await linkedUserId(to);
    if (!userId) {
        await say(to, notLinkedText(dashboardUrl(), 'WhatsApp'));
        return;
    }

    const deps = await scoutChannelDeps();
    if (!(await deps.isScoutEnabled(userId))) {
        await say(to, 'Scout is not available on your account yet.');
        return;
    }

    if (message.replyId) {
        const action = decodeScoutAction(message.replyId);
        if (action) {
            // WhatsApp cannot edit a sent message, so spent buttons stay on
            // screen; a second tap is safe because confirm is idempotent.
            const reply = await executeScoutAction(userId, action, deps, { channel: 'whatsapp' });
            if (reply.actions?.length) {
                await sendWhatsAppRich(to, { lines: reply.lines, actions: reply.actions }, reply.runId ?? 'none', 'Update it later:');
            } else {
                await sendWhatsAppLines(to, reply.lines);
            }
            return;
        }
    }

    const command = parseInboxCommand(text, { allowBare: true });
    if (command) {
        const rendered = await renderInboxCommand(command, userId, deps, config.app.url, { bare: true });
        await sendWhatsAppRich(to, rendered, 'none', 'Confirm a draft:');
        return;
    }

    const intent = classifyInbound(text);
    if (intent === 'share') {
        await startWhatsAppScout(to, userId, text);
        return;
    }
    if (intent === 'reply' || intent === 'tiny') {
        const open = await deps.findOpenQuestionRun(userId);
        // Only a message that plausibly answers the question is taken as the
        // answer; anything else is new input (a note must never be swallowed).
        const value = open?.pendingQuestion ? matchAnswer(open.pendingQuestion, text) : null;
        if (open && value !== null) {
            const answered = await deps.answerScoutQuestion(userId, open.id, value);
            await say(to, answered.success ? 'Got it. Updating the fit…' : answered.error);
            return;
        }
        if (intent === 'reply') {
            await startWhatsAppScout(to, userId, text);
            return;
        }
    }
    await say(to, TINY_HELP.replace('/help', 'help'));
}

export async function startWhatsAppScout(to: string, userId: string, raw: string): Promise<void> {
    const deps = await scoutChannelDeps();
    const shared = parseSharedMessage(raw);
    if (!shared.url && !shared.text) {
        await say(to, 'Send a LinkedIn job or post link, or paste the post text.');
        return;
    }

    const result = await deps.startScoutRun({
        userId,
        input: { url: shared.url, text: shared.text, source: 'whatsapp' },
        channel: 'whatsapp',
        channelRef: { to },
    });
    if (!result.success) {
        await say(to, startFailureText(result.error, result.code, config.app.url));
        return;
    }
    if (result.data.created) {
        await say(to, shared.url || (shared.text ?? '').length >= 200
            ? '🔎 On it. I will reply here in a minute or two.'
            : '📝 Recording that. I will reply here in a moment.');
        return;
    }
    const view = result.data.run;
    if (FINISHED.has(view.status)) {
        await say(to, 'You shared this one before. Here is what I found:');
        await sendScoutFinalWhatsApp(to, view);
    } else {
        await say(to, 'Already working on this one. I will reply here when it is done.');
    }
}
