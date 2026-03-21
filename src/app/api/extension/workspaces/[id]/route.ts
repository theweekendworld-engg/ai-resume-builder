import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getExtensionWorkspace } from '@/lib/extension/workspaces';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await context.params;
    const response = await getExtensionWorkspace({
      userId,
      workspaceId: id,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load the application workspace',
      },
      { status: 500 }
    );
  }
}
