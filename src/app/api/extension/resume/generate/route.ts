import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { startExtensionResumeGeneration } from '@/lib/extension/resume';
import { ExtensionResumeGenerateRequestSchema, normalizeExtensionRequestBody } from '@/lib/extension/schemas';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionResumeGenerateRequestSchema.safeParse(normalizeExtensionRequestBody(body));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
        { status: 400 }
      );
    }

    const response = await startExtensionResumeGeneration({
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
        error: error instanceof Error ? error.message : 'Failed to start resume generation',
      },
      { status: 500 }
    );
  }
}
