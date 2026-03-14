import { auth } from '@clerk/nextjs/server';
import { GenerationStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { enqueueGenerationSession } from '@/lib/generationQueue';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }

    const session = await prisma.generationSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      return NextResponse.json({ success: false, error: 'Generation session not found' }, { status: 404 });
    }

    await prisma.generationSession.update({
      where: { id: session.id },
      data: {
        status: GenerationStatus.generating,
        errorMessage: null,
        errorStep: null,
        workflowRunId: null,
      },
    });
    await enqueueGenerationSession(session.id, { force: true });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      status: 'generating',
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retry generation session',
      },
      { status: 500 }
    );
  }
}
