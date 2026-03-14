import { ResumeImportStatus, ResumeImportStep } from '@prisma/client';
import { parseResumeFromPdf, parseResumeText } from '@/lib/resumeParser';
import { extractHyperlinksFromPdf, extractTextFromPdf } from '@/lib/pdfParser';
import { prisma } from '@/lib/prisma';
import { deleteResumeImportArtifact, readResumeImportArtifact } from '@/lib/resumeImportStorage';

export async function processResumeImportSessionStep(sessionId: string) {
  'use step';

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
}

export async function failResumeImportSessionStep(sessionId: string, message: string) {
  'use step';
  await prisma.resumeImportSession.updateMany({
    where: { id: sessionId },
    data: {
      status: ResumeImportStatus.failed,
      currentStep: ResumeImportStep.failed,
      stepStartedAt: new Date(),
      errorMessage: message,
    },
  });
}
