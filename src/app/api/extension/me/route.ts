import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { getExtensionProfileBundle } from '@/lib/extension/profile';

export async function GET(req: NextRequest) {
  try {
    const { userId, authType } = await requireExtensionAuth(req);

    const bundle = await getExtensionProfileBundle(userId);
    return NextResponse.json({
      success: true,
      bundle,
      authType,
    });
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load extension profile bundle',
      },
      { status: 500 }
    );
  }
}
