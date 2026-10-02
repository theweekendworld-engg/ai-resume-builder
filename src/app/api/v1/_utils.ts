import { NextRequest, NextResponse } from 'next/server';

/**
 * Closed (2026-10-02, launch audit).
 *
 * v1 authenticated with ONE server-wide key and then took `userId` from the
 * request, so anyone holding that key could read any user's profile and PDFs
 * and spend any user's quota. `PUBLIC_API_KEY` was set in production and
 * nothing in the codebase called these routes.
 *
 * Every v1 route now refuses. The CLI ships on per-user API keys that resolve
 * the user from the key itself, never from input.
 */
export function authenticateApiKey(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  void req;
  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: 'This API version is retired. Per-user API keys are coming with the Patronus CLI.' },
      { status: 410 },
    ),
  };
}
