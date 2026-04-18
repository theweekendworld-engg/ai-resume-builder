import { NextRequest, NextResponse } from 'next/server';
import { pollExtensionConnectGrant } from '@/lib/extension/connect';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const grantId = typeof body.grantId === 'string' ? body.grantId.trim() : '';
    const verifier = typeof body.verifier === 'string' ? body.verifier.trim() : '';

    if (!grantId || !verifier) {
      return NextResponse.json(
        { success: false, status: 'invalid_request', error: 'Missing extension connection grant details' },
        { status: 400 }
      );
    }

    const result = await pollExtensionConnectGrant(grantId, verifier);
    const status = result.success
      ? 200
      : result.status === 'invalid_verifier'
        ? 401
        : result.status === 'not_found'
          ? 404
          : 410;

    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        status: 'server_error',
        error: error instanceof Error ? error.message : 'Failed to poll extension connection',
      },
      { status: 500 }
    );
  }
}
