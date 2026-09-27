import { prisma } from '@/lib/prisma';
import { nextClarificationQuestion } from '@/lib/channels/clarification';

/** The next unanswered question of the user's own generation session. */
export async function nextGenerationQuestion(userId: string, sessionId: string): Promise<string | null> {
    const session = await prisma.generationSession.findFirst({
        where: { id: sessionId, userId },
        select: { clarifications: true },
    });
    return session ? nextClarificationQuestion(session.clarifications) : null;
}
