import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { OverviewScreen } from '@/components/overview/OverviewScreen';
import { getEnabledFlags } from '@/lib/flags';
import { getOverview } from '@/services/overview';

export const metadata = { title: 'Home · Patronus' };

/** `/overview` — Home: the whole search and record on one screen. */
export default async function OverviewPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    const flags = await getEnabledFlags(userId);
    const data = await getOverview(userId, {
        chat: flags.chat,
        scout: flags.scout,
        workLog: flags.work_log,
        missions: flags.missions,
        journey: flags.job_journey,
    });
    return <OverviewScreen data={data} chat={flags.chat} />;
}
