import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getChatNotes, getCompanies, getInboxCounts, getInsights, getJobBoard } from '@/actions/inbox';
import { listScouts } from '@/actions/scout';
import { FeatureUnavailable } from '@/components/app/FeatureUnavailable';
import { CareerInbox, type InboxPanelData } from '@/components/inbox/CareerInbox';
import { boardFilters, parseInboxState, type InboxState } from '@/components/inbox/params';
import { isEnabled } from '@/lib/flags';
import type { Result } from '@/lib/result';

export const metadata = {
    title: 'Jobs · Patronus',
};

const SCOUT_COPY = {
    feature: 'Jobs',
    blurb: 'Share any LinkedIn job, post or note and find it here: jobs scored against your record, posts worth keeping, and notes on their way into your Work Log. It is being switched on in stages.',
};

/** Only the active tab's data is fetched; the other tabs cost nothing until opened. */
async function loadPanel(state: InboxState): Promise<Result<InboxPanelData>> {
    switch (state.tab) {
        case 'jobs': {
            const result = await getJobBoard(boardFilters(state));
            return result.success ? { success: true, data: { tab: 'jobs', items: result.data } } : result;
        }
        case 'insights': {
            const result = await getInsights({ tag: state.tag || null, q: state.q || null });
            return result.success ? { success: true, data: { tab: 'insights', items: result.data } } : result;
        }
        case 'companies': {
            const result = await getCompanies();
            return result.success ? { success: true, data: { tab: 'companies', items: result.data } } : result;
        }
        case 'notes': {
            const result = await getChatNotes();
            return result.success ? { success: true, data: { tab: 'notes', items: result.data } } : result;
        }
        case 'activity': {
            const result = await listScouts();
            return result.success ? { success: true, data: { tab: 'activity', items: result.data } } : result;
        }
    }
}

/**
 * `/scout` — the career inbox. Flag-gated like every R2 surface: a stranger
 * gets a 404, a signed-in customer is told the feature exists and is coming.
 */
export default async function InboxPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { userId } = await auth();
    if (!userId) notFound();
    if (!(await isEnabled(userId, 'scout'))) {
        return <FeatureUnavailable {...SCOUT_COPY} reason="not_enabled" />;
    }

    const state = parseInboxState(await searchParams);
    const [counts, panel] = await Promise.all([getInboxCounts(), loadPanel(state)]);

    return (
        <CareerInbox
            state={state}
            counts={counts.success ? counts.data : null}
            panel={panel.success ? panel.data : null}
            panelError={panel.success ? null : 'This part of your inbox did not load. Refresh to try again.'}
        />
    );
}
