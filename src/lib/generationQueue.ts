import { randomUUID } from 'crypto';
import { start } from 'workflow/api';
import { prisma } from '@/lib/prisma';
import { handleGenerationSessionWorkflow } from '@/workflows/generationSession';

function shouldUseLocalInlineQueue(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function scheduleLocalGenerationRun(sessionId: string): string {
  const runId = `local:${randomUUID()}`;

  setTimeout(() => {
    void (async () => {
      try {
        const [{ runGenerationSession }, { prisma }, { notifyTelegramGenerationSession }] = await Promise.all([
          import('@/actions/generationPipeline'),
          import('@/lib/prisma'),
          import('@/services/telegramGenerationNotifications'),
        ]);

        const session = await prisma.generationSession.findUnique({
          where: { id: sessionId },
          select: { id: true, userId: true },
        });
        if (!session) return;

        try {
          await runGenerationSession({
            sessionId: session.id,
            userId: session.userId,
          });
        } finally {
          await notifyTelegramGenerationSession(session.id);
        }
      } catch (error) {
        console.error('[local generation queue] Failed to run session', { sessionId, error });
      }
    })();
  }, 0);

  return runId;
}

export async function enqueueGenerationSession(
  sessionId: string,
  options?: { force?: boolean }
): Promise<{ runId: string }> {
  const queuedMarker = `queued:${randomUUID()}`;
  const updated = await prisma.generationSession.updateMany({
    where: {
      id: sessionId,
      ...(options?.force ? {} : { workflowRunId: null }),
    },
    data: {
      workflowRunId: queuedMarker,
    },
  });

  if (updated.count === 0) {
    const existing = await prisma.generationSession.findUnique({
      where: { id: sessionId },
      select: { workflowRunId: true },
    });
    return { runId: existing?.workflowRunId ?? queuedMarker };
  }

  try {
    if (shouldUseLocalInlineQueue()) {
      const runId = scheduleLocalGenerationRun(sessionId);
      await prisma.generationSession.update({
        where: { id: sessionId },
        data: {
          workflowRunId: runId,
        },
      });
      return { runId };
    }

    const run = await start(handleGenerationSessionWorkflow, [sessionId]);
    await prisma.generationSession.update({
      where: { id: sessionId },
      data: {
        workflowRunId: run.runId,
      },
    });
    return { runId: run.runId };
  } catch (error: unknown) {
    await prisma.generationSession.updateMany({
      where: {
        id: sessionId,
        workflowRunId: queuedMarker,
      },
      data: {
        workflowRunId: null,
      },
    });
    throw error;
  }
}
