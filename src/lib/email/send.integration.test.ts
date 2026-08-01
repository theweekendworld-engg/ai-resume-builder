/**
 * Email layer — integration tests against a live Postgres.
 *
 * Covers the consent machinery, which is the part of this subsystem where a bug
 * is legally and reputationally expensive: opt-out enforcement, the deliberate
 * critical-template bypass, unsubscribe idempotency, and hard-bounce suppression.
 *
 * Requires the local Docker Postgres (`.env.test` pins it).
 *
 * Not covered here — needs a real Resend sandbox key, see TODO(provider) in
 * send.test.ts: provider-500 handling, delivery idempotency, and header arrival.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import {
    applyUnsubscribe,
    ensureEmailPreference,
    sendEmail,
    suppressUserEmail,
} from './send';

const RUN = `itest-email-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function newUser(name: string): string {
    const id = `${RUN}:${name}`;
    users.push(id);
    return id;
}

afterEach(async () => {
    if (users.length === 0) return;
    await prisma.emailSend.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailPreference.deleteMany({ where: { userId: { in: users } } });
    users.length = 0;
});

describe('ensureEmailPreference', () => {
    test('creates the row with an unsubscribe token, and is idempotent', async () => {
        const userId = newUser('ensure');

        const first = await ensureEmailPreference(userId);
        expect(first.unsubscribeToken).toBeTruthy();
        expect(first.unsubscribedAll).toBe(false);
        expect(first.weeklyDigest).toBe(true);

        const second = await ensureEmailPreference(userId);
        // The token must be stable — it is embedded in already-delivered mail.
        expect(second.unsubscribeToken).toBe(first.unsubscribeToken);

        const rows = await prisma.emailPreference.findMany({ where: { userId } });
        expect(rows).toHaveLength(1);
    });

    test('tokens are unique across users', async () => {
        const a = await ensureEmailPreference(newUser('tok-a'));
        const b = await ensureEmailPreference(newUser('tok-b'));
        expect(a.unsubscribeToken).not.toBe(b.unsubscribeToken);
    });
});

describe('sendEmail — consent enforcement', () => {
    test('an opted-out user is skipped and no EmailSend row is written', async () => {
        const userId = newUser('optout');
        await ensureEmailPreference(userId);
        await prisma.emailPreference.update({
            where: { userId },
            data: { unsubscribedAll: true },
        });

        const result = await sendEmail({
            userId,
            to: 'someone@example.com',
            template: 'welcome',
            data: { firstName: 'Test' },
        } as Parameters<typeof sendEmail>[0]);

        expect(result.status).toBe('skipped');

        const rows = await prisma.emailSend.findMany({ where: { userId } });
        expect(rows).toHaveLength(0);
    });

    test('a CRITICAL template still sends to an opted-out user', async () => {
        // A5's deliberate deviation: suppressing an account-access link locks a
        // user out with no recovery path. `magic_link` is the only critical
        // template — if this ever passes for a non-critical one, that is a bug.
        const userId = newUser('critical');
        await ensureEmailPreference(userId);
        await prisma.emailPreference.update({
            where: { userId },
            data: { unsubscribedAll: true },
        });

        const result = await sendEmail({
            userId,
            to: 'someone@example.com',
            template: 'magic_link',
            data: { url: 'https://example.com/w/abc', purpose: 'confirm a win' },
        } as Parameters<typeof sendEmail>[0]);

        // It got past consent. It then fails at the fake provider key, which is
        // the expected outcome here — the assertion is that it was NOT skipped.
        expect(result.status).not.toBe('skipped');
    });

    test('an implausible recipient is rejected before any database write', async () => {
        const userId = newUser('badaddr');
        const result = await sendEmail({
            userId,
            to: 'not-an-email',
            template: 'welcome',
            data: { firstName: 'Test' },
        } as Parameters<typeof sendEmail>[0]);

        expect(result.status).toBe('skipped');
        const prefs = await prisma.emailPreference.findMany({ where: { userId } });
        expect(prefs).toHaveLength(0);
    });
});

describe('applyUnsubscribe', () => {
    test('is idempotent — the second call matches the first', async () => {
        const userId = newUser('unsub-idem');
        const { unsubscribeToken } = await ensureEmailPreference(userId);

        const first = await applyUnsubscribe({ token: unsubscribeToken });
        const second = await applyUnsubscribe({ token: unsubscribeToken });

        expect(first).toEqual(second);
        expect(first.ok).toBe(true);

        const row = await prisma.emailPreference.findUniqueOrThrow({ where: { userId } });
        expect(row.unsubscribedAll).toBe(true);
    });

    test('an unknown token returns unknown_token rather than throwing', async () => {
        const result = await applyUnsubscribe({ token: 'definitely-not-a-real-token' });
        expect(result).toEqual({ ok: false, reason: 'unknown_token' });
    });

    test('an empty token is rejected without a query', async () => {
        expect(await applyUnsubscribe({ token: '   ' })).toEqual({
            ok: false,
            reason: 'unknown_token',
        });
    });

    test('a category unsubscribe leaves the other categories untouched', async () => {
        const userId = newUser('unsub-cat');
        const { unsubscribeToken } = await ensureEmailPreference(userId);

        const result = await applyUnsubscribe({ token: unsubscribeToken, category: 'weeklyDigest' });
        expect(result).toEqual({ ok: true, scope: 'weeklyDigest', subscribed: false });

        const row = await prisma.emailPreference.findUniqueOrThrow({ where: { userId } });
        expect(row.weeklyDigest).toBe(false);
        expect(row.monthlyReview).toBe(true);
        expect(row.radarDigest).toBe(true);
        // A single-category opt-out must never escalate to a global one.
        expect(row.unsubscribedAll).toBe(false);
    });

    test('resubscribe reverses an accidental one-click unsubscribe', async () => {
        // Mail-client link prefetchers fire GET unsubscribes without the user
        // ever clicking. Reversal has to work, or that silently loses people.
        const userId = newUser('resub');
        const { unsubscribeToken } = await ensureEmailPreference(userId);

        await applyUnsubscribe({ token: unsubscribeToken });
        expect(
            (await prisma.emailPreference.findUniqueOrThrow({ where: { userId } })).unsubscribedAll,
        ).toBe(true);

        const back = await applyUnsubscribe({ token: unsubscribeToken, subscribed: true });
        expect(back).toEqual({ ok: true, scope: 'all', subscribed: true });
        expect(
            (await prisma.emailPreference.findUniqueOrThrow({ where: { userId } })).unsubscribedAll,
        ).toBe(false);
    });
});

describe('suppressUserEmail — the hard-bounce and complaint path', () => {
    test('sets unsubscribedAll for a user who already has preferences', async () => {
        const userId = newUser('bounce-existing');
        await ensureEmailPreference(userId);

        await suppressUserEmail(userId, 'hard_bounce');

        const row = await prisma.emailPreference.findUniqueOrThrow({ where: { userId } });
        expect(row.unsubscribedAll).toBe(true);
    });

    test('creates a suppressed row for a user with no preferences yet', async () => {
        // A bounce can arrive for an address we never recorded consent for.
        const userId = newUser('bounce-new');

        await suppressUserEmail(userId, 'complaint');

        const row = await prisma.emailPreference.findUniqueOrThrow({ where: { userId } });
        expect(row.unsubscribedAll).toBe(true);
        expect(row.unsubscribeToken).toBeTruthy();
    });

    test('is idempotent across repeated provider events', async () => {
        const userId = newUser('bounce-repeat');
        await suppressUserEmail(userId, 'hard_bounce');
        await suppressUserEmail(userId, 'hard_bounce');

        const rows = await prisma.emailPreference.findMany({ where: { userId } });
        expect(rows).toHaveLength(1);
        expect(rows[0].unsubscribedAll).toBe(true);
    });
});
