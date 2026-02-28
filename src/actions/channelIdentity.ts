'use server';

import { randomBytes } from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { Channel, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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
  } catch (error) {
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
  } catch (error) {
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
      return { success: false, error: 'Invalid or expired link token' };
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
        throw new Error('This Telegram account is already linked to another user');
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to consume link token',
    };
  }
}
