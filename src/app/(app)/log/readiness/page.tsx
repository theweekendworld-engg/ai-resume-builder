import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getReadiness, listFrameworkOptions } from '@/actions/packets';
import { ReadinessScreen } from '@/components/packets/ReadinessScreen';
import { getUserTier, hasFeature } from '@/lib/entitlements';
import { isEnabled } from '@/lib/flags';

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
    if (!userId || !(await isEnabled(userId, 'review_packet'))) notFound();

    const params = await searchParams;

    const [report, frameworks, tier] = await Promise.all([
        getReadiness({
            frameworkId: params.framework ?? null,
            targetLevel: params.level ?? null,
        }),
        listFrameworkOptions(),
        getUserTier(userId),
    ]);

    if (!report.success) notFound();

    return (
        <ReadinessScreen
            report={report.data}
            frameworks={frameworks.success ? frameworks.data : []}
            // Gate on the capability, not the tier name (CLAUDE.md rule 4):
            // a raw enum comparison silently breaks the moment a plan is added.
            locked={!hasFeature(tier, 'rubric_mapping')}
        />
    );
}
