/**
 * Magic-link action tokens — PRD 01 §9.3.
 *
 * This is the ONLY unauthenticated write path in the product, so the whole of
 * it lives in one file you can read in a sitting.
 *
 * ── The threat model ──────────────────────────────────────────────────────
 * A token travels through the user's inbox, their mail provider's link
 * scanner, and whatever proxy sits in front of it. Assume it leaks. What a
 * leaked token must be able to do is bounded to exactly this:
 *
 *   confirm ONE Win, or dismiss ONE Win, or open the edit page for ONE Win.
 *
 * It cannot list the log, read any other Win, mutate any field's content,
 * change preferences, or mint a session. Every one of those is asserted in
 * `winTokens.test.ts`.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 *   token     = base64url(`${root}~${winId}~${actionCode}`) + "." + signature
 *   signature = base64url(HMAC-SHA256(secret, `${root}:${winId}:${action}`))
 *
 * `root` is `WeeklyDigest.token`: a unique, unguessable 22-char handle for one
 * digest. It stands in for `digestId` in the signed string (1:1 with it) so a
 * token can be verified with zero database reads — signature first, DB second.
 *
 * ── Expiry ────────────────────────────────────────────────────────────────
 * 30 days, and NOT carried in the token. It is derived server-side from
 * `WeeklyDigest.createdAt`, which means there is no expiry field for an
 * attacker to tamper with and no reason to sign one.
 *
 * ── Single use ────────────────────────────────────────────────────────────
 * Consumption is recorded as a `digest_action` FunnelEvent keyed by
 * (digestId, winId, action) — the same row PRD 01 §11 already requires, doing
 * double duty as the ledger. Replay finds the record and renders the
 * already-done page. It never errors: a user who taps twice, or whose mail
 * client prefetches the link, must not see a failure.
 *
 * TODO(schema): the ledger wants to be its own table (or a `usedTokens Json`
 * column on `WeeklyDigest`) with a unique constraint, which would make replay
 * protection a database guarantee rather than a read-then-write. It is a
 * FunnelEvent today only because `prisma/schema.prisma` is orchestrator-owned.
 * Everything that knows about the storage choice is {@link findConsumption}
 * and {@link recordConsumption}; swapping it is a two-function change.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, WinStatus, type Channel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import * as winGraph from '@/services/winGraph';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PRD 01 §9.3 — people read email late; 7 days breaks the flow. */
export const WIN_TOKEN_TTL_DAYS = 30;
export const WIN_TOKEN_TTL_MS = WIN_TOKEN_TTL_DAYS * 86_400_000;

/** Bytes of randomness behind `WeeklyDigest.token`. 128 bits, 22 base64url chars. */
const DIGEST_ROOT_BYTES = 16;

/** Ceiling on what we will even attempt to parse. A 4KB "token" is an attack. */
export const MAX_TOKEN_LENGTH = 512;

export const DIGEST_ACTION_EVENT = 'digest_action' as const;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const DIGEST_ACTIONS = ['confirm', 'dismiss', 'edit'] as const;
export type DigestAction = (typeof DIGEST_ACTIONS)[number];

/** Single letters, because the token rides in a URL that has to stay tappable. */
const CODE_BY_ACTION: Record<DigestAction, string> = { confirm: 'c', dismiss: 'd', edit: 'e' };
const ACTION_BY_CODE: Record<string, DigestAction> = { c: 'confirm', d: 'dismiss', e: 'edit' };

export function isDigestAction(value: unknown): value is DigestAction {
    return typeof value === 'string' && (DIGEST_ACTIONS as readonly string[]).includes(value);
}

/** `edit` navigates; only these two write. Used to keep the write surface honest. */
export function isWritingAction(action: DigestAction): action is 'confirm' | 'dismiss' {
    return action === 'confirm' || action === 'dismiss';
}

// ---------------------------------------------------------------------------
// Secret
// ---------------------------------------------------------------------------

/**
 * Fails closed. An unset secret must not degrade to "sign with empty string" —
 * that would make every token forgeable by anyone who reads this file.
 */
export function getTokenSecret(raw: string | undefined = process.env.WIN_MAGIC_LINK_SECRET): string | null {
    const secret = raw?.trim();
    return secret ? secret : null;
}

export function tokensConfigured(): boolean {
    return getTokenSecret() !== null;
}

// ---------------------------------------------------------------------------
// Mint / verify — pure
// ---------------------------------------------------------------------------

export type TokenPayload = { root: string; winId: string; action: DigestAction };

/** The exact string that gets signed. One function so mint and verify cannot drift. */
export function canonicalString(payload: TokenPayload): string {
    return `${payload.root}:${payload.winId}:${payload.action}`;
}

