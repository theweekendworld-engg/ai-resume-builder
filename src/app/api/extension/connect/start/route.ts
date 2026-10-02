import { NextRequest, NextResponse } from 'next/server';
import { createExtensionConnectGrant } from '@/lib/extension/connect';
import { getClientIp } from '@/lib/clientIp';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    // Public, and every call inserts a row: bounded per IP (audit 2026-10-02).
    const limited = await checkRateLimit('anonWrite', `connect:${getClientIp(req)}`);
    if (!limited.allowed) {
      return NextResponse.json({ success: false, error: limited.error }, { status: 429 });
    }
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
