/**
 * Clerk → Patronus. On `user.deleted`, delete everything we hold for that user.
 *
 * Deleting an account in Clerk's own UI (the /account page) used to leave every
 * row behind (launch audit, 2026-10-02). Clerk signs webhooks with Svix, the
 * same scheme as Resend, so the verifier is shared. Refuses when the secret is
 * not configured: an unverified delete webhook is a "wipe any user" button.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyResendWebhookSignature as verifySvixSignature } from '@/lib/email/send';
import { deleteUserData } from '@/services/accountDeletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: 'Clerk webhook not configured' }, { status: 503 });

    const body = await request.text();
    const verified = verifySvixSignature({
        secret,
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signatureHeader: request.headers.get('svix-signature'),
        payload: body,
    });
    if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });

    let event: { type?: string; data?: { id?: string } };
    try {
        event = JSON.parse(body);
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    if (event.type === 'user.deleted' && typeof event.data?.id === 'string' && event.data.id) {
        const report = await deleteUserData(event.data.id);
        console.info('[clerk/webhook] user data deleted', { userId: event.data.id, files: report.files, leftovers: report.leftovers });
    }
    return NextResponse.json({ ok: true });
}
