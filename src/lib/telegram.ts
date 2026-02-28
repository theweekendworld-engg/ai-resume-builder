import { z } from 'zod';

type TelegramReplyMarkup = Record<string, unknown>;

type SendMessageInput = {
  chatId: string | number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

const TelegramSendResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

function buildTelegramApiUrl(method: string): string {
  return `https://api.telegram.org/bot${getTelegramBotToken()}/${method}`;
}

export function verifyTelegramWebhookSecret(headerValue: string | null): boolean {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) return true;

  return Boolean(headerValue && headerValue === configuredSecret);
}

export async function sendTelegramMessage(input: SendMessageInput): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };

  if (input.replyMarkup) {
    body.reply_markup = input.replyMarkup;
  }

  const response = await fetch(buildTelegramApiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  const parsed = TelegramSendResponseSchema.safeParse(json);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description ?? 'unknown' : 'invalid telegram response';
    throw new Error(`Telegram send failed: ${detail}`);
  }
}
