import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getContactStats } from '@/actions/scout';
import { JobSearchPreferencesPanel } from '@/components/settings/JobSearchPreferencesPanel';
import { LinkedInConnectionsCard } from '@/components/settings/LinkedInConnectionsCard';
import { isEnabled } from '@/lib/flags';
import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';

export const metadata = {
    title: 'Job search · Patronus',
};

/**
 * `/settings/job-search` — what Scout checks jobs against, and the
 * connections it names people from.
 *
 * The preferences are not flag-gated, for the reason `/settings/resume`
 * gives: they already exist on the profile (sponsorship, relocation, work
 * modes feed resume generation too), and a setting that drives behaviour must
 * be reachable. The connections card is Scout's, so it follows Scout's flag.
 */
export default async function JobSearchSettingsPage() {
    const { userId } = await auth();
    if (!userId) notFound();

    const [profile, scoutOn] = await Promise.all([
        prisma.userProfile.findUnique({ where: { userId }, select: { preferences: true } }),
        isEnabled(userId, 'scout'),
    ]);
    const preferences = parseUserGenerationPreferences(profile?.preferences);
    const stats = scoutOn ? await getContactStats() : null;

    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
            <header>
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Job search</h1>
                <p className="mt-1.5 text-muted-foreground">
                    What you are looking for, and who you already know. Scout uses both on every job you share.
                </p>
            </header>

            <JobSearchPreferencesPanel
                initial={{
                    targetRoles: preferences.targetRoles,
                    targetLocations: preferences.targetLocations,
                    preferredWorkModes: preferences.preferredWorkModes,
                    willingToRelocate: preferences.willingToRelocate,
                    requiresSponsorship: preferences.requiresSponsorship,
                    workAuthorization: preferences.workAuthorization,
                    minCompensationText: preferences.minCompensationText,
                    desiredCompensation: preferences.desiredCompensation,
                    companySizePreference: preferences.companySizePreference,
                    noticePeriod: preferences.noticePeriod,
                }}
            />

            {scoutOn ? <LinkedInConnectionsCard initialStats={stats && stats.success ? stats.data : null} /> : null}
        </div>
    );
}
