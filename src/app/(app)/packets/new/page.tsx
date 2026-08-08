import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getPacketScope } from '@/actions/packets';
import { PacketScopeForm } from '@/components/packets/PacketScopeForm';
import { isEnabled } from '@/lib/flags';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

export const metadata = {
    title: 'Generate a review packet · Patronus',
};

/** §F1. Defaults to the last six months — the one preset most people want. */
export default async function NewPacketPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    // Strangers still get a 404 — it does not disclose an unreleased feature.
    // A signed-in customer was sold this on the pricing page, so they get told
    // the truth instead.
    if (!(await isEnabled(userId, 'review_packet'))) {
        return <FeatureUnavailable {...FEATURE_COPY.review_packet} reason="not_enabled" />;
    }

    const now = new Date();
    const periodStart = new Date(now.getTime() - 182 * 86_400_000);

    const scope = await getPacketScope({ periodStart, periodEnd: now });
    if (!scope.success) notFound();

    return <PacketScopeForm initialScope={scope.data} now={now} />;
}
