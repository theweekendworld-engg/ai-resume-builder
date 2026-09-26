import { after, NextRequest, NextResponse } from 'next/server';
import { processWhatsAppMessage } from '@/lib/channels/whatsappAgent';
import { handleWhatsAppHandshake, handleWhatsAppWebhookPost } from '@/lib/channels/whatsappWebhook';

export const maxDuration = 60;

/** Meta's subscription handshake. */
export async function GET(req: NextRequest) {
    const result = handleWhatsAppHandshake(req.nextUrl.searchParams);
    return new NextResponse(result.body, {
        status: result.status,
        headers: result.contentType ? { 'Content-Type': result.contentType } : undefined,
    });
}

/**
 * Inbound messages. The signature is over the RAW body, so it is read as text
 * before anything parses it. Work runs in `after()` so Meta gets its 200 at
 * once; on Vercel `after` extends the function via waitUntil.
 */
export async function POST(req: NextRequest) {
    const rawBody = await req.text();
    const result = await handleWhatsAppWebhookPost({
        rawBody,
        signature: req.headers.get('x-hub-signature-256'),
        schedule: (work) => after(work),
        process: processWhatsAppMessage,
    });
    return new NextResponse(result.body, { status: result.status });
}
