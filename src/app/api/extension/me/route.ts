import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getExtensionProfileBundle } from '@/lib/extension/profile';

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const bundle = await getExtensionProfileBundle(userId);
    return NextResponse.json({
      success: true,
      bundle,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load extension profile bundle',
      },
      { status: 500 }
    );
  }
}
