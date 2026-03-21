import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { analyzeExtensionJobPage } from '@/lib/extension/analyze';
import { getExtensionProfileBundle } from '@/lib/extension/profile';
import { ExtensionAnalyzePageRequestSchema } from '@/lib/extension/schemas';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionAnalyzePageRequestSchema.safeParse(body);
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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze extension page',
      },
      { status: 500 }
    );
  }
}
