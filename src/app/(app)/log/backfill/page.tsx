import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { isEnabled } from '@/lib/flags';
import { getBackfillEntryData } from '@/actions/backfill';
import { BACKFILL_ENTRY_POINTS, type BackfillEntryPoint } from '@/agents/backfillAgent';
import { BackfillEntry } from '@/components/backfill/BackfillEntry';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

/**
 * `/log/backfill` — the subject picker.
 *
 * `?from=` records which of the six PRD 07 §2 entry points sent the user here.
 * It is not decoration: completion rate is the metric this feature lives or
 * dies by, and it varies enormously by entry point — the same interview offered
 * after a GitHub backfill and offered from a gap report are two different
 * products. An unrecognised value falls back to `log_menu` rather than throwing.
 */
export const metadata = {
  title: 'Backfill · Patronus',
};

function parseEntryPoint(raw: string | undefined): BackfillEntryPoint {
  return (BACKFILL_ENTRY_POINTS as readonly string[]).includes(raw ?? '')
    ? (raw as BackfillEntryPoint)
    : 'log_menu';
}

export default async function BackfillEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) notFound();
  // Strangers still get a 404 — it does not disclose an unreleased feature.
  // A signed-in customer was sold this on the pricing page, so they get told
  // the truth instead.
  if (!(await isEnabled(userId, 'backfill'))) {
      return <FeatureUnavailable {...FEATURE_COPY.backfill} reason="not_enabled" />;
  }

  const params = await searchParams;
  const data = await getBackfillEntryData();
  if (!data.success) notFound();

  return (
    <BackfillEntry
      subjects={data.data.subjects.map((subject) => ({
        subjectId: subject.subjectId,
        label: subject.label,
        detail: subject.detail,
        resumeSessionId: subject.resumeSessionId,
      }))}
      entryPoint={parseEntryPoint(params.from)}
    />
  );
}
