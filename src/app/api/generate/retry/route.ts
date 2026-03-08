import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { runGenerationSession } from '@/actions/generationPipeline';

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

    const result = await runGenerationSession({
      sessionId,
      userId,
    });

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      status: result.status,
      resume: result.resume,
      resumeId: result.resumeId,
      atsEstimate: result.atsEstimate,
      pdfUrl: result.pdfUrl,
      reused: result.reused,
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
