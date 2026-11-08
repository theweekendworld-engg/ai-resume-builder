import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { resumeFileName } from '@/lib/resumeFileName';
import { extractParsedJDTarget } from '@/lib/resumeIdentity';

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

export type ResumePdfIdentity = {
  fullName: string | null;
  role: string | null;
  company: string | null;
  /** `Jai_Shankar_Resume_iServeWorld.pdf` (src/lib/resumeFileName.ts). */
  fileName: string;
};

/**
 * Who a resume PDF is for and which job, read from the record: the resume's
 * own name and target, then the generation's parsed posting, then the
 * profile. Every query is scoped by `userId`.
 */
export async function resumePdfIdentity(params: { userId: string; resumeId?: string | null; sessionId?: string | null }): Promise<ResumePdfIdentity> {
  const [resume, session, profile] = await Promise.all([
    params.resumeId
      ? prisma.resume.findFirst({
        where: { id: params.resumeId, userId: params.userId },
        select: { content: true, targetRole: true, targetCompany: true },
      })
      : Promise.resolve(null),
    params.sessionId
      ? prisma.generationSession.findFirst({ where: { id: params.sessionId, userId: params.userId }, select: { parsedJD: true } })
      : Promise.resolve(null),
    prisma.userProfile.findUnique({ where: { userId: params.userId }, select: { fullName: true } }),
  ]);
  const content = resume?.content as { personalInfo?: { fullName?: unknown } } | null | undefined;
  const contentName = typeof content?.personalInfo?.fullName === 'string' ? content.personalInfo.fullName.trim() : '';
  const parsed = extractParsedJDTarget(session?.parsedJD);
  const fullName = contentName || profile?.fullName?.trim() || null;
  const role = resume?.targetRole?.trim() || parsed.role || null;
  const company = resume?.targetCompany?.trim() || parsed.company || null;
  return { fullName, role, company, fileName: resumeFileName({ fullName, company }) };
}
