import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { FeatureUnavailable } from '@/components/app/FeatureUnavailable';
import { WatchScreen, type WatchTab } from '@/components/watch/WatchScreen';
import { isEnabled } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { listMatches, listWatchedCompanies } from '@/services/jobWatch';

export const metadata = {
    title: 'Job watch · Patronus',
};

const COPY = {
    feature: 'Job watch',
    blurb: 'Name the companies you are aiming for. Every night Patronus checks their boards, scores new openings against your record, and messages you only about the ones you match 85% or more. It is being switched on in stages.',
};

const TABS: WatchTab[] = ['matches', 'held', 'companies'];

/**
 * `/watch` — the job watch (docs/prd/12-job-watch.md). Flag-gated like every
 * R2 surface: a stranger gets a 404, a signed-in customer is told it is coming.
 */
export default async function WatchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const { userId } = await auth();
    if (!userId) notFound();
    if (!(await isEnabled(userId, 'job_watch'))) return <FeatureUnavailable {...COPY} reason="not_enabled" />;

    const raw = (await searchParams).tab;
    const tab = TABS.find((candidate) => candidate === raw) ?? 'matches';

    const [companies, matches, held, profile] = await Promise.all([
        listWatchedCompanies(userId),
        listMatches(userId, 'qualified'),
        tab === 'held' ? listMatches(userId, 'held') : Promise.resolve([]),
        prisma.userProfile.findUnique({ where: { userId }, select: { preferences: true } }),
    ]);
    const prefs = parseUserGenerationPreferences(profile?.preferences);

    return (
        <WatchScreen
            tab={tab}
            companies={companies}
            matches={matches}
            held={held}
            prefs={{ targetRoles: prefs.targetRoles, targetLocations: prefs.targetLocations, preferredWorkModes: prefs.preferredWorkModes }}
        />
    );
}
