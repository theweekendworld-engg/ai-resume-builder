import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { listFrameworkOptions } from '@/actions/packets';
import { RubricUploadScreen } from '@/components/packets/RubricUploadScreen';
import { isEnabled } from '@/lib/flags';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

export const metadata = {
    title: 'Leveling frameworks · Patronus',
};

export default async function FrameworksPage() {
    const { userId } = await auth();
    if (!userId) notFound();
    // Strangers still get a 404 — it does not disclose an unreleased feature.
    // A signed-in customer was sold this on the pricing page, so they get told
    // the truth instead.
    if (!(await isEnabled(userId, 'review_packet'))) {
        return <FeatureUnavailable {...FEATURE_COPY.review_packet} reason="not_enabled" />;
    }

    const result = await listFrameworkOptions();
    return <RubricUploadScreen frameworks={result.success ? result.data : []} />;
}
