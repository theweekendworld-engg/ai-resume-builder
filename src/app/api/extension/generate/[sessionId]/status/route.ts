import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getExtensionGenerationStatus } from '@/lib/extension/resume';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { sessionId } = await context.params;
    const workspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined;

    const response = await getExtensionGenerationStatus({
      userId,
      sessionId,
      workspaceId,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load generation status',
      },
      { status: 500 }
    );
  }
}
