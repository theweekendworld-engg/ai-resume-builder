import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { ExtensionWorkspaceUpsertRequestSchema, normalizeExtensionRequestBody } from '@/lib/extension/schemas';
import { upsertExtensionWorkspace } from '@/lib/extension/workspaces';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionWorkspaceUpsertRequestSchema.safeParse(normalizeExtensionRequestBody(body));
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
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upsert the application workspace',
      },
      { status: 500 }
    );
  }
}
