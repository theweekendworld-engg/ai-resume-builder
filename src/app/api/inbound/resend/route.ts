import { NextResponse } from 'next/server';

import { verifyResendWebhookSignature } from '@/lib/email/send';
import { InboundPayloadSchema } from '@/lib/journey/inbound';
import { fetchReceivedEmail, fromResendEmail } from '@/lib/journey/inboundResend';
import { receiveAndFile } from '@/services/journey';

/**
 * Forwarded job email from Resend Inbound (docs/prd/11 §3).
 *
 * Resend posts `email.received` with metadata only; the body is fetched by id
 * (RESEND_API_KEY) and handed to the same parser and filer as every other
 * provider.
 *
 * Auth: the Svix signature, keyed by RESEND_INBOUND_WEBHOOK_SECRET (this
 * endpoint's own signing secret in Resend, separate from the sending
 * webhook's RESEND_WEBHOOK_SECRET). Unset means closed.
 *
 * Every verified event gets a 200, including ones we drop (other event types,
 * unknown address, feature off), so Resend does not retry them. A failed body
 * fetch is a 502, which Resend retries.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 1024 * 1024;

export async function POST(request: Request) {
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
    if (!secret || !process.env.RESEND_API_KEY?.trim()) {
        return NextResponse.json({ error: 'Inbound email is not configured' }, { status: 503 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 });

    const verified = verifyResendWebhookSignature({
        secret,
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signatureHeader: request.headers.get('svix-signature'),
        payload: raw,
    });
    if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

    let event: { type?: unknown; data?: { email_id?: unknown } };
    try {
        event = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (event.type !== 'email.received') return NextResponse.json({ ok: true, status: 'ignored' });
    const emailId = typeof event.data?.email_id === 'string' ? event.data.email_id : '';
    if (!emailId) return NextResponse.json({ error: 'Missing email_id' }, { status: 400 });

    let email;
    try {
        email = await fetchReceivedEmail(emailId);
    } catch (error: unknown) {
        console.error('[inbound/resend] could not fetch the received email', { emailId, error: String(error) });
        return NextResponse.json({ error: 'Could not fetch the email' }, { status: 502 });
    }

    const payload = InboundPayloadSchema.parse(fromResendEmail(email));
    const outcome = await receiveAndFile(payload, 'resend');
    return NextResponse.json({ ok: true, status: outcome.status });
}
