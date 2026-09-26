import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { isEnabled } from '@/lib/flags';
import { startScoutRun } from '@/services/scout';
import { handleExtensionScout } from './handler';

// Starting a run is a claim plus an enqueue; the analysis itself runs in the
// workflow, so this returns in well under a second.
// Not 15: when the durable workflow cannot start, the run continues inside
// this request via `after()`, and a Scout run takes 20–45s.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const response = await handleExtensionScout(body, {
      authenticate: () => requireExtensionAuth(req),
      isAuthError: isExtensionAuthError,
      isScoutEnabled: (userId) => isEnabled(userId, 'scout'),
      startScoutRun,
      appUrl: config.app.url,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send this page to Patronus' },
      { status: 500 },
    );
  }
}
