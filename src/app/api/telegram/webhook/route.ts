import { after, NextRequest, NextResponse } from 'next/server';
import { handleDigestCallback } from '@/lib/jobs/handlers/weeklyDigest';
import { answerTelegramCallbackQuery, verifyTelegramWebhookSecret } from '@/lib/telegram';
import { processTelegramUpdate } from '@/services/telegramAgent';
import { handleTelegramWebhook } from './handler';

// The work runs in `after()`, which on Vercel extends this function via
// waitUntil, so the cap covers it too. 60s is the Hobby plan's ceiling.
export const maxDuration = 60;

/**
 * Telegram's webhook. Answers 200 as soon as the secret and body check out;
 * the update is handled after the response (see ./handler.ts for why).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await handleTelegramWebhook(
    { body, secret: req.headers.get('x-telegram-bot-api-secret-token') },
    {
      verifySecret: verifyTelegramWebhookSecret,
      schedule: (work) => after(work),
      process: processTelegramUpdate,
      handleDigest: handleDigestCallback,
      answerCallback: answerTelegramCallbackQuery,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
