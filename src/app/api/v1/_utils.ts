import { NextRequest, NextResponse } from 'next/server';

export function authenticateApiKey(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const configured = process.env.PUBLIC_API_KEY?.trim() || process.env.API_V1_KEY?.trim();
  if (!configured) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'API key auth is not configured on server' },
        { status: 500 }
      ),
    };
  }

  const provided = req.headers.get('x-api-key')?.trim();
  if (!provided || provided !== configured) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
