import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateApiKey } from '@/app/api/v1/_utils';

const QuerySchema = z.object({
  userId: z.string().min(1).max(255),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  const authResult = authenticateApiKey(req);
  if (!authResult.ok) return authResult.response;

  const { sessionId } = await context.params;
  const parsedQuery = QuerySchema.safeParse({
    userId: req.nextUrl.searchParams.get('userId'),
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { success: false, error: parsedQuery.error.issues.map((issue) => issue.message).join('; ') },
      { status: 400 }
    );
  }

  const session = await prisma.generationSession.findFirst({
    where: {
      id: sessionId,
      userId: parsedQuery.data.userId,
    },
    select: {
      id: true,
      status: true,
      draftResume: true,
      resultResumeId: true,
      atsScore: true,
      pdfUrl: true,
      validationResult: true,
      completedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'completed') {
    return NextResponse.json(
      { success: false, error: `Session not completed (status: ${session.status})` },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    result: {
      sessionId: session.id,
      resumeId: session.resultResumeId,
      resume: session.draftResume,
      atsScore: session.atsScore,
      pdfUrl: session.pdfUrl,
      validation: session.validationResult,
      completedAt: session.completedAt,
    },
  });
}
