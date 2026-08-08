import { notFound } from 'next/navigation';
import { getRadar } from '@/actions/radar';
import { RadarScreen } from '@/components/radar/RadarScreen';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

export const metadata = {
    title: 'Career Radar · Patronus',
};

/**
 * `/radar` — standalone and year-round.
 *
 * Deliberately not nested under the job-search surfaces: knowing where you
 * stand is most valuable to someone who is NOT looking, which is the whole
 * reason Radar exists (PRD 04 §1). Burying it behind an apply flow would only
 * reach people who had already decided to leave.
 */
export default async function RadarPage() {
    const view = await getRadar();
    if (!view.success) {
        // A stranger gets a 404 — an unreleased feature should not advertise
        // its own existence. A signed-in customer gets the reason, and a
        // failed corpus build is reported as a failure rather than as absence.
        if (view.code === 'unauthenticated') notFound();
        if (view.code === 'not_found') {
            return <FeatureUnavailable {...FEATURE_COPY.career_radar} reason="not_enabled" />;
        }
        return <FeatureUnavailable feature="Career Radar" reason="error" />;
    }

    return <RadarScreen view={view.data} />;
}
