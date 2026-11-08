import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { EyebrowLink, PageBody, PageHeader } from '@/components/patterns';

import { prisma } from '@/lib/prisma';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { ResumeSectionsPanel } from '@/components/settings/ResumeSectionsPanel';

/**
 * `/settings/resume` — the defaults every generated resume follows.
 *
 * Not flag-gated. These preferences already drive generation whether or not
 * anyone has ever seen this page; hiding the screen behind a flag would mean a
 * user's resumes obey settings they cannot reach, which is how the section
 * order came to be silently overridden in the first place.
 *
 * Reads Prisma directly rather than through an action because there is nothing
 * to authorise beyond "your own row" and nothing to meter — `auth()` above is
 * the whole check.
 */
export const metadata = {
    title: 'Resume defaults · Patronus',
};

export default async function ResumeSettingsPage() {
    const { userId } = await auth();
    if (!userId) notFound();

    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { preferences: true },
    });
    const preferences = parseUserGenerationPreferences(profile?.preferences);

    return (
        <div>
            <PageHeader width="narrow"
                eyebrow={<EyebrowLink href="/settings">Settings</EyebrowLink>}
                title="Resume defaults"
                description="These apply to every resume you generate from now on. Resumes you have already made are unchanged."
            />
            <PageBody width="narrow" className="space-y-6">

            <ResumeSectionsPanel initial={preferences.defaultSectionOrder} />
            </PageBody>
        </div>
    );
}