function sign(payload: TokenPayload, secret: string): string {
    return createHmac('sha256', secret).update(canonicalString(payload)).digest('base64url');
}

/** 128 bits of url-safe randomness for `WeeklyDigest.token`. */
export function createDigestRoot(): string {
    return randomBytes(DIGEST_ROOT_BYTES).toString('base64url');
}

/**
 * `null` when the secret is not configured — the caller must then not send an
 * email whose buttons would all be dead links.
 */
export function mintWinToken(payload: TokenPayload, secret = getTokenSecret()): string | null {
    if (!secret) return null;
    if (!isDigestAction(payload.action)) return null;
    if (!payload.root || !payload.winId) return null;
    if (payload.root.includes('~') || payload.winId.includes('~')) return null;

    const body = Buffer.from(
        `${payload.root}~${payload.winId}~${CODE_BY_ACTION[payload.action]}`,
        'utf8',
    ).toString('base64url');
    return `${body}.${sign(payload, secret)}`;
}

export function buildActionUrl(token: string, appUrl: string): string {
    return `${appUrl.replace(/\/+$/, '')}/w/${encodeURIComponent(token)}`;
}

/** Constant-time within length; length mismatch short-circuits without a timing edge. */
function signatureMatches(expected: string, provided: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length) {
        timingSafeEqual(a, a);
        return false;
    }
    return timingSafeEqual(a, b);
}

/**
 * Signature verification. Pure, no database, no clock.
 *
 * Returns `null` for every rejection — malformed, tampered, wrong secret, wrong
 * action — deliberately without distinguishing them, so the failure mode is not
 * an oracle for how the token is built.
 */
