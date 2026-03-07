import { NextRequest, NextResponse } from 'next/server';
import { processTelegramUpdate, TelegramUpdateSchema } from '@/services/telegramAgent';

function verifyInternalSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_INTERNAL_SECRET?.trim()
    || process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  if (!expected) return false;
  return Boolean(headerValue && headerValue === expected);
}

export async function POST(req: NextRequest) {
  try {
    const internalSecret = req.headers.get('x-telegram-internal-secret');
    if (!verifyInternalSecret(internalSecret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const raw = await req.json().catch(() => ({}));
    const updateCandidate = raw && typeof raw === 'object' && 'update' in raw
      ? (raw as { update: unknown }).update
      : raw;

    const parsed = TelegramUpdateSchema.safeParse(updateCandidate);
    if (!parsed.success) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    void processTelegramUpdate(parsed.data).catch((error: unknown) => {
      console.error('Async Telegram processing failed:', error);
    });

    return NextResponse.json({ ok: true, accepted: true });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to process Telegram update',
      },
      { status: 500 }
    );
  }
}
