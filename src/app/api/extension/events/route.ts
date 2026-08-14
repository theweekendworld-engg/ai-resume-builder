import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireExtensionAuth, isExtensionAuthError } from '@/lib/extension/auth';
import { checkFunnelEventRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const maxDuration = 10;

// Anonymized extension telemetry. Sender must hold a valid extension bearer
// token (same auth chain as the rest of /api/extension/*). PII rules live in
// the spec: never log JD or field values; hostname must arrive hashed; the
// route never trusts arbitrary userId from the body.
const ExtensionEventSchema = z
    .object({
        type: z.string().min(1).max(80),
        payload: z.record(z.string(), z.unknown()).optional().default({}),
        extVersion: z.string().max(40).optional(),
        clientOccurredAt: z.string().datetime().optional(),
    })
    .strict();

const BatchSchema = z.object({
    events: z.array(ExtensionEventSchema).min(1).max(20),
});

export async function POST(req: NextRequest) {
    let userId: string;
    try {
        ({ userId } = await requireExtensionAuth(req));
    } catch (err) {
        if (isExtensionAuthError(err)) {
            return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
        }
        return NextResponse.json({ success: false, error: 'Auth error' }, { status: 500 });
    }

    // Reuse the funnel-event sliding-window limiter so telemetry can't be a
    // billing-dollar vector. Anchor on userId, not IP, since these are
    // authenticated calls.
    const rate = await checkFunnelEventRateLimit(`ext:${userId}`);
    if (!rate.allowed) {
        // Drop silently — telemetry must never surface as a user-visible error.
        return NextResponse.json({ success: true, dropped: true });
    }

    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return NextResponse.json({ success: true, dropped: true });
    }

    // Tolerate two payload shapes: a single event or a {events: [...]} batch.
    const batch = Array.isArray((raw as { events?: unknown[] })?.events)
        ? BatchSchema.safeParse(raw)
        : (() => {
              const single = ExtensionEventSchema.safeParse(raw);
              return single.success
                  ? { success: true as const, data: { events: [single.data] } }
                  : { success: false as const, error: single.error };
          })();

    if (!batch.success) {
        return NextResponse.json({ success: true, dropped: true });
    }

    try {
        await prisma.extensionEvent.createMany({
            data: batch.data.events.map((event) => ({
                userId,
                type: event.type,
                payload: (event.payload ?? {}) as Prisma.InputJsonValue,
                extVersion: event.extVersion ?? null,
            })),
        });
    } catch (err) {
        console.error('Extension event ingest error:', err);
        // Always return 200 to keep telemetry transparent to the user.
    }

    return NextResponse.json({ success: true });
}
