import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createExtensionSession } from '@/lib/extension/session';

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const response = await createExtensionSession(userId);
    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create extension session',
      },
      { status: 500 }
    );
  }
}
