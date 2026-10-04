import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { FeatureUnavailable } from '@/components/app/FeatureUnavailable';
import { EmailSetup } from '@/components/journey/EmailSetup';
import { PageHeader, PageBody } from '@/components/patterns';
import { isEnabled } from '@/lib/flags';
import { calendarStatus } from '@/services/calendar';
import { getOrCreateInbox } from '@/services/journey';

export const metadata = { title: 'Email & calendar · Patronus' };

const CALENDAR_NOTICE: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
    connected: { tone: 'ok', text: 'Google Calendar is connected. Interviews on it now show up on your jobs.' },
    denied: { tone: 'warn', text: 'Google Calendar was not connected: access was declined.' },
    scope_missing: { tone: 'warn', text: 'Calendar access was not granted. Connect again and tick the calendar box on Google’s screen.' },
    invalid: { tone: 'warn', text: 'That connection link expired or was not yours. Start again from here.' },
    not_configured: { tone: 'warn', text: 'Google Calendar is not set up on this server yet.' },
    unavailable: { tone: 'warn', text: 'Email and calendar are not available on your account yet.' },
    error: { tone: 'warn', text: 'Something went wrong connecting Google Calendar. Try again.' },
};

/** `/settings/email` — forwarding and the calendar (docs/prd/11-job-journey.md §2). */
export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
    const { userId } = await auth();
    if (!userId) notFound();
    if (!(await isEnabled(userId, 'job_journey'))) {
        return (
            <FeatureUnavailable
                feature="Email & calendar"
                blurb="Forward job email to Patronus and connect your calendar, and every application tracks itself: replies, interviews and follow-ups. It is being switched on in stages."
                reason="not_enabled"
            />
        );
    }
    const [inbox, calendar, params] = await Promise.all([getOrCreateInbox(userId), calendarStatus(userId), searchParams]);
    const notice = params.calendar ? CALENDAR_NOTICE[params.calendar] ?? null : null;

    return (
        <div>
            <PageHeader
                title="Email & calendar"
                description="Forward job email and connect your calendar. Every application then tracks itself."
            />
            <PageBody className="max-w-3xl">
                <EmailSetup inbox={inbox} calendar={calendar} notice={notice} />
            </PageBody>
        </div>
    );
}
