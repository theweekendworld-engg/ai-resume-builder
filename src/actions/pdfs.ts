'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

export type PdfHistoryItem = {
  id: string;
  resumeId: string;
  resumeTitle: string;
  template: string;
  fileSizeBytes: number;
  blobUrl: string;
  createdAt: Date;
};

export async function getUserPdfHistory(): Promise<{
  success: boolean;
  items?: PdfHistoryItem[];
  error?: string;
}> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const pdfs = await prisma.generatedPdf.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        resumeId: true,
        template: true,
        fileSizeBytes: true,
        blobUrl: true,
        createdAt: true,
      },
    });

    const resumeIds = [...new Set(pdfs.map((p) => p.resumeId))];
    const resumes =
      resumeIds.length > 0
        ? await prisma.resume.findMany({
            where: { id: { in: resumeIds }, userId },
            select: { id: true, title: true },
          })
        : [];
    const titleByResumeId = new Map(resumes.map((r) => [r.id, r.title]));

    const items: PdfHistoryItem[] = pdfs.map((p) => ({
      id: p.id,
      resumeId: p.resumeId,
      resumeTitle: titleByResumeId.get(p.resumeId) ?? 'Untitled',
      template: p.template,
      fileSizeBytes: p.fileSizeBytes,
      blobUrl: p.blobUrl,
      createdAt: p.createdAt,
    }));

    return { success: true, items };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
