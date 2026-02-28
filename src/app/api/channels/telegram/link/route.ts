import { NextResponse } from 'next/server';
import { createTelegramLinkToken, listChannelIdentities } from '@/actions/channelIdentity';

export async function GET() {
  const identities = await listChannelIdentities();
  if (!identities.success) {
    const status = identities.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(identities, { status });
  }

  const telegramIdentity = identities.identities?.find((entry) => entry.channel === 'telegram');
  return NextResponse.json({
    success: true,
    linked: Boolean(telegramIdentity?.verified),
    identity: telegramIdentity ?? null,
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
