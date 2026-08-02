import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { loadLogSnapshot, logNow, parseScenario } from '@/components/log/data-source';
import { LogScreen } from '@/components/log/LogScreen';
import { isEnabled } from '@/lib/flags';

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
  if (!userId || !(await isEnabled(userId, 'work_log'))) notFound();

  const params = await searchParams;
  const [snapshot, canConnectSources] = await Promise.all([
    loadLogSnapshot(parseScenario(params.scenario)),
    // `/settings/sources` 404s unless this is on, so the empty state has to
    // know before it offers to send anyone there.
    isEnabled(userId, 'github_capture'),
  ]);

  return (
    <LogScreen
      snapshot={snapshot}
      now={logNow()}
      initialWinId={params.win ?? null}
      canConnectSources={canConnectSources}
      // The digest's "Add a win" link and the quiet-week nudge land here.
      // Without this they drop the user on the log with nothing focused,
      // which is a dead end at the exact moment they intended to write.
      initialCompose={params.compose === '1'}
    />
  );
}
