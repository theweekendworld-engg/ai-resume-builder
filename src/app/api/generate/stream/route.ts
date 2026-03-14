import { auth } from '@clerk/nextjs/server';
import { GenerationStatus } from '@prisma/client';
import { getGenerationDetailLines, getGenerationProgressPercent, getGenerationStageLabel } from '@/lib/generationProgress';
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
      let closed = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try {
          controller.close();
        } catch {
          // Stream already closed by the runtime.
        }
      };

      const send = (event: string, payload: unknown) => {
        if (cancelled || closed) return false;

        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const poll = async () => {
        if (cancelled) return;
        try {
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
              stepStartedAt: true,
              startedAt: true,
              parsedJD: true,
              matchedProjects: true,
              matchedAchievements: true,
            },
          });

          if (!session) {
            send('error', { message: 'Generation session not found' });
            close();
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

          const sent = send('progress', {
            sessionId: session.id,
            status: session.status,
            step: session.currentStep,
            stageLabel: getGenerationStageLabel(session.currentStep),
            progressPercent: getGenerationProgressPercent(session.currentStep),
            elapsedMs: Date.now() - session.startedAt.getTime(),
            stepStartedAt: session.stepStartedAt?.toISOString() ?? null,
            atsScore: session.atsScore,
            details: {
              requiredSkills,
              preferredSkills,
              matchedProjects,
              matchedAchievements,
            },
            detailLines: getGenerationDetailLines({
              step: session.currentStep,
              requiredSkills,
              preferredSkills,
              matchedProjects,
              matchedAchievements,
              atsScore: session.atsScore,
            }),
          });
          if (!sent) return;

          if (session.status === GenerationStatus.completed) {
            send('complete', {
              sessionId: session.id,
              resumeId: session.resultResumeId,
              pdfUrl: session.pdfUrl,
              atsScore: session.atsScore,
            });
            close();
            return;
          }

          if (session.status === GenerationStatus.failed) {
            send('error', {
              sessionId: session.id,
              message: session.errorMessage || 'Generation failed',
            });
            close();
            return;
          }

          timeoutId = setTimeout(() => {
            void poll();
          }, 2000);
        } catch (error) {
          console.error('Generation stream polling failed:', error);
          send('error', { message: 'Failed to stream generation progress' });
          close();
        }
      };

      void poll();

      return () => {
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
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
