/**
 * The WhatsApp webhook, as plain functions the route file wraps.
 *
 * Lives outside `route.ts` because Next only permits HTTP-method exports from
 * a route module, and these need to be testable without a request scope.
 */

import { Channel, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    parseWhatsAppWebhook,
    readWhatsAppConfig,
    verifyWhatsAppHandshake,
    verifyWhatsAppSignature,
    type WhatsAppInbound,
} from '@/lib/whatsapp';

export type WebhookResponse = { status: number; body: string; contentType?: string };

export function handleWhatsAppHandshake(params: URLSearchParams): WebhookResponse {
    const cfg = readWhatsAppConfig();
    const challenge = cfg ? verifyWhatsAppHandshake(params, cfg.verifyToken) : null;
    if (challenge === null) return { status: 403, body: 'forbidden' };
    return { status: 200, body: challenge, contentType: 'text/plain' };
}

/**
 * Claim a message id. Meta redelivers on any non-2xx and sometimes on a 2xx;
 * the unique `(channel, externalId)` makes the second delivery a no-op, so a
 * redelivered link can neither start nor charge for a second run.
 */
export async function claimWhatsAppMessage(messageId: string): Promise<boolean> {
    try {
        await prisma.channelMessageReceipt.create({ data: { channel: Channel.whatsapp, externalId: messageId } });
        return true;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
        throw error;
    }
}

export type Schedule = (work: () => Promise<void>) => void;

/**
 * Verify, dedupe, schedule, answer. The response goes back before processing
 * — Meta times the webhook out quickly and retries, and starting a run takes
 * a few hundred ms of DB work plus an outbound send.
 */
export async function handleWhatsAppWebhookPost(params: {
    rawBody: string;
    signature: string | null;
    schedule: Schedule;
    process: (message: WhatsAppInbound) => Promise<void>;
}): Promise<WebhookResponse> {
    const cfg = readWhatsAppConfig();
    if (!cfg) return { status: 404, body: 'not configured' };
    if (!verifyWhatsAppSignature(params.rawBody, params.signature, cfg.appSecret)) {
        return { status: 401, body: 'bad signature' };
    }

    let payload: unknown;
    try {
        payload = JSON.parse(params.rawBody);
    } catch {
        return { status: 400, body: 'bad json' };
    }

    const messages = parseWhatsAppWebhook(payload);
    for (const message of messages) {
        if (!(await claimWhatsAppMessage(message.id))) continue;
        params.schedule(async () => {
            try {
                await params.process(message);
            } catch (error) {
                console.error('[whatsapp] processing failed', { messageId: message.id, error: String(error) });
            }
        });
    }
    return { status: 200, body: 'ok' };
}
