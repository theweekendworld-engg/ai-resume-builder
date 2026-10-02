/**
 * The CLI's one endpoint: a chat turn, exactly as on the web (same router,
 * same services, same metering and cost cap), in the same thread, so the web
 * and the terminal share one memory. The reply comes back as text plus the
 * typed cards (src/lib/chat/types.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { CHAT_MESSAGE_MAX } from '@/lib/chat/router';
import { replyToText } from '@/lib/chat/renderText';
import { checkChatRateLimit } from '@/lib/rateLimit';
import { sendChatMessage } from '@/services/chat';
import { cliUser } from '../_auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({
    text: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
    clientId: z.string().min(8).max(64).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
    const who = await cliUser(req);
    if ('response' in who) return who.response;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: `Send {"text": "..."} (up to ${CHAT_MESSAGE_MAX} characters)` }, { status: 400 });

    const limited = await checkChatRateLimit(who.userId);
    if (!limited.allowed) return NextResponse.json({ error: limited.error }, { status: 429 });

    const result = await sendChatMessage({ userId: who.userId, text: parsed.data.text, clientId: parsed.data.clientId ?? crypto.randomUUID() });
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

    const reply = result.data.assistant;
    return NextResponse.json({
        action: reply.action,
        text: replyToText({ text: reply.text, cards: reply.cards }, config.app.url),
        cards: reply.cards,
    });
}
