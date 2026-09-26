/**
 * POST /api/extension/scout — "Send to Patronus" from the extension.
 *
 * Kept out of `route.ts` so it can be tested with its collaborators injected:
 * Next allows only route exports from a route file, and the interesting part
 * of this endpoint is the error mapping, which a live run never exercises
 * (entitlements are soft outside production, so the real gate never refuses).
 *
 * Status mapping mirrors the sibling routes:
 *   401 not authenticated · 403 flag off · 400 bad body / invalid input ·
 *   402 quota (with `paywall`, which the background turns into `paywall:`) ·
 *   503 could not enqueue · 500 anything else.
 */

import type { Result } from '@/lib/result';
import type { StartScoutParams, StartScoutResult } from '@/services/scout';
import {
  ExtensionScoutSendRequestSchema,
  normalizeExtensionRequestBody,
  type ExtensionScoutSendResponse,
} from '@/lib/extension/schemas';

export type ScoutRouteDeps = {
  authenticate: () => Promise<{ userId: string }>;
  isAuthError: (error: unknown) => error is Error;
  isScoutEnabled: (userId: string) => Promise<boolean>;
  startScoutRun: (params: StartScoutParams) => Promise<Result<StartScoutResult>>;
  appUrl: string;
};

export type ScoutRouteResponse = { status: number; body: Record<string, unknown> };

const STATUS_BY_CODE: Record<string, number> = {
  invalid_input: 400,
  entitlement_required: 402,
  enqueue_failed: 503,
  not_available: 403,
};

export async function handleExtensionScout(rawBody: unknown, deps: ScoutRouteDeps): Promise<ScoutRouteResponse> {
  let userId: string;
  try {
    ({ userId } = await deps.authenticate());
  } catch (error) {
    if (deps.isAuthError(error)) return { status: 401, body: { success: false, error: error.message } };
    throw error;
  }

  if (!(await deps.isScoutEnabled(userId))) {
    return { status: 403, body: { success: false, error: 'Scout is not available yet', code: 'not_available' } };
  }

  const parsed = ExtensionScoutSendRequestSchema.safeParse(normalizeExtensionRequestBody(rawBody));
  if (!parsed.success) {
    return {
      status: 400,
      body: { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') },
    };
  }

  const result = await deps.startScoutRun({
    userId,
    input: {
      url: parsed.data.url ?? null,
      text: parsed.data.text ?? null,
      title: parsed.data.title ?? null,
      author: parsed.data.author ?? null,
      authorUrl: parsed.data.authorUrl ?? null,
      source: 'extension',
    },
    channel: 'web',
  });

  if (!result.success) {
    const status = STATUS_BY_CODE[result.code ?? ''] ?? 500;
    return {
      status,
      body: {
        success: false,
        error: result.error,
        code: result.code,
        // The background handler keys its paywall state off this field.
        ...(status === 402 ? { paywall: { requiresUpgrade: true } } : {}),
      },
    };
  }

  const { run, created } = result.data;
  const body: ExtensionScoutSendResponse = {
    success: true,
    runId: run.id,
    created,
    status: run.status,
    headline: run.headline,
    dashboardUrl: `${deps.appUrl.replace(/\/$/, '')}/scout/${encodeURIComponent(run.id)}`,
  };
  return { status: 200, body };
}
