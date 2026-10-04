import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { config } from '@/lib/config';
import { readState } from '@/lib/google/oauth';
import { connectCalendar } from '@/services/calendar';

/**
 * Google's redirect back. The signed state must name the user who is signed
 * in now: an attacker cannot finish their own consent inside a victim's session.
 */
export async function GET(request: Request) {
    const app = config.app.url.replace(/\/$/, '');
    const done = (outcome: string) => NextResponse.redirect(`${app}/settings/email?calendar=${outcome}`);
    const url = new URL(request.url);
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(`${app}/sign-in`);

    if (url.searchParams.get('error')) return done('denied');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || readState(state) !== userId) return done('invalid');

    try {
        const result = await connectCalendar(userId, code);
        return done(result.success ? 'connected' : result.code === 'scope_missing' ? 'scope_missing' : 'error');
    } catch (error) {
        console.error('[google/callback] connect failed', { userId, error: error instanceof Error ? error.message : String(error) });
        return done('error');
    }
}
