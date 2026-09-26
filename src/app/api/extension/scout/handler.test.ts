/**
 * The contract between "Send to Patronus" and Scout: what reaches the service,
 * and how each refusal reaches the extension. The paywall and flag branches
 * cannot be exercised live (enforcement is soft outside production, the flag
 * is seeded off), so they are pinned here.
 */

import { describe, expect, test } from 'bun:test';
import { err, ok } from '@/lib/result';
import type { StartScoutParams } from '@/services/scout';
import type { ScoutRunView } from '@/lib/scout/types';
import { handleExtensionScout, type ScoutRouteDeps } from './handler';

class FakeAuthError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'ExtensionAuthError';
  }
}

function view(overrides: Partial<ScoutRunView> = {}): ScoutRunView {
  return {
    id: 'run_1',
    status: 'queued',
    kind: null,
    input: { url: null, text: null, source: 'extension' },
    channel: 'web',
    sections: {},
    plan: ['ingest', 'classify'],
    pendingQuestion: null,
    drafts: [],
    headline: 'Reading your link…',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

function deps(overrides: Partial<ScoutRouteDeps> = {}): ScoutRouteDeps & { calls: StartScoutParams[] } {
  const calls: StartScoutParams[] = [];
  return {
    calls,
    authenticate: async () => ({ userId: 'user_1' }),
    isAuthError: (error: unknown): error is Error => error instanceof FakeAuthError,
    isScoutEnabled: async () => true,
    startScoutRun: async (params) => {
      calls.push(params);
      return ok({ run: view(), created: true });
    },
    appUrl: 'https://aicv.example.com/',
    ...overrides,
  };
}

describe('POST /api/extension/scout', () => {
  test('forwards the page as an extension-sourced input and links to the run', async () => {
    const d = deps();
    const res = await handleExtensionScout({
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000000/',
      title: 'Priya on LinkedIn',
      text: 'We are hiring backend engineers in Bengaluru.',
      kindHint: 'linkedin_post',
    }, d);

    expect(res.status).toBe(200);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0].input.source).toBe('extension');
    expect(d.calls[0].input.text).toContain('hiring backend');
    expect(d.calls[0].channel).toBe('web');
    expect(res.body.dashboardUrl).toBe('https://aicv.example.com/scout/run_1');
    expect(res.body.created).toBe(true);
  });

  test('text without a url is accepted — a feed post with no permalink', async () => {
    const d = deps();
    const res = await handleExtensionScout({ text: 'A long post about system design interviews at Stripe.' }, d);
    expect(res.status).toBe(200);
    expect(d.calls[0].input.url).toBeNull();
  });

  test('nulls from the extension are treated as absent', async () => {
    const d = deps();
    const res = await handleExtensionScout({ url: 'https://example.com/job', title: null, text: null }, d);
    expect(res.status).toBe(200);
    expect(d.calls[0].input.title).toBeNull();
  });

  test('neither url nor text is a 400 and never reaches the service', async () => {
    const d = deps();
    const res = await handleExtensionScout({ title: 'x' }, d);
    expect(res.status).toBe(400);
    expect(d.calls).toHaveLength(0);
  });

  test('unauthenticated is 401', async () => {
    const res = await handleExtensionScout({ text: 'x'.repeat(50) }, deps({
      authenticate: async () => { throw new FakeAuthError(); },
    }));
    expect(res.status).toBe(401);
  });

  test('flag off is 403 with a code the panel can branch on', async () => {
    const d = deps({ isScoutEnabled: async () => false });
    const res = await handleExtensionScout({ text: 'x'.repeat(50) }, d);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_available');
    expect(d.calls).toHaveLength(0);
  });

  test('quota refusal is 402 carrying paywall, so the background shows an upgrade path', async () => {
    const res = await handleExtensionScout({ text: 'x'.repeat(50) }, deps({
      startScoutRun: async () => err('You have analysed 30 links this period.', 'entitlement_required'),
    }));
    expect(res.status).toBe(402);
    expect(res.body.paywall).toBeTruthy();
    expect(res.body.error).toContain('30 links');
  });

  test('service validation failures are 400; enqueue failure is 503', async () => {
    const invalid = await handleExtensionScout({ text: 'short' }, deps({
      startScoutRun: async () => err('That is too short to analyse.', 'invalid_input'),
    }));
    expect(invalid.status).toBe(400);

    const down = await handleExtensionScout({ text: 'x'.repeat(50) }, deps({
      startScoutRun: async () => err('Could not start', 'enqueue_failed'),
    }));
    expect(down.status).toBe(503);
  });

  test('a repeated share returns the existing run, uncharged', async () => {
    const res = await handleExtensionScout({ url: 'https://example.com/job' }, deps({
      startScoutRun: async () => ok({ run: view({ status: 'succeeded', headline: 'SDE II at Acme · Strong fit (82)' }), created: false }),
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.headline).toContain('Strong fit');
  });
});
