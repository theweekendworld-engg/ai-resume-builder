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
          },
        });

        if (!session) {
          send('error', { message: 'Generation session not found' });
          controller.close();
          return;
        }

        send('progress', {
          sessionId: session.id,
          status: session.status,
          step: session.currentStep,
          atsScore: session.atsScore,
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
