import { randomUUID } from 'crypto';
import { ResumeImportStatus, ResumeImportStep } from '@prisma/client';
import { start } from 'workflow/api';
import { prisma } from '@/lib/prisma';
import { handleResumeImportWorkflow } from '@/workflows/resumeImport';

function shouldUseLocalInlineQueue(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function scheduleLocalResumeImportRun(sessionId: string): string {
  const runId = `local:${randomUUID()}`;

  setTimeout(() => {
    void (async () => {
      try {
        const [
          { prisma },
          { readResumeImportArtifact, deleteResumeImportArtifact },
          { extractHyperlinksFromPdf, extractTextFromPdf },
          { parseResumeFromPdf, parseResumeText },
        ] = await Promise.all([
          import('@/lib/prisma'),
          import('@/lib/resumeImportStorage'),
          import('@/lib/pdfParser'),
          import('@/lib/resumeParser'),
        ]);

        const session = await prisma.resumeImportSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            userId: true,
            blobKey: true,
            blobUrl: true,
          },
        });
        if (!session) return;

        const buffer = await readResumeImportArtifact(session.blobKey, session.blobUrl);
        if (!buffer) {
          throw new Error('Uploaded resume is no longer available for parsing.');
        }

        await prisma.resumeImportSession.update({
          where: { id: session.id },
          data: {
            status: ResumeImportStatus.processing,
            currentStep: ResumeImportStep.pdf_text_extract,
            stepStartedAt: new Date(),
            errorMessage: null,
          },
        });

        let extractedText = '';
        try {
          extractedText = await extractTextFromPdf(buffer);
        } catch {
          extractedText = '';
        }

        await prisma.resumeImportSession.update({
          where: { id: session.id },
          data: {
            currentStep: ResumeImportStep.pdf_link_extract,
            stepStartedAt: new Date(),
          },
        });

        let extractedLinks: Awaited<ReturnType<typeof extractHyperlinksFromPdf>> = [];
        if (extractedText.trim()) {
          try {
            extractedLinks = await extractHyperlinksFromPdf(buffer);
          } catch {
            extractedLinks = [];
          }
        }

        await prisma.resumeImportSession.update({
          where: { id: session.id },
          data: {
            currentStep: ResumeImportStep.ai_parse,
            stepStartedAt: new Date(),
          },
        });

        const parsed = extractedText.trim().length >= 80
          ? await parseResumeText(extractedText, session.userId, extractedLinks)
          : await parseResumeFromPdf(buffer, session.userId);

        await prisma.resumeImportSession.update({
          where: { id: session.id },
          data: {
            status: ResumeImportStatus.ready,
            currentStep: ResumeImportStep.ready,
            parsedData: parsed,
            stepStartedAt: new Date(),
            completedAt: new Date(),
          },
        });

        await deleteResumeImportArtifact(session.blobKey);
      } catch (error) {
        console.error('[local resume import queue] Failed to process import session', { sessionId, error });
        await prisma.resumeImportSession.updateMany({
          where: { id: sessionId },
          data: {
            status: ResumeImportStatus.failed,
            currentStep: ResumeImportStep.failed,
            stepStartedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Failed to parse resume import',
          },
        });
      }
    })();
  }, 0);

  return runId;
}

export async function enqueueResumeImportSession(
  sessionId: string,
  options?: { force?: boolean }
): Promise<{ runId: string }> {
  const queuedMarker = `queued:${randomUUID()}`;
  const updated = await prisma.resumeImportSession.updateMany({
    where: {
      id: sessionId,
      ...(options?.force ? {} : { workflowRunId: null }),
    },
    data: {
      workflowRunId: queuedMarker,
    },
  });

  if (updated.count === 0) {
    const existing = await prisma.resumeImportSession.findUnique({
      where: { id: sessionId },
      select: { workflowRunId: true },
    });
    return { runId: existing?.workflowRunId ?? queuedMarker };
  }

  try {
    if (shouldUseLocalInlineQueue()) {
      const runId = scheduleLocalResumeImportRun(sessionId);
      await prisma.resumeImportSession.update({
        where: { id: sessionId },
        data: {
          workflowRunId: runId,
        },
      });
      return { runId };
    }

    const run = await start(handleResumeImportWorkflow, [sessionId]);
    await prisma.resumeImportSession.update({
      where: { id: sessionId },
      data: {
        workflowRunId: run.runId,
      },
    });
    return { runId: run.runId };
  } catch (error: unknown) {
    await prisma.resumeImportSession.updateMany({
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
