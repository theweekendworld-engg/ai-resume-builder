/**
 * Scout on WhatsApp. WhatsApp cannot edit a sent message, so there is no
 * progress checklist: a short "On it…" when the link arrives (sent by the
 * inbound handler), then exactly one final answer, then — when there is a next
 * step — one interactive message with up to three buttons, or a list when a
 * question has more than three options.
 *
 * `channelRef` = `{to, finalHash}`; the hash makes a replayed `finished`
 * notification a no-op.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AgentRunRow } from '@/lib/agent/run';
import { config } from '@/lib/config';
import { formatForWhatsApp } from '@/lib/channels/format';
import { renderScoutFinal } from '@/lib/channels/scoutRender';
import type { ChannelButton, Line, RichMessage } from '@/lib/channels/types';
import { prisma } from '@/lib/prisma';
import { registerScoutNotifier, type ScoutNotifyPhase } from '@/lib/scout/notify';
import type { ScoutRunView } from '@/lib/scout/types';
import { toRunView } from '@/lib/scout/view';
import {
    sendWhatsAppButtons,
    sendWhatsAppList,
    sendWhatsAppText,
    WHATSAPP_MAX_BUTTONS,
} from '@/lib/whatsapp';

export type WhatsAppScoutRef = { to: string; finalHash?: string };

export function readWhatsAppRef(value: unknown): WhatsAppScoutRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ref = value as Record<string, unknown>;
    if (typeof ref.to !== 'string' || !ref.to) return null;
    return { to: ref.to, finalHash: typeof ref.finalHash === 'string' ? ref.finalHash : undefined };
}

export async function sendWhatsAppLines(to: string, lines: Line[]): Promise<void> {
    const formatted = formatForWhatsApp({ lines, actions: [] }, 'none');
    await sendWhatsAppText(to, formatted.text);
}

/**
 * Text, then the buttons as their own interactive message. Buttons ride in a
 * separate message because an interactive body is capped at 1024 chars and the
 * answer is often longer — truncating the answer to fit the buttons would be
 * the wrong trade.
 */
export async function sendWhatsAppRich(to: string, message: RichMessage, runId: string, prompt: string): Promise<boolean> {
    const formatted = formatForWhatsApp(message, runId);
    const sent = await sendWhatsAppText(to, formatted.text);
    if (!sent.ok) return false;

    const callbacks = message.actions
        .filter((action) => action.kind !== 'open')
        .map((action) => formatForWhatsApp({ lines: [], actions: [action] }, runId).buttons[0])
        .filter((button): button is Extract<ChannelButton, { kind: 'callback' }> => Boolean(button) && button.kind === 'callback');

    if (callbacks.length === 0) return true;
    if (callbacks.length <= WHATSAPP_MAX_BUTTONS) {
        await sendWhatsAppButtons(to, prompt, callbacks.map((button) => ({ id: button.data, title: button.label })));
    } else {
        const labels = message.actions.filter((action) => action.kind !== 'open').map((action) => action.label);
        await sendWhatsAppList(to, prompt, 'Choose', callbacks.map((button, i) => ({ id: button.data, title: labels[i] ?? button.label })));
    }
    return true;
}

function promptFor(view: ScoutRunView): string {
    return view.status === 'awaiting_input' && view.pendingQuestion ? view.pendingQuestion.prompt : 'What next?';
}

export async function sendScoutFinalWhatsApp(to: string, view: ScoutRunView): Promise<boolean> {
    return sendWhatsAppRich(to, renderScoutFinal(view, config.app.url), view.id, promptFor(view));
}

export async function notifyWhatsAppScout(run: AgentRunRow, phase: ScoutNotifyPhase): Promise<void> {
    if (phase !== 'finished') return; // No edits on WhatsApp: no per-stage messages.
    const ref = readWhatsAppRef(run.channelRef);
    if (!ref) return;

    const view = toRunView(run);
    const message = renderScoutFinal(view, config.app.url);
    const finalHash = createHash('sha1')
        .update(formatForWhatsApp(message, run.id).text)
        .update(JSON.stringify(message.actions))
        .digest('hex')
        .slice(0, 16);
    if (finalHash === ref.finalHash) return;

    const sent = await sendWhatsAppRich(ref.to, message, run.id, promptFor(view));
    if (!sent) return;
    await prisma.agentRun.update({
        where: { id: run.id },
        data: { channelRef: { ...ref, finalHash } as unknown as Prisma.InputJsonValue },
    });
}

registerScoutNotifier('whatsapp', notifyWhatsAppScout);
