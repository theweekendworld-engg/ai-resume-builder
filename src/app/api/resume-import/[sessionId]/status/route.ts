import { auth } from '@clerk/nextjs/server';
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
      currentStep: true,
      errorMessage: true,
      startedAt: true,
      stepStartedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ success: false, error: 'Import session not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    session: {
      ...session,
      elapsedMs: Date.now() - session.startedAt.getTime(),
      stepStartedAt: session.stepStartedAt?.toISOString() ?? null,
    },
  });
}
