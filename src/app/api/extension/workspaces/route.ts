import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { listExtensionWorkspaces } from '@/lib/extension/workspaces';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;

    const response = await listExtensionWorkspaces({
      userId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list application workspaces',
      },
      { status: 500 }
    );
  }
}
