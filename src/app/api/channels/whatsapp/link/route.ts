import { NextResponse } from 'next/server';
import { createWhatsAppLinkToken, listChannelIdentities } from '@/actions/channelIdentity';
import { isWhatsAppConfigured } from '@/lib/whatsapp';

export async function GET() {
  const identities = await listChannelIdentities();
  if (!identities.success) {
    const status = identities.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(identities, { status });
  }

  const whatsappIdentity = identities.identities?.find((entry) => entry.channel === 'whatsapp');
  return NextResponse.json({
    success: true,
    configured: isWhatsAppConfigured(),
    linked: Boolean(whatsappIdentity?.verified),
    identity: whatsappIdentity ?? null,
  });
}

export async function POST() {
  const result = await createWhatsAppLinkToken();
  if (!result.success) {
    const status = result.error === 'Not authenticated' ? 401 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
