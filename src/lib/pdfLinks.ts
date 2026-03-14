import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

type PdfLocator = {
  userId: string;
  sessionId?: string | null;
  resumeId?: string | null;
};

export function buildPdfDownloadPath(pdfId: string): string {
  return `/api/pdfs/${encodeURIComponent(pdfId)}`;
}

export function buildPdfDownloadUrl(pdfId: string): string {
  return `${config.app.url.replace(/\/$/, '')}${buildPdfDownloadPath(pdfId)}`;
}

export function buildApiPdfDownloadPath(pdfId: string, userId: string): string {
  const query = new URLSearchParams({ userId });
  return `/api/v1/pdfs/${encodeURIComponent(pdfId)}?${query.toString()}`;
}

export function buildApiPdfDownloadUrl(pdfId: string, userId: string): string {
  return `${config.app.url.replace(/\/$/, '')}${buildApiPdfDownloadPath(pdfId, userId)}`;
}

export async function findLatestGeneratedPdf(params: PdfLocator): Promise<{
  id: string;
  blobKey: string;
} | null> {
  if (params.sessionId) {
    const bySession = await prisma.generatedPdf.findFirst({
      where: {
        userId: params.userId,
        sessionId: params.sessionId,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, blobKey: true },
    });
    if (bySession) return bySession;
  }

  if (params.resumeId) {
    const byResume = await prisma.generatedPdf.findFirst({
      where: {
        userId: params.userId,
        resumeId: params.resumeId,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, blobKey: true },
    });
    if (byResume) return byResume;
  }

  return null;
}
