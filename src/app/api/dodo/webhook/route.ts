import { NextRequest, NextResponse } from 'next/server';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { handleDodoWebhook, type DodoWebhookEvent } from '@/lib/billing/dodoSync';
import { alertOperators } from '@/lib/opsAlert';

// Signature verification needs the raw, unparsed body.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dodo Payments webhooks (docs/impl/09-payments-dodo.md §3).
 *
 * Self-authenticated: Standard Webhooks signature over the raw body with
 * `DODO_PAYMENTS_WEBHOOK_KEY` (so `src/proxy.ts` lets it past Clerk and its
 * rate limiter). This is the only path that fulfils a purchase on its own; the
 * browser redirect after checkout is only ever a hint.
 *
 *   verify signature → dedupe on `webhook-id` (BillingEvent, unique) →
 *   map subscription events onto the user's Subscription row → 200.
 *
 * Unknown event types are acknowledged with 200 and ignored, so Dodo stops
 * retrying them. A failure while applying answers 500 and the dedupe row is
 * removed, so Dodo's retry applies it.
 */
export async function POST(req: NextRequest) {
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
    if (!secret) {
        return NextResponse.json({ error: 'Dodo webhook not configured' }, { status: 503 });
    }

    const id = req.headers.get('webhook-id');
    const signature = req.headers.get('webhook-signature');
    const timestamp = req.headers.get('webhook-timestamp');
    if (!id || !signature || !timestamp) {
        return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 400 });
    }

    const body = await req.text();
    let event: DodoWebhookEvent;
    try {
        // Checks the HMAC and that the timestamp is within five minutes, which
        // is what stops a captured delivery being replayed later.
        new Webhook(secret).verify(body, {
            'webhook-id': id,
            'webhook-signature': signature,
            'webhook-timestamp': timestamp,
        });
        event = JSON.parse(body) as DodoWebhookEvent;
    } catch (error: unknown) {
        const message = error instanceof WebhookVerificationError ? error.message : 'Invalid payload';
        return NextResponse.json({ error: `Webhook verification failed: ${message}` }, { status: 400 });
    }

    if (!event || typeof event.type !== 'string') {
        return NextResponse.json({ received: true, outcome: 'ignored:no_type' });
    }

    try {
        const result = await handleDodoWebhook(id, event);
        return NextResponse.json({ received: true, duplicate: result.duplicate, outcome: result.outcome });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[dodo-webhook] apply failed', { type: event.type, error: message });
        // Money moved and an entitlement may not have. Dodo retries, but an
        // operator should know before a customer writes in. No user content.
        await alertOperators({
            key: `dodo-webhook:${event.type}`,
            title: 'Dodo webhook failed to apply',
            lines: [`type: ${event.type}`, `error: ${message.slice(0, 200)}`, 'Dodo will retry; check /admin/ops if it repeats.'],
        });
        return NextResponse.json({ error: 'Webhook handler error' }, { status: 500 });
    }
}
