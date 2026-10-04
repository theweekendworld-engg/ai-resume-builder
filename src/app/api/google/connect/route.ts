import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { config } from '@/lib/config';
import { isEnabled } from '@/lib/flags';
import { authorizationUrl, createState } from '@/lib/google/oauth';
import { calendarAvailable } from '@/services/calendar';

/** Start Google Calendar consent (docs/prd/11 §6). */
export async function GET() {
    const app = config.app.url.replace(/\/$/, '');
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(`${app}/sign-in`);
    if (!(await isEnabled(userId, 'job_journey'))) return NextResponse.redirect(`${app}/settings/email?calendar=unavailable`);
    if (!calendarAvailable()) return NextResponse.redirect(`${app}/settings/email?calendar=not_configured`);
    return NextResponse.redirect(authorizationUrl(app, createState(userId)));
}
