import { notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { isEnabled } from '@/lib/flags';
import { getBackfillSession } from '@/actions/backfill';
import { BackfillChat } from '@/components/backfill/BackfillChat';
import type { CapturedWinView } from '@/components/backfill/types';
import { FeatureUnavailable, FEATURE_COPY } from '@/components/app/FeatureUnavailable';

/**
 * `/log/backfill/[sessionId]` — the conversation (design/02 §I).
 *
 * The server rehydrates without asking anything. A session opened cold, or
 * picked up three weeks later, must land the user exactly where they were: the
 * last question still on screen, every card still in the rail, nothing
 * re-asked. That resumability is what makes it safe to say "leave whenever you
 * like" — and saying so is what makes people start.
 */
export const metadata = {
  title: 'Backfill · Patronus',
};

export default async function BackfillSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) notFound();
  // Strangers still get a 404 — it does not disclose an unreleased feature.
  // A signed-in customer was sold this on the pricing page, so they get told
  // the truth instead.
  if (!(await isEnabled(userId, 'backfill'))) {
      return <FeatureUnavailable {...FEATURE_COPY.backfill} reason="not_enabled" />;
  }

  const { sessionId } = await params;
  const session = await getBackfillSession(sessionId);
  if (!session.success) notFound();

  const { turn } = session.data;

  return (
    <BackfillChat
      bootstrap={{
        sessionId: session.data.sessionId,
        subjectLabel: session.data.subjectLabel,
        transcript: session.data.transcript.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        acknowledgement: turn.acknowledgement,
        question: turn.question,
        progress: turn.progress,
        captured: session.data.captured as CapturedWinView[],
        done: turn.done,
      }}
    />
  );
}
