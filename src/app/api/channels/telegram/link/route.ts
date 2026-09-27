import { NextResponse } from 'next/server';
import { Channel } from '@prisma/client';
import { auth } from '@clerk/nextjs/server';
import {
  createTelegramLinkToken,
  describeAccount,
  listChannelIdentities,
  unlinkChannelForSession,
} from '@/actions/channelIdentity';
import { channelsAvailable } from '@/lib/channels/availability';

/**
 * Link status for the signed-in user. Also says WHICH Patronus account is
 * signed in, because the same person can hold two accounts under one email,
 * and a chat linked to the other one looked identical from here.
 */
export async function GET() {
  const identities = await listChannelIdentities();
  if (!identities.success) {
    const status = identities.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(identities, { status });
  }

  const { userId } = await auth();
  const telegramIdentity = identities.identities?.find((entry) => entry.channel === 'telegram');
  return NextResponse.json({
    success: true,
    linked: Boolean(telegramIdentity?.verified),
    identity: telegramIdentity ?? null,
    account: userId ? await describeAccount(userId) : null,
    botUsername: channelsAvailable().telegramBotUsername,
  });
}

export async function POST() {
  const result = await createTelegramLinkToken();
  if (!result.success) {
    const status = result.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}

/** Unlink the signed-in user's Telegram chat. Session-only. */
export async function DELETE() {
  const result = await unlinkChannelForSession(Channel.telegram);
  if (!result.success) {
    const status = result.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
