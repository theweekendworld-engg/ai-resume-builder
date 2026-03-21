import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { getExtensionWorkspace } from '@/lib/extension/workspaces';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireExtensionAuth(_req);

    const { id } = await context.params;
    const response = await getExtensionWorkspace({
      userId,
      workspaceId: id,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load the application workspace',
      },
      { status: 500 }
    );
  }
}
