import { z } from 'zod';

type TelegramReplyMarkup = Record<string, unknown>;

type SendMessageInput = {
  chatId: string | number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

type SendDocumentInput = {
  chatId: string | number;
  fileName: string;
  document: Buffer | Uint8Array | ArrayBuffer | Blob | string;
  caption?: string;
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
    console.error('Telegram sendMessage failed:', { status: response.status, json, detail });
    throw new Error(`Telegram send failed: ${detail}`);
  }
}

export async function sendTelegramDocument(input: SendDocumentInput): Promise<void> {
  const form = new FormData();
  form.append('chat_id', String(input.chatId));

  if (input.caption) {
    form.append('caption', input.caption);
  }

  if (typeof input.document === 'string') {
    form.append('document', input.document);
  } else {
    const blob = (() => {
      if (input.document instanceof Blob) {
        return input.document;
      }
      if (input.document instanceof ArrayBuffer) {
        return new Blob([new Uint8Array(input.document)], { type: 'application/pdf' });
      }
      if (ArrayBuffer.isView(input.document)) {
        const view = input.document;
        const sliced = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        const copied = new Uint8Array(sliced.byteLength);
        copied.set(sliced);
        return new Blob([copied.buffer], { type: 'application/pdf' });
      }
      return new Blob([input.document], { type: 'application/pdf' });
    })();
    form.append('document', blob, input.fileName);
  }

  const response = await fetch(buildTelegramApiUrl('sendDocument'), {
    method: 'POST',
    body: form,
  });

  const json = await response.json().catch(() => ({}));
  const parsed = TelegramSendResponseSchema.safeParse(json);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description ?? 'unknown' : 'invalid telegram response';
    throw new Error(`Telegram document send failed: ${detail}`);
  }
}

export async function answerTelegramCallbackQuery(callbackQueryId: string): Promise<void> {
  await fetch(buildTelegramApiUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
    }),
  }).catch(() => undefined);
}

const SetWebhookResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.boolean().optional(),
});

export async function setTelegramWebhook(webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };

  const body: Record<string, string> = { url: webhookUrl };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) body.secret_token = secret;

  const response = await fetch(buildTelegramApiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  const parsed = SetWebhookResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description ?? 'unknown' : 'invalid response';
    return { ok: false, error: detail };
  }
  return { ok: true };
}

export async function deleteTelegramWebhook(): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };

  const response = await fetch(buildTelegramApiUrl('deleteWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const json = await response.json().catch(() => ({}));
  const parsed = SetWebhookResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description ?? 'unknown' : 'invalid response';
    return { ok: false, error: detail };
  }
  return { ok: true };
}

const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot or link your account with a token from the dashboard' },
  { command: 'generate', description: 'Paste a job description to get a tailored resume' },
  { command: 'status', description: 'Show your latest resume generation status (linked account required)' },
  { command: 'profile', description: 'View your linked profile details' },
] as const;

export async function setTelegramBotCommands(): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };

  const response = await fetch(buildTelegramApiUrl('setMyCommands'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: BOT_COMMANDS }),
  });

  const json = await response.json().catch(() => ({}));
  const parsed = SetWebhookResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description ?? 'unknown' : 'invalid response';
    return { ok: false, error: detail };
  }
  return { ok: true };
}
