import { auth } from '@clerk/nextjs/server';
import { GenerationStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId')?.trim() || '';
  if (!sessionId) {
    return new Response('sessionId is required', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let cancelled = false;

      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const poll = async () => {
        if (cancelled) return;

        const session = await prisma.generationSession.findFirst({
          where: { id: sessionId, userId },
          select: {
            id: true,
            status: true,
            currentStep: true,
            atsScore: true,
            pdfUrl: true,
            resultResumeId: true,
            errorMessage: true,
            parsedJD: true,
            matchedProjects: true,
            matchedAchievements: true,
          },
        });

        if (!session) {
          send('error', { message: 'Generation session not found' });
          controller.close();
          return;
        }

        const parsedJDObject = session.parsedJD && typeof session.parsedJD === 'object' && !Array.isArray(session.parsedJD)
          ? (session.parsedJD as Record<string, unknown>)
          : {};
        const requiredSkills = Array.isArray(parsedJDObject.requiredSkills)
          ? parsedJDObject.requiredSkills.filter((item) => typeof item === 'string').length
          : 0;
        const preferredSkills = Array.isArray(parsedJDObject.preferredSkills)
          ? parsedJDObject.preferredSkills.filter((item) => typeof item === 'string').length
          : 0;
        const matchedProjects = Array.isArray(session.matchedProjects) ? session.matchedProjects.length : 0;
        const matchedAchievements = Array.isArray(session.matchedAchievements) ? session.matchedAchievements.length : 0;

        send('progress', {
          sessionId: session.id,
          status: session.status,
          step: session.currentStep,
          atsScore: session.atsScore,
          details: {
            requiredSkills,
            preferredSkills,
            matchedProjects,
            matchedAchievements,
          },
        });

        if (session.status === GenerationStatus.completed) {
          send('complete', {
            sessionId: session.id,
            resumeId: session.resultResumeId,
            pdfUrl: session.pdfUrl,
            atsScore: session.atsScore,
          });
          controller.close();
          return;
        }

        if (session.status === GenerationStatus.failed) {
          send('error', {
            sessionId: session.id,
            message: session.errorMessage || 'Generation failed',
          });
          controller.close();
          return;
        }

        setTimeout(() => {
          void poll();
        }, 2000);
      };

      void poll();

      return () => {
        cancelled = true;
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
