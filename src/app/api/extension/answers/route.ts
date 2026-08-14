import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { listReusableAnswers } from '@/lib/extension/questions';

/**
 * The saved-answer library.
 *
 * Read-only counterpart to `POST /api/extension/questions/save`, which has been
 * writing `ReusableAnswer` rows that nothing could read back.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireExtensionAuth(req);

    const limitParam = req.nextUrl.searchParams.get('limit');
    const parsedLimit = limitParam === null ? undefined : Number(limitParam);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

    const answers = await listReusableAnswers({ userId, limit });
    return NextResponse.json({ success: true, answers });
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list saved answers',
      },
      { status: 500 }
    );
  }
}
