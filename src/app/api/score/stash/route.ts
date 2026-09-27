import { NextRequest, NextResponse } from 'next/server';
import { checkAnonScoreRateLimit } from '@/lib/rateLimit';
import { SCORE_STASH_COOKIE, SCORE_STASH_TTL_MS, StashPayloadSchema, createScoreStash } from '@/lib/scoreStash';

/**
 * POST /api/score/stash — keep a free-check result for 24h so it survives
 * sign-up (see `src/lib/scoreStash.ts`). Public, like `/api/score` itself.
 *
 * Returns the id and also sets it in a first-party cookie: the id rides the
 * sign-up URL, and the cookie is the fallback when an email-verification tab
 * opens without that URL.
 */
export const runtime = 'nodejs';

/** Generous for 40k chars of text plus 30 fixes; anything bigger is not a resume. */
const MAX_BODY_BYTES = 160_000;

/** Per-instance backstop when Upstash is not configured (it is not in prod). */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const recent = new Map<string, number[]>();

function localAllow(key: string, now: number): boolean {
    const hits = (recent.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (hits.length >= MAX_PER_WINDOW) {
        recent.set(key, hits);
        return false;
    }
    hits.push(now);
    recent.set(key, hits);
    if (recent.size > 5_000) recent.clear();
    return true;
}

function clientIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || req.headers.get('x-real-ip')?.trim() || 'anonymous';
}

export async function POST(req: NextRequest) {
    const ip = clientIp(req);
    if (!localAllow(ip, Date.now())) {
        return NextResponse.json({ success: false, error: 'Too many requests. Try again in a little while.' }, { status: 429 });
    }
    const remote = await checkAnonScoreRateLimit(`stash:${ip}`);
    if (!remote.allowed) {
        return NextResponse.json({ success: false, error: remote.error ?? 'Too many requests.' }, { status: 429 });
    }

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
        return NextResponse.json({ success: false, error: 'That is too large to keep.' }, { status: 413 });
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
        return NextResponse.json({ success: false, error: 'That is too large to keep.' }, { status: 413 });
    }

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });
    }
    const parsed = StashPayloadSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Invalid score result.' }, { status: 400 });
    }

    const { id, expiresAt } = await createScoreStash(parsed.data);
    const response = NextResponse.json({ success: true, id, expiresAt: expiresAt.toISOString() }, { status: 201 });
    response.cookies.set(SCORE_STASH_COOKIE, id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(SCORE_STASH_TTL_MS / 1000),
    });
    return response;
}
