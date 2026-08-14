import { NextRequest, NextResponse } from 'next/server';
import { createExtensionConnectGrant } from '@/lib/extension/connect';

export async function POST(req: NextRequest) {
  try {
    const payload = await createExtensionConnectGrant(req.nextUrl.origin);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start extension connection',
      },
      { status: 500 }
    );
  }
}
