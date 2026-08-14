import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { listPackets } from '@/actions/packets';
import { PacketList } from '@/components/packets/PacketList';
import { isEnabled } from '@/lib/flags';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

export const metadata = {
    title: 'Review packets · Patronus',
};

export default async function PacketsPage() {
    // Flag-gated (ADR-7): invisible until `review_packet` is switched on.
    const { userId } = await auth();
    if (!userId) notFound();
    // Strangers still get a 404 — it does not disclose an unreleased feature.
    // A signed-in customer was sold this on the pricing page, so they get told
    // the truth instead.
    if (!(await isEnabled(userId, 'review_packet'))) {
        return <FeatureUnavailable {...FEATURE_COPY.review_packet} reason="not_enabled" />;
    }

    const result = await listPackets();
    return <PacketList packets={result.success ? result.data : []} />;
}
