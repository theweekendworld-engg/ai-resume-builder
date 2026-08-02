import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getMonthInReview } from '@/actions/monthInReview';
import { MonthInReviewDocument } from '@/components/review/MonthInReviewDocument';
import { isEnabled } from '@/lib/flags';
import { parsePeriodKey, periodLabel } from '@/services/monthInReview';

/**
 * `/log/review/[yyyy-mm]` — design/02 §E.
 *
 * The web half of the Month in Review. Reached from the email, from a bookmark,
 * and from a screenshot someone wants to retake. It renders the review that was
 * sent, verbatim, so those three arrive at the same document.
 */

type PageParams = { 'yyyy-mm': string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }) {
    const { 'yyyy-mm': periodKey } = await params;
    const period = parsePeriodKey(periodKey);
    return {
        title: period ? `${periodLabel(period)} in review · Patronus` : 'Month in review · Patronus',
    };
}

export default async function MonthInReviewPage({ params }: { params: Promise<PageParams> }) {
    const { userId } = await auth();
    if (!userId || !(await isEnabled(userId, 'work_log'))) notFound();

    const { 'yyyy-mm': periodKey } = await params;
    const result = await getMonthInReview(periodKey);
    if (!result.success) notFound();

    return <MonthInReviewDocument review={result.data} />;
}
