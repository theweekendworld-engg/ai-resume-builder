import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getExtensionProfileBundle } from '@/lib/extension/profile';
import { suggestExtensionQuestionAnswers } from '@/lib/extension/questions';
import { ExtensionQuestionSuggestRequestSchema } from '@/lib/extension/schemas';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionQuestionSuggestRequestSchema.safeParse(body);
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
    const response = await suggestExtensionQuestionAnswers({
      userId,
      input: parsed.data,
      bundle,
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to suggest answers for the detected question',
      },
      { status: 500 }
    );
  }
}
