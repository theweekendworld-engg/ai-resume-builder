'use server';

/**
 * Digest server actions — the notification settings surface (design/02 §J2)
 * and the one token-authenticated write in the product.
 *
 * Everything below `undoFromDigestLink` follows impl/00 §P-3 exactly:
 * Clerk auth() -> zod parse -> work -> FunnelEvent -> `Result<T>`.
 *
 * `undoFromDigestLink` deliberately does NOT. It is reached from `/w/[token]`
 * by someone with no session — that is the whole point of the magic link — so
 * its authorisation is the HMAC, and its blast radius is capped by
 * `src/lib/winTokens.ts` to exactly one (win, action) pair. It is in this file
 * rather than in the page so that the unauthenticated surface is a short,
 * greppable list: this function and the `/w/[token]` route.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { Channel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { err, ok, type Result } from '@/lib/result';
import { describeNextDigest, isValidTimeZone } from '@/lib/time';
import { generateUnsubscribeToken } from '@/lib/email/send';
import { checkWinTokenRateLimit } from '@/lib/rateLimit';
import { resolveWinToken, undoDigestAction } from '@/lib/winTokens';

// ---------------------------------------------------------------------------
// Notification settings — design/02 §J2
// ---------------------------------------------------------------------------

export type NotificationSettings = {
    timezone: string;
    digestDay: number;
    digestHour: number;
    digestChannel: 'email' | 'telegram';
    weeklyDigest: boolean;
    monthlyReview: boolean;
    radarDigest: boolean;
    missionNudges: boolean;
    productUpdates: boolean;
    unsubscribedAll: boolean;
    /** "Next digest: Friday, Aug 7 at 4:00 PM" — the live preview line. */
    nextDigestLabel: string;
    /** False when the user has never linked the bot; the Telegram option is then disabled. */
    telegramLinked: boolean;
};

const SettingsPatchSchema = z.object({
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, 'Unknown timezone').optional(),
    digestDay: z.number().int().min(1).max(7).optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
    digestChannel: z.enum(['email', 'telegram']).optional(),
    weeklyDigest: z.boolean().optional(),
    monthlyReview: z.boolean().optional(),
    radarDigest: z.boolean().optional(),
    missionNudges: z.boolean().optional(),
    productUpdates: z.boolean().optional(),
    unsubscribedAll: z.boolean().optional(),
});

export type NotificationSettingsPatch = z.infer<typeof SettingsPatchSchema>;

const SELECT = {
    timezone: true,
    digestDay: true,
    digestHour: true,
    digestChannel: true,
    weeklyDigest: true,
    monthlyReview: true,
    radarDigest: true,
    missionNudges: true,
    productUpdates: true,
    unsubscribedAll: true,
} as const;

type PreferenceRow = {
    timezone: string;
    digestDay: number;
    digestHour: number;
    digestChannel: Channel;
    weeklyDigest: boolean;
    monthlyReview: boolean;
    radarDigest: boolean;
    missionNudges: boolean;
    productUpdates: boolean;
    unsubscribedAll: boolean;
};

function toSettings(row: PreferenceRow, telegramLinked: boolean): NotificationSettings {
    return {
        timezone: row.timezone,
        digestDay: row.digestDay,
        digestHour: row.digestHour,
        digestChannel: row.digestChannel === Channel.telegram ? 'telegram' : 'email',
        weeklyDigest: row.weeklyDigest,
        monthlyReview: row.monthlyReview,
        radarDigest: row.radarDigest,
        missionNudges: row.missionNudges,
        productUpdates: row.productUpdates,
        unsubscribedAll: row.unsubscribedAll,
        nextDigestLabel: describeNextDigest(row),
        telegramLinked,
    };
}

async function loadPreference(userId: string): Promise<PreferenceRow> {
    // Upsert rather than findUnique: the row is created on the first email, and
    // a user can reach this page before any email has gone out.
    return prisma.emailPreference.upsert({
        where: { userId },
        create: { userId, unsubscribeToken: generateUnsubscribeToken() },
        update: {},
        select: SELECT,
    });
}

async function isTelegramLinked(userId: string): Promise<boolean> {
    const identity = await prisma.channelIdentity.findFirst({
        where: { userId, channel: Channel.telegram, verified: true },
        select: { id: true },
    });
    return identity !== null;
}

export async function getNotificationSettings(): Promise<Result<NotificationSettings>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const [row, telegramLinked] = await Promise.all([loadPreference(userId), isTelegramLinked(userId)]);
    return ok(toSettings(row, telegramLinked));
}

export async function updateNotificationSettings(
    patch: NotificationSettingsPatch,
): Promise<Result<NotificationSettings>> {
    const { userId } = await auth();
    if (!userId) return err('Not signed in', 'unauthenticated');

    const parsed = SettingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
        return err(parsed.error.issues.map((issue) => issue.message).join('; '), 'invalid_input');
    }
    if (Object.keys(parsed.data).length === 0) return getNotificationSettings();

    const { digestChannel, ...rest } = parsed.data;

    // Ensure the row exists before the update; `upsert` with a partial patch
    // would need the whole create payload restated.
    await loadPreference(userId);

    const row = await prisma.emailPreference.update({
        where: { userId },
        data: {
            ...rest,
            ...(digestChannel
                ? { digestChannel: digestChannel === 'telegram' ? Channel.telegram : Channel.email }
                : {}),
        },
        select: SELECT,
    });

    // No FunnelEvent here on purpose: PRD 01 §11 does not name a settings
    // event, and `SERVER_EVENTS` is a curated list, not a dumping ground.
    revalidatePath('/settings/notifications');
    return ok(toSettings(row, await isTelegramLinked(userId)));
}

// ---------------------------------------------------------------------------
// The unauthenticated undo — design/02 §K4 "Was this you? [undo]"
// ---------------------------------------------------------------------------

export type UndoResult =
    | { status: 'undone' }
    | { status: 'nothing_to_undo' }
    | { status: 'error'; message: string };

/**
 * Reverses the action the same token just performed. Authorised by the token,
 * not by a session, and scoped by `resolveWinToken` to the single Win that
 * token names — a leaked token gains nothing here it did not already have.
 */
export async function undoFromDigestLink(token: string): Promise<UndoResult> {
    const resolved = await resolveWinToken(String(token ?? ''));
    if (!resolved.ok) return { status: 'error', message: 'That link is no longer valid.' };

    const limit = await checkWinTokenRateLimit(resolved.resolved.payload.root);
    if (!limit.allowed) return { status: 'error', message: limit.error ?? 'Too many requests.' };

    const result = await undoDigestAction(resolved.resolved);
    if (result.outcome === 'failed') return { status: 'error', message: result.error };
    if (result.outcome === 'nothing_to_undo') return { status: 'nothing_to_undo' };
    return { status: 'undone' };
}
