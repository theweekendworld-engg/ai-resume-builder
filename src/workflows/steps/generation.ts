import { runGenerationSession } from '@/actions/generationPipeline';
import { prisma } from '@/lib/prisma';
import { notifyTelegramGenerationSession } from '@/services/telegramGenerationNotifications';

export async function executeGenerationSessionStep(sessionId: string) {
  'use step';

  const session = await prisma.generationSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
    },
  });
  if (!session) {
    return;
  }

  await runGenerationSession({
    sessionId: session.id,
    userId: session.userId,
  });
}

export async function notifyTelegramSessionStep(sessionId: string) {
  'use step';
  await notifyTelegramGenerationSession(sessionId);
}
