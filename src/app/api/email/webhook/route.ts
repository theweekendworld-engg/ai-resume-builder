/**
 * Resend webhook → EmailSend.status.
 *
 * Handles delivery, bounce and complaint (plus sent/failed/open/click, which cost
 * nothing extra). Two rules do the real work:
 *
 *   - status only ever moves forward. Resend does not guarantee ordering, and a
 *     late `email.sent` must not overwrite a recorded `bounced`.
 *   - a hard bounce or a spam complaint sets unsubscribedAll on that user. Mailing
 *     an address that permanently rejected us is how a sending domain dies.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    mapResendEvent,
    parseResendWebhook,
    statusRank,
    suppressUserEmail,
    verifyResendWebhookSignature,
} from '@/lib/email/send';

// node:crypto for the Svix HMAC, and the raw body for signature verification.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret) {
        // Refuse rather than trust: an unverified webhook can set unsubscribedAll
        // on any user whose provider id an attacker can guess.
        return NextResponse.json({ error: 'Email webhook not configured' }, { status: 503 });
    }

    const body = await request.text();

    const verified = verifyResendWebhookSignature({
        secret,
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signatureHeader: request.headers.get('svix-signature'),
        payload: body,
    });
    if (!verified) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    let raw: unknown;
    try {
        raw = JSON.parse(body);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const payload = parseResendWebhook(raw);
    if (!payload) {
        // Acknowledged so Resend stops retrying a shape we will never understand.
        return NextResponse.json({ received: true, handled: false });
    }

    const update = mapResendEvent(payload);
    if (!update) {
        return NextResponse.json({ received: true, handled: false });
    }

    try {
        const row = await prisma.emailSend.findFirst({
            where: { providerId: update.providerId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, userId: true, status: true },
        });

        if (!row) {
            // Broadcasts and anything sent outside sendEmail have no row. Not an error.
            return NextResponse.json({ received: true, handled: false });
        }

        const data: Record<string, unknown> = {};
        if (update.status && statusRank(update.status) > statusRank(row.status)) {
            data.status = update.status;
            if (update.error) data.error = update.error;
        }
        if (update.openedAt) data.openedAt = update.openedAt;
        if (update.clickedAt) data.clickedAt = update.clickedAt;

        if (Object.keys(data).length > 0) {
            await prisma.emailSend.update({ where: { id: row.id }, data });
        }

        if (update.suppressRecipient) {
            await suppressUserEmail(row.userId, `${payload.type}`);
        }

        return NextResponse.json({ received: true, handled: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Webhook handler error';
        console.error('[email] webhook handler failed', { type: payload.type, error: message });
        // 500 so Resend retries — the state we failed to write still matters.
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
