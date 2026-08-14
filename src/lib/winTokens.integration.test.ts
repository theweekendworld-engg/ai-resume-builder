/**
 * Magic-link tokens against a live Postgres — PRD 01 §9.3.
 *
 * The pure suite proves a token cannot be forged. This one proves the harder
 * half: that a token which IS valid still cannot do more than its one job.
 *
 *   - it is single use, and a replay renders the already-done page, not an error
 *   - it is scoped to one (win, action) and cannot reach a second Win, another
 *     user's Win, or a Win that was not in this digest
 *   - it confirms through the real graph path, so CLAUDE.md rule 5 holds:
 *     Evidence(confirmedByUser) + ClaimLink(grounded), exactly one of each
 *   - it grants no read: nothing in the API surface returns the log
 *   - undo reverses exactly what that token did, and a refresh after an undo
 *     does not redo it
 *
 * Requires the local Docker Postgres and Qdrant.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { GroundState, WinStatus, Channel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    WIN_CLAIM_TYPE,
    getWinView,
} from '@/services/winGraph';
import { cleanupTestUser, makeWin, newTestUserId } from '@/services/winFixtures.test-utils';
import {
    applyDigestAction,
    createDigestRoot,
    findConsumption,
    mintWinToken,
    readActionState,
    resolveDigestTarget,
    resolveWinToken,
    undoDigestAction,
    WIN_TOKEN_TTL_MS,
} from './winTokens';

const users: string[] = [];
const digestIds: string[] = [];

function newUser(label: string): string {
    const id = newTestUserId(label);
    users.push(id);
    return id;
}

async function makeDigest(input: {
    userId: string;
    winIds: string[];
    createdAt?: Date;
    channel?: Channel;
}): Promise<{ id: string; token: string }> {
    const row = await prisma.weeklyDigest.create({
        data: {
            userId: input.userId,
            weekStart: new Date(`2026-07-${20 + digestIds.length}T00:00:00.000Z`),
            channel: input.channel ?? Channel.email,
            token: createDigestRoot(),
            winIds: input.winIds,
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        },
        select: { id: true, token: true },
    });
    digestIds.push(row.id);
    return row;
}

function token(root: string, winId: string, action: 'confirm' | 'dismiss' | 'edit'): string {
    const minted = mintWinToken({ root, winId, action });
    if (!minted) throw new Error('WIN_MAGIC_LINK_SECRET must be set for these tests');
    return minted;
}

afterEach(async () => {
    if (digestIds.length > 0) {
        await prisma.weeklyDigest.deleteMany({ where: { id: { in: digestIds } } });
        digestIds.length = 0;
    }
    for (const userId of users) await cleanupTestUser(userId);
    users.length = 0;
});

// ───────────────────────────────────────────────────────────── resolution

describe('resolveWinToken', () => {
    test('resolves a well-formed token to its digest and Win', async () => {
        const userId = newUser('resolve');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const result = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resolved.digest.userId).toBe(userId);
        expect(result.resolved.win.id).toBe(win.id);
        expect(result.resolved.payload.action).toBe('confirm');
    });

    test('rejects a Win that was not in this digest, even with a valid signature', async () => {
        const userId = newUser('scope');
        const listed = await makeWin({ userId });
        const unlisted = await makeWin({ userId, title: 'Not in the digest' });
        const digest = await makeDigest({ userId, winIds: [listed.id] });

        // A correctly signed token for a Win this digest never carried. The
        // signature is genuine; the scope check is what stops it.
        const result = await resolveWinToken(token(digest.token, unlisted.id, 'confirm'));
        expect(result).toEqual({ ok: false, reason: 'out_of_scope' });
    });

    test("rejects another user's Win", async () => {
        const victim = newUser('victim');
        const attacker = newUser('attacker');
        const victimWin = await makeWin({ userId: victim, title: "Victim's win" });
        // The attacker somehow gets the victim's win id listed on their own digest.
        const digest = await makeDigest({ userId: attacker, winIds: [victimWin.id] });

        const result = await resolveWinToken(token(digest.token, victimWin.id, 'confirm'));
        expect(result).toEqual({ ok: false, reason: 'win_missing' });

        const after = await prisma.win.findUnique({ where: { id: victimWin.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.draft);
    });

    test('rejects an unknown digest root', async () => {
        const userId = newUser('unknown');
        const win = await makeWin({ userId });
        const result = await resolveWinToken(token(createDigestRoot(), win.id, 'confirm'));
        expect(result).toEqual({ ok: false, reason: 'unknown_digest' });
    });

    test('rejects a token whose digest is older than 30 days', async () => {
        const userId = newUser('expired');
        const win = await makeWin({ userId });
        const digest = await makeDigest({
            userId,
            winIds: [win.id],
            createdAt: new Date(Date.now() - WIN_TOKEN_TTL_MS - 60_000),
        });

        expect(await resolveWinToken(token(digest.token, win.id, 'confirm'))).toEqual({
            ok: false,
            reason: 'expired',
        });
    });

    test('still resolves at 29 days — people read email late', async () => {
        const userId = newUser('late');
        const win = await makeWin({ userId });
        const digest = await makeDigest({
            userId,
            winIds: [win.id],
            createdAt: new Date(Date.now() - 29 * 86_400_000),
        });

        expect((await resolveWinToken(token(digest.token, win.id, 'confirm'))).ok).toBe(true);
    });

    test('rejects a Win deleted after the digest went out', async () => {
        const userId = newUser('deleted');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        await prisma.win.delete({ where: { id: win.id } });

        expect(await resolveWinToken(token(digest.token, win.id, 'confirm'))).toEqual({
            ok: false,
            reason: 'win_missing',
        });
    });
});

// ───────────────────────────────────────────────────── confirm through the graph

describe('confirm', () => {
    test('writes Evidence + ClaimLink(grounded) — CLAUDE.md rule 5', async () => {
        const userId = newUser('confirm');
        const win = await makeWin({ userId, sourceRef: 'https://github.com/patronus/api/pull/482' });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const outcome = await applyDigestAction(resolved.resolved, { surface: 'email' });
        expect(outcome.outcome).toBe('applied');

        const after = await prisma.win.findUnique({ where: { id: win.id } });
        expect(after?.status).toBe(WinStatus.confirmed);
        expect(after?.confirmedAt).not.toBeNull();

        const links = await prisma.claimLink.findMany({
            where: { userId, claimType: WIN_CLAIM_TYPE, claimRefId: win.id },
            include: { evidence: true },
        });
        expect(links).toHaveLength(1);
        expect(links[0].groundState).toBe(GroundState.grounded);
        expect(links[0].evidence.confirmedByUser).toBe(true);
    });

    test('records the funnel event the whole ritual is measured by', async () => {
        const userId = newUser('telemetry');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id], channel: Channel.email });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        const events = await prisma.funnelEvent.findMany({ where: { userId, type: 'digest_action' } });
        expect(events).toHaveLength(1);
        const payload = events[0].payload as Record<string, unknown>;
        expect(payload.surface).toBe('email');
        expect(payload.winId).toBe(win.id);
        expect(typeof payload.secondsFromDraft).toBe('number');

        const row = await prisma.weeklyDigest.findUnique({ where: { id: digest.id } });
        expect(row?.confirmedCount).toBe(1);
        expect(row?.firstActionAt).not.toBeNull();
    });
});

// ───────────────────────────────────────────────────────────── single use

describe('single use', () => {
    test('a replay renders the already-done page and writes nothing new', async () => {
        const userId = newUser('replay');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        const raw = token(digest.token, win.id, 'confirm');

        const first = await resolveWinToken(raw);
        if (!first.ok) throw new Error('resolve failed');
        expect((await applyDigestAction(first.resolved, { surface: 'email' })).outcome).toBe('applied');

        // Exactly what a mail-client prefetch or a second tap produces.
        const second = await resolveWinToken(raw);
        if (!second.ok) throw new Error('resolve failed');
        const replay = await applyDigestAction(second.resolved, { surface: 'email' });
        expect(replay.outcome).toBe('already_done');
        // Never an error: the page must show the result, not a failure.
        expect(replay.outcome).not.toBe('failed');

        expect(await prisma.funnelEvent.count({ where: { userId, type: 'digest_action' } })).toBe(1);
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: win.id } })).toBe(1);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(1);
        const row = await prisma.weeklyDigest.findUnique({ where: { id: digest.id } });
        expect(row?.confirmedCount).toBe(1);
    });

    test('two simultaneous taps produce one confirm, one Evidence row', async () => {
        const userId = newUser('race');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        const raw = token(digest.token, win.id, 'confirm');

        const [a, b] = await Promise.all([resolveWinToken(raw), resolveWinToken(raw)]);
        if (!a.ok || !b.ok) throw new Error('resolve failed');
        const outcomes = await Promise.all([
            applyDigestAction(a.resolved, { surface: 'email' }),
            applyDigestAction(b.resolved, { surface: 'email' }),
        ]);

        expect(outcomes.filter((o) => o.outcome === 'applied')).toHaveLength(1);
        expect(outcomes.filter((o) => o.outcome === 'already_done')).toHaveLength(1);
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: win.id } })).toBe(1);
    });

    test('a confirm token cannot also dismiss — the actions are separately scoped', async () => {
        const userId = newUser('one-action');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const confirmed = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!confirmed.ok) throw new Error('resolve failed');
        await applyDigestAction(confirmed.resolved, { surface: 'email' });

        // The dismiss token is a different token; the confirm one is spent and
        // has no way to express "dismiss".
        expect(await findConsumption({ digestId: digest.id, winId: win.id, action: 'dismiss' })).toBeNull();
        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.confirmed);
    });

    test('the token reaches exactly one Win out of five in the same digest', async () => {
        const userId = newUser('one-win');
        const wins = await Promise.all(
            Array.from({ length: 5 }, (_, i) => makeWin({ userId, title: `Win ${i}` })),
        );
        const digest = await makeDigest({ userId, winIds: wins.map((w) => w.id) });

        const resolved = await resolveWinToken(token(digest.token, wins[2].id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        const statuses = await prisma.win.findMany({
            where: { userId },
            select: { id: true, status: true },
        });
        const confirmed = statuses.filter((w) => w.status === WinStatus.confirmed);
        expect(confirmed.map((w) => w.id)).toEqual([wins[2].id]);
    });
});

// ───────────────────────────────────────────────────────────── dismiss

describe('dismiss', () => {
    test('marks the Win dismissed and leaves no grounded claim behind', async () => {
        const userId = newUser('dismiss');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'dismiss'));
        if (!resolved.ok) throw new Error('resolve failed');
        expect((await applyDigestAction(resolved.resolved, { surface: 'email' })).outcome).toBe('applied');

        const after = await prisma.win.findUnique({ where: { id: win.id } });
        expect(after?.status).toBe(WinStatus.dismissed);
        expect(after?.dismissedReason).toBe('not_a_win');
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: win.id } })).toBe(0);
    });

    test('replays cleanly', async () => {
        const userId = newUser('dismiss-replay');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        const raw = token(digest.token, win.id, 'dismiss');

        for (const expected of ['applied', 'already_done'] as const) {
            const resolved = await resolveWinToken(raw);
            if (!resolved.ok) throw new Error('resolve failed');
            expect((await applyDigestAction(resolved.resolved, { surface: 'email' })).outcome).toBe(expected);
        }
        expect(await prisma.funnelEvent.count({ where: { userId, type: 'digest_action' } })).toBe(1);
    });
});

// ───────────────────────────────────────────────────────────── edit

describe('edit', () => {
    test('writes nothing at all — it is a signed deep link, not an action', async () => {
        const userId = newUser('edit');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'edit'));
        if (!resolved.ok) throw new Error('resolve failed');
        const outcome = await applyDigestAction(resolved.resolved, { surface: 'email' });

        expect(outcome.outcome).toBe('navigate');
        const after = await prisma.win.findUnique({ where: { id: win.id } });
        expect(after?.status).toBe(WinStatus.draft);
        expect(after?.title).toBe(win.title);
        expect(await prisma.funnelEvent.count({ where: { userId, type: 'digest_action' } })).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────── blast radius

describe('blast radius', () => {
    test('a token cannot edit content — only status changes', async () => {
        const userId = newUser('no-edit');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        const after = await prisma.win.findUnique({ where: { id: win.id } });
        expect(after?.title).toBe(win.title);
        expect(after?.narrative).toBe(win.narrative);
        expect(after?.sensitivity).toBe(win.sensitivity);
        expect(after?.occurredAt.toISOString()).toBe(win.occurredAt.toISOString());
        expect(after?.category).toBe(win.category);
    });

    test('resolving exposes one Win, never the log', async () => {
        const userId = newUser('no-read');
        const target = await makeWin({ userId, title: 'The one in the digest' });
        await makeWin({ userId, title: 'A confidential one' });
        await makeWin({ userId, title: 'Another private one' });
        const digest = await makeDigest({ userId, winIds: [target.id] });

        const resolved = await resolveWinToken(token(digest.token, target.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');

        // The resolved shape is the entire read surface of the magic link.
        expect(Object.keys(resolved.resolved.win).sort()).toEqual([
            'createdAt',
            'id',
            'narrative',
            'status',
            'title',
        ]);
        expect(resolved.resolved.digest.winIds).toEqual([target.id]);
    });

    test('a token authenticates nothing — the same digest cannot be reused as a session', async () => {
        const userId = newUser('no-session');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        // Nothing in the token path issues a Clerk session, an extension bearer
        // token, or a channel link. Assert the absence rather than assume it.
        expect(await prisma.extensionAccessToken.count({ where: { userId } })).toBe(0);
        expect(await prisma.channelLinkToken.count({ where: { userId } })).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────── undo

describe('undo', () => {
    test('reverses a confirm, removing the Evidence and the ClaimLink', async () => {
        const userId = newUser('undo');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        const raw = token(digest.token, win.id, 'confirm');

        const resolved = await resolveWinToken(raw);
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });

        const undone = await undoDigestAction(resolved.resolved);
        expect(undone.outcome).toBe('undone');

        const after = await prisma.win.findUnique({ where: { id: win.id } });
        expect(after?.status).toBe(WinStatus.draft);
        expect(after?.confirmedAt).toBeNull();
        expect(await prisma.claimLink.count({ where: { userId, claimRefId: win.id } })).toBe(0);
        expect(await prisma.evidence.count({ where: { userId } })).toBe(0);

        const view = await getWinView(userId, win.id);
        expect(view.success && view.data.groundState).toBe('unsupported');
    });

    test('a refresh after an undo does not redo the action', async () => {
        const userId = newUser('undo-refresh');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });
        const raw = token(digest.token, win.id, 'confirm');

        const first = await resolveWinToken(raw);
        if (!first.ok) throw new Error('resolve failed');
        await applyDigestAction(first.resolved, { surface: 'email' });
        await undoDigestAction(first.resolved);

        // The user hits reload on /w/<token>.
        const again = await resolveWinToken(raw);
        if (!again.ok) throw new Error('resolve failed');
        const outcome = await applyDigestAction(again.resolved, { surface: 'email' });

        expect(outcome.outcome).toBe('undone');
        const after = await prisma.win.findUnique({ where: { id: win.id }, select: { status: true } });
        expect(after?.status).toBe(WinStatus.draft);
    });

    test('undo is idempotent and keeps the record that the tap happened', async () => {
        const userId = newUser('undo-twice');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        await applyDigestAction(resolved.resolved, { surface: 'email' });
        await undoDigestAction(resolved.resolved);
        expect((await undoDigestAction(resolved.resolved)).outcome).toBe('undone');

        const state = await readActionState({ digestId: digest.id, winId: win.id, action: 'confirm' });
        expect(state).toEqual({ consumed: true, undone: true });
        const row = await prisma.weeklyDigest.findUnique({ where: { id: digest.id } });
        expect(row?.confirmedCount).toBe(0);
    });

    test('there is nothing to undo before the action happens', async () => {
        const userId = newUser('undo-nothing');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        const resolved = await resolveWinToken(token(digest.token, win.id, 'confirm'));
        if (!resolved.ok) throw new Error('resolve failed');
        expect((await undoDigestAction(resolved.resolved)).outcome).toBe('nothing_to_undo');
    });
});

// ───────────────────────────────────────────────── telegram target resolution

describe('resolveDigestTarget (telegram)', () => {
    test('resolves by index and only for the digest owner', async () => {
        const owner = newUser('tg-owner');
        const stranger = newUser('tg-stranger');
        const wins = await Promise.all([makeWin({ userId: owner }), makeWin({ userId: owner, title: 'Second' })]);
        const digest = await makeDigest({ userId: owner, winIds: wins.map((w) => w.id) });

        const mine = await resolveDigestTarget({
            digestId: digest.id,
            winIndex: 1,
            userId: owner,
            action: 'confirm',
        });
        expect(mine.ok && mine.resolved.win.id).toBe(wins[1].id);

        const theirs = await resolveDigestTarget({
            digestId: digest.id,
            winIndex: 1,
            userId: stranger,
            action: 'confirm',
        });
        expect(theirs).toEqual({ ok: false, reason: 'unknown_digest' });
    });

    test('an index past the end reaches nothing', async () => {
        const userId = newUser('tg-oob');
        const win = await makeWin({ userId });
        const digest = await makeDigest({ userId, winIds: [win.id] });

        expect(
            await resolveDigestTarget({ digestId: digest.id, winIndex: 9, userId, action: 'confirm' }),
        ).toEqual({ ok: false, reason: 'out_of_scope' });
    });
});
