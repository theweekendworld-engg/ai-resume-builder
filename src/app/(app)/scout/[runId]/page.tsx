import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getScout, getScoutSteps } from '@/actions/scout';
import { FeatureUnavailable } from '@/components/app/FeatureUnavailable';
import { ScoutRunScreen } from '@/components/scout/ScoutRunScreen';
import { isEnabled } from '@/lib/flags';

export const metadata = {
    title: 'Scout · Patronus',
};

export default async function ScoutRunPage({ params }: { params: Promise<{ runId: string }> }) {
    const { userId } = await auth();
    if (!userId) notFound();
    if (!(await isEnabled(userId, 'scout'))) {
        return <FeatureUnavailable feature="Scout" reason="not_enabled" />;
    }

    const { runId } = await params;
    const [run, steps] = await Promise.all([getScout(runId), getScoutSteps(runId)]);
    // Someone else's run and a missing run are the same answer.
    if (!run.success) {
        if (run.code === 'not_found' || run.code === 'invalid_input') notFound();
        return <FeatureUnavailable feature="Scout" reason="error" />;
    }

    return <ScoutRunScreen initialRun={run.data} initialSteps={steps.success ? steps.data : []} />;
}
