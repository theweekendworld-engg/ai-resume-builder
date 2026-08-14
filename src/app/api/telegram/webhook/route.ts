import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { processTelegramUpdate, TelegramUpdateSchema } from '@/services/telegramAgent';
import { answerTelegramCallbackQuery, verifyTelegramWebhookSecret } from '@/lib/telegram';
import { handleDigestCallback } from '@/lib/jobs/handlers/weeklyDigest';

/**
 * Digest inline-keyboard taps (PRD 01 §5.2).
 *
 * Parsed separately from `TelegramUpdateSchema` because editing the message in
 * place needs `message_id`, which the shared schema does not carry, and that
 * schema belongs to the Telegram agent. Digest callbacks are answered and
 * returned here — they never reach `processTelegramUpdate`.
 */
const DigestCallbackSchema = z.object({
  callback_query: z.object({
    id: z.string(),
    data: z.string(),
    message: z
      .object({
        message_id: z.number().optional(),
        chat: z.object({ id: z.union([z.string(), z.number()]) }),
      })
      .optional(),
  }),
});

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
    const body = await req.json().catch(() => ({}));
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (!verifyTelegramWebhookSecret(secret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // Digest routing first: it owns the `d:` callback namespace and must not
    // fall through to the resume agent's callback handling.
    const digestCallback = DigestCallbackSchema.safeParse(body);
    if (digestCallback.success && digestCallback.data.callback_query.data.startsWith('d:')) {
      const { id, data, message } = digestCallback.data.callback_query;
      const chatId = message?.chat.id;
      if (chatId !== undefined) {
        const result = await handleDigestCallback({
          data,
          chatId: String(chatId),
          messageId: message?.message_id,
        });
        if (result.handled) {
          await answerTelegramCallbackQuery(id);
          return NextResponse.json({ ok: true, digest: result.outcome });
        }
      }
    }

    const payload = TelegramUpdateSchema.safeParse(body);
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
