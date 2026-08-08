import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getReadiness, listFrameworkOptions } from '@/actions/packets';
import { ReadinessScreen } from '@/components/packets/ReadinessScreen';
import { getUserTier, hasFeature } from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';
import { hasFeatureOrTrial, loadTrialWindow } from '@/lib/trialWindow';

export const metadata = {
    title: 'Level readiness · Patronus',
};

/**
 * §G — `/log/readiness`. Standalone and year-round, deliberately not buried
 * inside packet generation: the value of knowing your gap is that you find out
 * while there is still time to close it.
 */
export default async function ReadinessPage({
    searchParams,
}: {
    searchParams: Promise<{ framework?: string; level?: string }>;
}) {
    const { userId } = await auth();
    if (!userId) notFound();
    // Strangers still get a 404 — it does not disclose an unreleased feature.
    // A signed-in customer was sold this on the pricing page, so they get told
    // the truth instead.
    if (!(await isEnabled(userId, 'review_packet'))) {
        return <FeatureUnavailable {...FEATURE_COPY.review_packet} reason="not_enabled" />;
    }

    const params = await searchParams;

    const [report, frameworks, tier, window] = await Promise.all([
        getReadiness({
            frameworkId: params.framework ?? null,
            targetLevel: params.level ?? null,
        }),
        listFrameworkOptions(),
        getUserTier(userId),
        loadTrialWindow(userId),
    ]);

    if (!report.success) notFound();

    return (
        <ReadinessScreen
            report={report.data}
            frameworks={frameworks.success ? frameworks.data : []}
            // Gate on the capability, not the tier name (CLAUDE.md rule 4):
            // a raw enum comparison silently breaks the moment a plan is added.
            // Free accounts see the real verdict for their trial window.
            locked={!hasFeatureOrTrial(tier, 'rubric_mapping', window)}
        />
    );
}
