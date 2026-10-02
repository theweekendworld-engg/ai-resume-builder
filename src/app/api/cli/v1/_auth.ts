import { NextRequest, NextResponse } from 'next/server';
import { resolveApiKey } from '@/lib/apiKeys';
import { isEnabled } from '@/lib/flags';

/** The key's owner, if the key is live and chat is on for them; else the response to send. */
export async function cliUser(req: NextRequest): Promise<{ userId: string } | { response: NextResponse }> {
    const owner = await resolveApiKey(req.headers.get('authorization'));
    if (!owner) {
        return { response: NextResponse.json({ error: 'Invalid or revoked API key. Create one in Settings → Channels.' }, { status: 401 }) };
    }
    if (!(await isEnabled(owner.userId, 'chat'))) {
        return { response: NextResponse.json({ error: 'Chat is not switched on for this account yet.' }, { status: 403 }) };
    }
    return { userId: owner.userId };
}
