import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { InboundPayloadSchema } from '@/lib/journey/inbound';
import { fileEmail, receiveInbound } from '@/services/journey';

/**
 * Forwarded job email, from the inbound mail provider (docs/prd/11 §3).
 *
 * Auth: INBOUND_EMAIL_SECRET as the basic-auth password in the webhook URL
 * (https://inbound:<secret>@www.patronus.cv/api/inbound/email), or as
 * `?secret=`. Unset means closed: a public endpoint that writes into a
 * user's record must never accept unsigned mail.
 *
 * Every well-formed message gets a 200, including ones we drop (unknown
 * address, feature off), so the provider does not retry them forever.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

function same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

function authorised(request: Request, secret: string): boolean {
    const auth = request.headers.get('authorization') ?? '';
    if (auth.toLowerCase().startsWith('basic ')) {
        const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
        const password = decoded.slice(decoded.indexOf(':') + 1);
        if (same(password, secret)) return true;
    }
    const query = new URL(request.url).searchParams.get('secret');
    return !!query && same(query, secret);
}

export async function POST(request: Request) {
    const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: 'Inbound email is not configured' }, { status: 503 });
    if (!authorised(request, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 });
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'Too large' }, { status: 413 });

    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = InboundPayloadSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

    const outcome = await receiveInbound(parsed.data);
    if (outcome.status === 'stored') {
        // Filed now so the job moves while the user is looking; a failure is
        // left `failed` and the daily job re-files it.
        await fileEmail(outcome.emailId).catch((error: unknown) => {
            console.error('[inbound/email] filing failed', { emailId: outcome.emailId, error: String(error) });
        });
    }
    return NextResponse.json({ ok: true, status: outcome.status });
}
