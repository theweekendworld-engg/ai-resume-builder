import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readStoredPdf } from '@/lib/pdfStorage';
import { resumePdfIdentity } from '@/lib/pdfLinks';
import { prisma } from '@/lib/prisma';
import { authenticateApiKey } from '@/app/api/v1/_utils';

const QuerySchema = z.object({
  userId: z.string().min(1).max(255),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = authenticateApiKey(req);
  if (!authResult.ok) return authResult.response;

  const { id } = await context.params;
  const parsedQuery = QuerySchema.safeParse({
    userId: req.nextUrl.searchParams.get('userId'),
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { success: false, error: parsedQuery.error.issues.map((issue) => issue.message).join('; ') },
      { status: 400 }
    );
  }

  const pdf = await prisma.generatedPdf.findFirst({
    where: {
      id,
      userId: parsedQuery.data.userId,
    },
    select: { blobKey: true, resumeId: true, sessionId: true },
  });
  if (!pdf) {
    return NextResponse.json({ success: false, error: 'PDF not found' }, { status: 404 });
  }

  const buffer = await readStoredPdf(pdf.blobKey);
  if (!buffer) {
    return NextResponse.json({ success: false, error: 'PDF file not found' }, { status: 404 });
  }

  const { fileName } = await resumePdfIdentity({ userId: parsedQuery.data.userId, resumeId: pdf.resumeId, sessionId: pdf.sessionId });
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.byteLength),
    },
  });
}
