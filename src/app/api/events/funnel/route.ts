import { createHash } from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkFunnelEventRateLimit } from '@/lib/rateLimit';
import { FunnelEventPayloadSchema } from '@/lib/funnelEventSchema';

export const runtime = 'nodejs';
export const maxDuration = 10;

const MAX_EVENT_BYTES = 8_192;

function getClientIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
        const firstHop = forwarded.split(',')[0]?.trim();
        if (firstHop) return firstHop;
    }
    return req.headers.get('x-real-ip')?.trim() || 'anonymous';
}

function hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rate = await checkFunnelEventRateLimit(ip);
        if (!rate.allowed) {
            // Drop silently; telemetry must not surface errors to users.
            return NextResponse.json({ success: true });
        }

        // Telemetry is small. An anonymous route that stores whatever it is
        // sent was a free database for anyone (audit 2026-10-02).
        const declared = Number(req.headers.get('content-length') ?? 0);
        if (declared > MAX_EVENT_BYTES) return NextResponse.json({ success: true });
        let raw: unknown;
        try {
            const text = await req.text();
            if (text.length > MAX_EVENT_BYTES) return NextResponse.json({ success: true });
            raw = JSON.parse(text);
        } catch {
            return NextResponse.json({ success: true }); // ignore malformed beacons
        }

        const parsed = FunnelEventPayloadSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ success: true });
        }

        // userId is null for anonymous events (score_started, score_completed,
        // score_cta_clicked). Once the user signs up, follow-up events
        // (score_to_signup) carry the same sessionId so the funnel can be
        // joined server-side.
        const { userId } = await auth();

        await prisma.funnelEvent.create({
            data: {
                sessionId: parsed.data.sessionId,
                userId: userId ?? null,
                type: parsed.data.type,
                payload: (parsed.data.payload ?? {}) as Prisma.InputJsonValue,
                ipHash: hashIp(ip),
            },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        // Never surface telemetry errors. Log and move on.
        console.error('Funnel event ingest error:', error);
        return NextResponse.json({ success: true });
    }
}
