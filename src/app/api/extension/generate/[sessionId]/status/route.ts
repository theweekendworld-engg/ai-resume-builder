import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { getExtensionGenerationStatus } from '@/lib/extension/resume';

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const { sessionId } = await context.params;
    const workspaceId = req.nextUrl.searchParams.get('workspaceId') || undefined;

    const response = await getExtensionGenerationStatus({
      userId,
      sessionId,
      workspaceId,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load generation status',
      },
      { status: 500 }
    );
  }
}
