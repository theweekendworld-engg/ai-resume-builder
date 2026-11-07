/**
 * The conversation's focus: the one task the user is in the middle of on a
 * channel (docs/impl/07-telegram-apply.md §2).
 *
 * Why it exists: Telegram turns arrived at the router with no memory, so
 * "make it shorter" after a draft was read as a brand-new request, wrote a
 * fresh draft from zero and charged for it again. The focus is the state
 * machine's current node, held in code: what is being worked on, by id. The
 * model is never asked to remember it, and never writes it.
 *
 * Stored on `ChatConversation(userId, channel)`. It expires on its own after
 * FOCUS_TTL_MS, so a message tomorrow is not read as an edit to yesterday's
 * draft. Setting a new focus replaces the old one; there is only ever one.
 */

import { Channel, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

/** How long a follow-up is read against the focused task. */
export const FOCUS_TTL_MS = 2 * 60 * 60_000;

const FocusSchema = z.discriminatedUnion('kind', [
    z.object({
        /** A message draft being revised (MessageDraft.id is the latest version). */
        kind: z.literal('draft'),
        draftId: z.string().min(1),
        runId: z.string().min(1).nullable(),
        workspaceId: z.string().min(1).nullable(),
    }),
    z.object({
        /** A job the user just shared or picked: "tailor it", "draft an email". */
        kind: z.literal('job'),
        runId: z.string().min(1),
        workspaceId: z.string().min(1).nullable(),
    }),
]);

export type ChatFocus = z.infer<typeof FocusSchema>;

export function parseFocus(value: unknown): ChatFocus | null {
    const parsed = FocusSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

export function focusIsLive(focusAt: Date | null, now: Date = new Date()): boolean {
    return focusAt !== null && now.getTime() - focusAt.getTime() < FOCUS_TTL_MS;
}

export async function getFocus(userId: string, channel: Channel, now: Date = new Date()): Promise<ChatFocus | null> {
    const row = await prisma.chatConversation.findUnique({
        where: { userId_channel: { userId, channel } },
        select: { focus: true, focusAt: true },
    });
    if (!row || !focusIsLive(row.focusAt, now)) return null;
    return parseFocus(row.focus);
}

/** Replace the focus, or clear it with null. Creates the conversation row if needed. */
export async function setFocus(userId: string, channel: Channel, focus: ChatFocus | null, now: Date = new Date()): Promise<void> {
    const value = focus ? (FocusSchema.parse(focus) as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    await prisma.chatConversation.upsert({
        where: { userId_channel: { userId, channel } },
        create: { userId, channel, focus: value, focusAt: focus ? now : null },
        update: { focus: value, focusAt: focus ? now : null },
    });
}
