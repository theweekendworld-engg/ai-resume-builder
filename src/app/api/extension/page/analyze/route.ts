import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { analyzeExtensionJobPage } from '@/lib/extension/analyze';
import { getExtensionProfileBundle } from '@/lib/extension/profile';
import { ExtensionAnalyzePageRequestSchema, normalizeExtensionRequestBody } from '@/lib/extension/schemas';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionAnalyzePageRequestSchema.safeParse(normalizeExtensionRequestBody(body));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
        { status: 400 }
      );
    }

    const bundle = await getExtensionProfileBundle(userId);
    const analysis = await analyzeExtensionJobPage({
      userId,
      input: parsed.data,
      bundle,
    });

    return NextResponse.json(analysis);
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze extension page',
      },
      { status: 500 }
    );
  }
}
