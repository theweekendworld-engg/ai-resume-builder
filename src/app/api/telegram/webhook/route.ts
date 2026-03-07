import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { processTelegramUpdate, TelegramUpdateSchema } from '@/services/telegramAgent';
import { answerTelegramCallbackQuery, verifyTelegramWebhookSecret } from '@/lib/telegram';

function getInternalProcessSecret(): string {
  return process.env.TELEGRAM_INTERNAL_SECRET?.trim()
    || process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    || '';
}

async function dispatchToInternalProcessor(update: unknown): Promise<boolean> {
  const secret = getInternalProcessSecret();
  if (!secret) return false;

  const url = `${config.app.url.replace(/\/$/, '')}/api/telegram/process`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-internal-secret': secret,
      },
      body: JSON.stringify({ update }),
      cache: 'no-store',
    });

    return response.ok;
  } catch (error: unknown) {
    console.error('Failed to dispatch Telegram update to internal processor:', error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (!verifyTelegramWebhookSecret(secret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const payload = TelegramUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!payload.success) {
      return NextResponse.json({ ok: true });
    }

    if (payload.data.callback_query?.id) {
      await answerTelegramCallbackQuery(payload.data.callback_query.id);
    }

    if (config.features.telegramAsyncProcessing) {
      const queued = await dispatchToInternalProcessor(payload.data);
      if (queued) {
        return NextResponse.json({ ok: true, queued: true });
      }
    }

    await processTelegramUpdate(payload.data);
    return NextResponse.json({ ok: true, queued: false });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to process Telegram webhook',
      },
      { status: 500 }
    );
  }
}
