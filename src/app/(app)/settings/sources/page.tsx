import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getSourcesOverview } from '@/actions/capture';
import { isEnabled } from '@/lib/flags';
import { SourcesClient } from './sources-client';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

/**
 * `/settings/sources` — design/02 §J1.
 *
 * Flag-gated (ADR-7): the page reads and writes real connector state, so it
 * stays invisible until `github_capture` is switched on — team first, then a
 * cohort. `notFound()` rather than a redirect, because a 404 does not tell an
 * unauthorised visitor that the route exists.
 */
export const metadata = {
    title: 'Connected sources · Patronus',
};

export default async function SourcesSettingsPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    // Strangers still get a 404 — it does not disclose an unreleased feature.
    // A signed-in customer was sold this on the pricing page, so they get told
    // the truth instead.
    if (!(await isEnabled(userId, 'github_capture'))) {
        return <FeatureUnavailable {...FEATURE_COPY.github_capture} reason="not_enabled" />;
    }

    const overview = await getSourcesOverview();
    if (!overview.success) notFound();

    return <SourcesClient initial={overview.data} />;
}
