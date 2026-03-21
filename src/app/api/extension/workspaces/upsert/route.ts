import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ExtensionWorkspaceUpsertRequestSchema } from '@/lib/extension/schemas';
import { upsertExtensionWorkspace } from '@/lib/extension/workspaces';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionWorkspaceUpsertRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
        { status: 400 }
      );
    }

    const response = await upsertExtensionWorkspace({
      userId,
      input: parsed.data,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upsert the application workspace',
      },
      { status: 500 }
    );
  }
}