export function verifyWinToken(token: string, secret = getTokenSecret()): TokenPayload | null {
    if (!secret) return null;
    const raw = String(token ?? '');
    if (!raw || raw.length > MAX_TOKEN_LENGTH) return null;

    const dot = raw.indexOf('.');
    if (dot <= 0 || dot === raw.length - 1) return null;
    const body = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    if (body.includes('.') || signature.includes('.')) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;

    let decoded: string;
    try {
        decoded = Buffer.from(body, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    const parts = decoded.split('~');
    if (parts.length !== 3) return null;
    const [root, winId, code] = parts;
    const action = ACTION_BY_CODE[code];
    if (!root || !winId || !action) return null;

    const payload: TokenPayload = { root, winId, action };
    if (!signatureMatches(sign(payload, secret), signature)) return null;
    return payload;
}

// ---------------------------------------------------------------------------
// Expiry — pure
// ---------------------------------------------------------------------------

export function tokenExpiresAt(digestCreatedAt: Date): Date {
    return new Date(digestCreatedAt.getTime() + WIN_TOKEN_TTL_MS);
}

export function isTokenExpired(digestCreatedAt: Date, now: Date = new Date()): boolean {
    return now.getTime() >= tokenExpiresAt(digestCreatedAt).getTime();
}

// ---------------------------------------------------------------------------
// Resolution — signature, then database
// ---------------------------------------------------------------------------

export type ResolveFailureReason =
    | 'not_configured'
    | 'invalid'
    | 'unknown_digest'
    | 'expired'
    | 'out_of_scope'
    | 'win_missing';

export type ResolvedToken = {
    payload: TokenPayload;
    digest: {
        id: string;
        userId: string;
        channel: Channel;
        createdAt: Date;
        winIds: string[];
    };
    win: {
        id: string;
        title: string;
        narrative: string;
        status: WinStatus;
        createdAt: Date;
    };
};

export type ResolveResult =
    | { ok: true; resolved: ResolvedToken }
    | { ok: false; reason: ResolveFailureReason };

export function readWinIds(value: Prisma.JsonValue | null | undefined): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Signature first, database second, scope last.
 *
 * The scope check (`winId ∈ digest.winIds` AND the Win belongs to the digest's
 * user) is what makes "one Win and nothing else" true even if the HMAC were
 * somehow forged: a valid signature over a Win that was not in this digest is
 * still rejected.
 */
export async function resolveWinToken(token: string, now: Date = new Date()): Promise<ResolveResult> {
    const secret = getTokenSecret();
    if (!secret) return { ok: false, reason: 'not_configured' };

    const payload = verifyWinToken(token, secret);
    if (!payload) return { ok: false, reason: 'invalid' };

    const digest = await prisma.weeklyDigest.findUnique({
        where: { token: payload.root },
        select: { id: true, userId: true, channel: true, createdAt: true, winIds: true },
    });
    if (!digest) return { ok: false, reason: 'unknown_digest' };

    if (isTokenExpired(digest.createdAt, now)) return { ok: false, reason: 'expired' };

    const winIds = readWinIds(digest.winIds);
    if (!winIds.includes(payload.winId)) return { ok: false, reason: 'out_of_scope' };

    // `userId` in the WHERE, not just the SELECT: a Win id that leaked from a
    // different account must not resolve, even if it were listed in winIds.
    const win = await prisma.win.findFirst({
        where: { id: payload.winId, userId: digest.userId },
        select: { id: true, title: true, narrative: true, status: true, createdAt: true },
    });
    if (!win) return { ok: false, reason: 'win_missing' };

    return { ok: true, resolved: { payload, digest: { ...digest, winIds }, win } };
}

/**
 * The Telegram equivalent of {@link resolveWinToken}.
 *
 * There is no HMAC here, and that is the correct trade: Telegram caps
 * `callback_data` at 64 bytes, so a signed token would not fit, and putting a
 * long-lived credential into a chat payload would be worse than not having one.
 * Authorisation instead comes from the caller, which must have matched the chat
 * to a **verified** `ChannelIdentity` first and pass the resulting `userId`.
 * This function then re-checks that the digest belongs to that user, so a
 * spoofed `digestId` in a callback reaches nothing.
 *
 * The `winIndex` is a position in `winIds`, which is what makes the callback
 * inherently in-scope: there is no way to name a Win the digest did not carry.
 */
export async function resolveDigestTarget(input: {
    digestId: string;
    winIndex: number;
    userId: string;
    action: DigestAction;
}): Promise<ResolveResult> {
    const digest = await prisma.weeklyDigest.findFirst({
        where: { id: input.digestId, userId: input.userId },
        select: { id: true, userId: true, channel: true, createdAt: true, winIds: true, token: true },
    });
    if (!digest) return { ok: false, reason: 'unknown_digest' };
    if (isTokenExpired(digest.createdAt)) return { ok: false, reason: 'expired' };

    const winIds = readWinIds(digest.winIds);
    const winId = winIds[input.winIndex];
    if (!winId) return { ok: false, reason: 'out_of_scope' };

    const win = await prisma.win.findFirst({
        where: { id: winId, userId: digest.userId },
        select: { id: true, title: true, narrative: true, status: true, createdAt: true },
    });
    if (!win) return { ok: false, reason: 'win_missing' };

    return {
        ok: true,
        resolved: {
            payload: { root: digest.token, winId, action: input.action },
            digest: {
                id: digest.id,
                userId: digest.userId,
                channel: digest.channel,
                createdAt: digest.createdAt,
                winIds,
            },
            win,
        },
    };
}

// ---------------------------------------------------------------------------
// Consumption ledger
// ---------------------------------------------------------------------------

type ConsumptionKey = { digestId: string; winId: string; action: DigestAction };

/** Recorded as its own event so an undo never erases the fact that the tap happened. */
export const UNDO_MARKER = 'undo';

function consumptionWhere(key: ConsumptionKey, undone = false): Prisma.FunnelEventWhereInput {
    return {
        type: DIGEST_ACTION_EVENT,
        AND: [
            { payload: { path: ['digestId'], equals: key.digestId } },
            { payload: { path: ['winId'], equals: key.winId } },
            undone
                ? { payload: { path: ['undoneAction'], equals: key.action } }
                : { payload: { path: ['action'], equals: key.action } },
        ],
    };
}

export async function findConsumption(key: ConsumptionKey): Promise<{ occurredAt: Date } | null> {
    return prisma.funnelEvent.findFirst({
        where: consumptionWhere(key),
        select: { occurredAt: true },
        orderBy: { occurredAt: 'asc' },
    });
}

export async function findUndo(key: ConsumptionKey): Promise<{ occurredAt: Date } | null> {
    return prisma.funnelEvent.findFirst({
        where: consumptionWhere(key, true),
        select: { occurredAt: true },
        orderBy: { occurredAt: 'asc' },
    });
}

/**
 * What has already happened to this (digest, win, action) triple.
 *
 * The landing page reads this BEFORE applying anything, which is what makes a
 * browser refresh after an undo idempotent: the ledger row survives the undo,
 * so the refresh re-renders the undone state instead of re-doing the action.
 */
export async function readActionState(key: ConsumptionKey): Promise<{ consumed: boolean; undone: boolean }> {
    const [consumed, undone] = await Promise.all([findConsumption(key), findUndo(key)]);
    return { consumed: consumed !== null, undone: undone !== null };
}

/**
 * Awaited on purpose, unlike `track()`. This row IS the replay guard, so a
 * write failure has to surface rather than be swallowed.
 */
export async function recordConsumption(input: {
    userId: string;
    digestId: string;
    winId: string;
    action: DigestAction;
    channel: Channel;
    surface: 'email' | 'telegram';
    secondsFromDraft: number;
}): Promise<void> {
    await prisma.funnelEvent.create({
        data: {
            sessionId: 'server',
            userId: input.userId,
            type: DIGEST_ACTION_EVENT,
            payload: {
                feature: 'work_log',
                digestId: input.digestId,
                winId: input.winId,
                action: input.action,
                channel: input.channel,
                surface: input.surface,
                secondsFromDraft: input.secondsFromDraft,
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Applying an action
// ---------------------------------------------------------------------------

type WinSummary = { id: string; title: string; status: WinStatus };

export type ApplyOutcome =
    /** This request performed the write. */
    | { outcome: 'applied'; action: DigestAction; win: WinSummary }
    /** A replay, a double-tap, or the user already did it in the app. */
    | { outcome: 'already_done'; action: DigestAction; win: WinSummary }
    /** Done once, then undone. A refresh lands here and writes nothing. */
    | { outcome: 'undone'; action: DigestAction; win: WinSummary }
    /** `edit` — no write at all, the page just links into the app. */
    | { outcome: 'navigate'; action: 'edit'; win: WinSummary }
    | { outcome: 'failed'; action: DigestAction; error: string };

/**
 * Perform the token's one action.
 *
 * Concurrency: `confirm` claims the Win with a conditional `updateMany` that
 * restates `status = draft` — the codebase's one race idiom (see
 * `src/lib/entitlements.ts:226`). Postgres re-evaluates the predicate after the
 * row lock releases, so exactly one of two simultaneous taps gets `count === 1`
 * and the other reads as a replay.
 *
 * Crash window: if the process dies between winning the claim and writing the
 * Evidence/ClaimLink pair, the Win is confirmed but ungrounded — which would
 * break CLAUDE.md rule 5. A later replay repairs it: `status !== draft` with no
 * ledger row means the graph write never completed, so we re-run it.
 * `winGraph.confirmWin` dedupes evidence by artifact key, so the repair is safe.
 */
export async function applyDigestAction(
    resolved: ResolvedToken,
    options: { surface: 'email' | 'telegram'; now?: Date },
): Promise<ApplyOutcome> {
    const now = options.now ?? new Date();
    const { payload, digest, win } = resolved;
    const action = payload.action;

    if (action === 'edit') {
        return { outcome: 'navigate', action: 'edit', win: { id: win.id, title: win.title, status: win.status } };
    }

    const key = { digestId: digest.id, winId: win.id, action };
    const state = await readActionState(key);

    // Already done and then undone: the user's last instruction was "no". A
    // refresh must not overturn it.
    if (state.undone) {
        return { outcome: 'undone', action, win: { id: win.id, title: win.title, status: win.status } };
    }
    const consumed = state.consumed ? { occurredAt: new Date(0) } : null;

    try {
        if (action === 'confirm') {
            const claim = await prisma.win.updateMany({
                where: { id: win.id, userId: digest.userId, status: WinStatus.draft },
                data: { status: WinStatus.confirmed, confirmedAt: now },
            });
            const wonClaim = claim.count === 1;

            // Repair path: confirmed-but-unrecorded means the graph write was
            // interrupted. Anything else with a ledger row is a plain replay.
            const needsGraphWrite = wonClaim || !consumed;
            if (needsGraphWrite) {
                const result = await winGraph.confirmWin({ userId: digest.userId, winId: win.id, now });
                if (!result.success) return { outcome: 'failed', action, error: result.error };
            }

            if (wonClaim || !consumed) {
                await recordConsumption({
                    userId: digest.userId,
                    digestId: digest.id,
                    winId: win.id,
                    action,
                    channel: digest.channel,
                    surface: options.surface,
                    secondsFromDraft: Math.max(0, Math.round((now.getTime() - win.createdAt.getTime()) / 1000)),
                });
                await bumpDigestCounters(digest.id, action, now);
            }

            return {
                outcome: wonClaim ? 'applied' : 'already_done',
                action,
                win: { id: win.id, title: win.title, status: WinStatus.confirmed },
            };
        }

        // Dismiss. `winGraph.dismissWin` is naturally idempotent — it reverses a
        // prior confirm first, then writes the terminal state — so it needs no
        // claim, only the ledger to decide what the page should say.
        const alreadyDismissed = win.status === WinStatus.dismissed && consumed !== null;
        if (!alreadyDismissed) {
            const result = await winGraph.dismissWin({
                userId: digest.userId,
                winId: win.id,
                reason: 'not_a_win',
            });
            if (!result.success) return { outcome: 'failed', action, error: result.error };
        }

        if (!consumed) {
            await recordConsumption({
                userId: digest.userId,
                digestId: digest.id,
                winId: win.id,
                action,
                channel: digest.channel,
                surface: options.surface,
                secondsFromDraft: Math.max(0, Math.round((now.getTime() - win.createdAt.getTime()) / 1000)),
            });
            await bumpDigestCounters(digest.id, action, now);
        }

        return {
            outcome: consumed ? 'already_done' : 'applied',
            action,
            win: { id: win.id, title: win.title, status: WinStatus.dismissed },
        };
    } catch (error: unknown) {
        console.error('[winTokens] action failed', {
            digestId: digest.id,
            action,
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return { outcome: 'failed', action, error: 'Could not apply that action' };
    }
}

/** Digest-level funnel counters. Best effort: they are analytics, not state. */
async function bumpDigestCounters(digestId: string, action: DigestAction, now: Date): Promise<void> {
    try {
        await prisma.weeklyDigest.update({
            where: { id: digestId },
            data:
                action === 'confirm'
                    ? { confirmedCount: { increment: 1 } }
                    : { dismissedCount: { increment: 1 } },
        });
        // `firstActionAt` is only ever written once; a conditional update keeps
        // "time to first action" meaningful instead of "time to last action".
        await prisma.weeklyDigest.updateMany({
            where: { id: digestId, firstActionAt: null },
            data: { firstActionAt: now },
        });
    } catch (error: unknown) {
        console.warn('[winTokens] digest counter update failed', {
            digestId,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}

// ---------------------------------------------------------------------------
// Undo — §K4 "Was this you? [undo]"
// ---------------------------------------------------------------------------

export type UndoOutcome =
    | { outcome: 'undone'; status: WinStatus }
    | { outcome: 'nothing_to_undo' }
    | { outcome: 'failed'; error: string };

/**
 * Reverses this token's own action and only that. Scope is unchanged: the undo
 * form carries the same token, so a leaked token still reaches exactly one Win.
 *
 * The consumption row is NOT deleted — the tap happened and the funnel should
 * keep saying so. A second `digest_action` row with `action: 'undo'` marks the
 * reversal, which is also what makes a page refresh after an undo a no-op
 * instead of a redo.
 */
export async function undoDigestAction(resolved: ResolvedToken): Promise<UndoOutcome> {
    const { payload, digest, win } = resolved;
    if (!isWritingAction(payload.action)) return { outcome: 'nothing_to_undo' };

    const key = { digestId: digest.id, winId: win.id, action: payload.action };

    try {
        if (await findUndo(key)) return { outcome: 'undone', status: WinStatus.draft };
        if (!(await findConsumption(key))) return { outcome: 'nothing_to_undo' };

        const current = await prisma.win.findFirst({
            where: { id: win.id, userId: digest.userId },
            select: { status: true },
        });
        if (!current) return { outcome: 'nothing_to_undo' };

        if (payload.action === 'confirm') {
            if (current.status === WinStatus.confirmed) {
                const reversed = await winGraph.unconfirmWin({ userId: digest.userId, winId: win.id });
                if (!reversed.success) return { outcome: 'failed', error: reversed.error };
            }
        } else if (current.status === WinStatus.dismissed) {
            await prisma.win.updateMany({
                where: { id: win.id, userId: digest.userId, status: WinStatus.dismissed },
                data: { status: WinStatus.draft, dismissedReason: null },
            });
        }

        await prisma.funnelEvent.create({
            data: {
                sessionId: 'server',
                userId: digest.userId,
                type: DIGEST_ACTION_EVENT,
                payload: {
                    feature: 'work_log',
                    digestId: digest.id,
                    winId: win.id,
                    action: UNDO_MARKER,
                    undoneAction: payload.action,
                },
            },
        });

        await prisma.weeklyDigest.updateMany({
            where: { id: digest.id },
            data:
                payload.action === 'confirm'
                    ? { confirmedCount: { decrement: 1 } }
                    : { dismissedCount: { decrement: 1 } },
        });

        return { outcome: 'undone', status: WinStatus.draft };
    } catch (error: unknown) {
        console.error('[winTokens] undo failed', {
            digestId: digest.id,
            error: error instanceof Error ? error.message : 'unknown error',
        });
        return { outcome: 'failed', error: 'Could not undo that' };
    }
}
