/**
 * NOT a server action module (no `'use server'`): every importer is server
 * code, and as a server action its exports were public endpoints, several of
 * them taking a caller-supplied user id. Removed 2026-09-26.
 */
import { randomBytes } from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { Channel, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { accountLabel } from '@/lib/channels/accountLabel';

/**
 * A chat already linked to a DIFFERENT Patronus account. Carried as a code
 * with the other user id, so the bot can name the account (masked) instead of
 * the old "Your account is already linked", which hid the conflict: the chat
 * kept filing everything into the other account and nothing said so.
 */
class LinkConflictError extends Error {
  constructor(readonly otherUserId: string, channel: Channel) {
    super(channel === Channel.whatsapp
      ? 'This WhatsApp number is already linked to another Patronus account'
      : 'This Telegram account is already linked to another Patronus account');
    this.name = 'LinkConflictError';
  }
}

type ChannelIdentityDTO = {
  id: string;
  userId: string;
  channel: Channel;
  externalId: string;
  verified: boolean;
  createdAt: Date;
};

const ConsumeLinkTokenSchema = z.object({
  channel: z.nativeEnum(Channel),
  token: z.string().min(8).max(256),
  externalId: z.string().min(1).max(256),
});

function buildToken(): string {
  return randomBytes(16).toString('hex');
}

function getTelegramDeepLink(token: string): string | null {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim();
  if (!botUsername) return null;

  return `https://t.me/${botUsername}?start=link_${token}`;
}

export async function createTelegramLinkToken(): Promise<{
  success: boolean;
  token?: string;
  expiresAt?: string;
  deepLink?: string | null;
  error?: string;
}> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const token = buildToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.channelLinkToken.create({
      data: {
        userId,
        channel: Channel.telegram,
        token,
        expiresAt,
      },
    });

    return {
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
      deepLink: getTelegramDeepLink(token),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create link token',
    };
  }
}

/**
 * WhatsApp linking: the same 15-minute `ChannelLinkToken`, delivered as a
 * click-to-chat link that pre-fills "link <token>". The inbound handler
 * (`src/lib/channels/whatsappAgent.ts`) consumes it with the sender's wa_id.
 */
export async function createWhatsAppLinkToken(): Promise<{
  success: boolean;
  token?: string;
  expiresAt?: string;
  deepLink?: string | null;
  error?: string;
}> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const { readWhatsAppConfig, whatsAppLinkDeepLink } = await import('@/lib/whatsapp');
    const whatsapp = readWhatsAppConfig();
    if (!whatsapp) return { success: false, error: 'WhatsApp is not configured' };

    const token = buildToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.channelLinkToken.create({
      data: {
        userId,
        channel: Channel.whatsapp,
        token,
        expiresAt,
      },
    });

    return {
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
      deepLink: whatsAppLinkDeepLink(whatsapp.publicNumber, token),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create link token',
    };
  }
}

export async function listChannelIdentities(): Promise<{
  success: boolean;
  identities?: ChannelIdentityDTO[];
  error?: string;
}> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Not authenticated' };

    const identities = await prisma.channelIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, identities };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list identities',
    };
  }
}

export async function consumeChannelLinkToken(input: unknown): Promise<{
  success: boolean;
  userId?: string;
  identity?: ChannelIdentityDTO;
  error?: string;
  /** `linked_to_other`: the chat belongs to `otherUserId`, not the token's user. */
  code?: 'linked_to_other' | 'invalid_token';
  otherUserId?: string;
}> {
  const parsed = ConsumeLinkTokenSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const { channel, token, externalId } = parsed.data;

  try {
    const now = new Date();

    const tokenRow = await prisma.channelLinkToken.findFirst({
      where: {
        channel,
        token,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tokenRow) {
      return { success: false, error: 'Invalid or expired link token', code: 'invalid_token' };
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingExternal = await tx.channelIdentity.findUnique({
        where: {
          channel_externalId: {
            channel,
            externalId,
          },
        },
      });

      if (existingExternal && existingExternal.userId !== tokenRow.userId) {
        throw new LinkConflictError(existingExternal.userId, channel);
      }

      if (existingExternal && existingExternal.userId === tokenRow.userId) {
        await tx.channelLinkToken.update({
          where: { id: tokenRow.id },
          data: { consumedAt: now },
        });

        return existingExternal;
      }

      await tx.channelIdentity.deleteMany({
        where: {
          userId: tokenRow.userId,
          channel,
        },
      });

      const identity = await tx.channelIdentity.create({
        data: {
          userId: tokenRow.userId,
          channel,
          externalId,
          verified: true,
        },
      });

      await tx.channelLinkToken.update({
        where: { id: tokenRow.id },
        data: { consumedAt: now },
      });

      return identity;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return {
      success: true,
      userId: result.userId,
      identity: result,
    };
  } catch (error: unknown) {
    if (error instanceof LinkConflictError) {
      return { success: false, error: error.message, code: 'linked_to_other', otherUserId: error.otherUserId };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to consume link token',
    };
  }
}

/** Masked "Name · a•••@gmail.com" for a user, from their profile. */
export async function describeAccount(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { fullName: true, email: true },
  });
  return accountLabel(profile);
}

/**
 * Unlink the signed-in user's chat on `channel`. Session-only: the user id
 * comes from Clerk, never from the caller. Idempotent (0 when nothing was
 * linked).
 */
export async function unlinkChannelForSession(channel: Channel): Promise<{ success: boolean; removed?: number; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };
  const { count } = await prisma.channelIdentity.deleteMany({ where: { userId, channel } });
  return { success: true, removed: count };
}

/**
 * Unlink a chat by its external id: the bot's `/unlink`. The caller is the
 * webhook, which Telegram authenticated with the secret header, and the chat
 * id is the one the message came from, so the sender can only unlink itself.
 */
export async function unlinkChatByExternalId(channel: Channel, externalId: string): Promise<{ removed: number; userId: string | null }> {
  const identity = await prisma.channelIdentity.findUnique({
    where: { channel_externalId: { channel, externalId } },
    select: { userId: true },
  });
  if (!identity) return { removed: 0, userId: null };
  const { count } = await prisma.channelIdentity.deleteMany({ where: { channel, externalId } });
  return { removed: count, userId: identity.userId };
}
