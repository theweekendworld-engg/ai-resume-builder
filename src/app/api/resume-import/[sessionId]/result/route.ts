import { auth } from '@clerk/nextjs/server';
import { ResumeImportStatus } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = await prisma.resumeImportSession.findFirst({
    where: { id: sessionId, userId },
    select: {
      id: true,
      status: true,
      parsedData: true,
      completedAt: true,
      errorMessage: true,
    },
  });

  if (!session) {
    return NextResponse.json({ success: false, error: 'Import session not found' }, { status: 404 });
  }

  if (session.status !== ResumeImportStatus.ready && session.status !== ResumeImportStatus.completed) {
    return NextResponse.json(
      { success: false, error: `Import session not ready (status: ${session.status})` },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    result: {
      sessionId: session.id,
      data: session.parsedData,
      completedAt: session.completedAt,
    },
  });
}
