import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { loadLogSnapshot, logNow, parseScenario } from '@/components/log/data-source';
import { LogScreen } from '@/components/log/LogScreen';
import { loadLogSurface } from '@/components/log/surface.server';
import { getEnabledFlags, isEnabled } from '@/lib/flags';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

/**
 * `/log` — the home of the product (design/02 §B).
 *
 * The server does one round trip through `loadLogSnapshot` and hands the
 * result to the client screen. `?win=<id>` is read here so a shared deep link
 * opens the drawer on first paint; from then on the client owns it via
 * `history.replaceState`, because a Next navigation per drawer open would
 * discard the list scroll position.
 *
 * `?scenario=` is a fixture-only affordance. It makes every state in the §B
 * table reachable without a database, and it disappears with the fixtures.
 */
export const metadata = {
  title: 'Work log · Patronus',
};

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ win?: string; scenario?: string; compose?: string }>;
}) {
  // Flag-gated (ADR-7). The surface now reads and writes real data, so it stays
  // invisible until `work_log` is switched on — team first, then a cohort.
  const { userId } = await auth();
  if (!userId) notFound();
  // Strangers still get a 404 — it does not disclose an unreleased feature.
  // A signed-in customer was sold this on the pricing page, so they get told
  // the truth instead.
  if (!(await isEnabled(userId, 'work_log'))) {
      return <FeatureUnavailable {...FEATURE_COPY.work_log} reason="not_enabled" />;
  }

  const params = await searchParams;
  const scenario = parseScenario(params.scenario);
  // Real connector state for the real page; `?scenario=` keeps the fixtures'.
  const surface = scenario === 'default' ? await loadLogSurface(userId) : undefined;
  const [snapshot, canConnectSources, flags] = await Promise.all([
    loadLogSnapshot(scenario, surface),
    // `/settings/sources` 404s unless this is on, so the empty state has to
    // know before it offers to send anyone there.
    isEnabled(userId, 'github_capture'),
    getEnabledFlags(userId),
  ]);
  // Pages that existed but were reachable only from an email or a packet form
  // (audit 2026-10-02). Linked only when their flag is on, so no link is a dead end.
  const lastMonth = new Date();
  lastMonth.setUTCDate(1);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const subpages = [
    ...(flags.month_in_review ? [{ href: `/log/review/${lastMonth.toISOString().slice(0, 7)}`, label: 'Last month in review' }] : []),
    ...(flags.backfill ? [{ href: '/log/backfill', label: 'Remember older work' }] : []),
    ...(flags.review_packet ? [{ href: '/log/readiness', label: 'Level readiness' }] : []),
  ];

  return (
    <LogScreen
      snapshot={snapshot}
      now={logNow()}
      initialWinId={params.win ?? null}
      canConnectSources={canConnectSources}
      subpages={subpages}
      // The digest's "Add a win" link and the quiet-week nudge land here.
      // Without this they drop the user on the log with nothing focused,
      // which is a dead end at the exact moment they intended to write.
      initialCompose={params.compose === '1'}
    />
  );
}
