/**
 * Confirm or dismiss a Win draft from the CLI: the terminal's version of the
 * card's buttons (rule 5: confirming writes Evidence + ClaimLink, and only the
 * user's own tap does it). Scoped to the key's owner by the services.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmWinForUser, dismissWinForUser } from '@/services/wins';
import { cliUser } from '../_auth';

export const dynamic = 'force-dynamic';

const Body = z.object({ winId: z.string().min(1).max(64), op: z.enum(['confirm', 'dismiss']).default('confirm') });

export async function POST(req: NextRequest): Promise<NextResponse> {
    const who = await cliUser(req);
    if ('response' in who) return who.response;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Send {"winId": "..."}' }, { status: 400 });
    const result = parsed.data.op === 'confirm'
        ? await confirmWinForUser(who.userId, parsed.data.winId)
        : await dismissWinForUser(who.userId, parsed.data.winId);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
}
