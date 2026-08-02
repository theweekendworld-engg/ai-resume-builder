import { notFound } from 'next/navigation';
import { getRadar } from '@/actions/radar';
import { RadarScreen } from '@/components/radar/RadarScreen';

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
    // A disabled flag reads as "not found" rather than "forbidden": an
    // unreleased feature should not advertise its own existence.
    if (!view.success) notFound();

    return <RadarScreen view={view.data} />;
}
