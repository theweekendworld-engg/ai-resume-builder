/**
 * The Dodo webhook authenticates itself (Standard Webhooks signature), so the
 * proxy must let it past Clerk — a webhook behind `auth.protect()` is a 404 to
 * Dodo and every purchase goes ungranted — and must not rate-limit it. The
 * Stripe webhook had both; this pins the same two lines for Dodo.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const proxy = readFileSync(join(import.meta.dir, '..', '..', 'proxy.ts'), 'utf8');

describe('src/proxy.ts and the Dodo webhook', () => {
    test('is in the self-authenticated allow-list', () => {
        const allowList = proxy.slice(proxy.indexOf('isSelfAuthenticatedApiRoute = createRouteMatcher(['), proxy.indexOf(']);', proxy.indexOf('isSelfAuthenticatedApiRoute')));
        expect(allowList).toContain("'/api/dodo/webhook'");
    });

    test('is excluded from the per-IP rate limit', () => {
        const line = proxy.split('\n').find((l) => l.includes('const shouldRateLimit'));
        expect(line).toContain("!pathname.startsWith('/api/dodo/webhook')");
    });
});
