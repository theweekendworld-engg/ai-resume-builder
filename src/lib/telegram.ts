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

/**
 * Test seam. This module owns no client object — it calls `fetch` directly — so
 * the seam is the transport itself.
 *
 * It exists so that tests can exercise THIS module for real (body construction,
 * `parse_mode`, the throw-vs-return-false split between `sendTelegramMessage`
 * and `editTelegramMessageText`, the multipart document upload) rather than
 * replacing it wholesale with `mock.module`, which skips all of that.
 *
 * Production behaviour is unchanged: the default delegates to global `fetch`.
 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const realFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
let fetchImpl: FetchLike = realFetch;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleepImpl: (ms: number) => Promise<void> = realSleep;

export const __testing = {
  setFetch(impl: FetchLike | null) {
    fetchImpl = impl ?? realFetch;
  },
  /** The 429 back-off waits through this, so tests do not sleep for real. */
  setSleep(impl: ((ms: number) => Promise<void>) | null) {
    sleepImpl = impl ?? realSleep;
  },
  reset() {
    fetchImpl = realFetch;
    sleepImpl = realSleep;
  },
};

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

  const response = await fetchImpl(buildTelegramApiUrl('sendMessage'), {
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

type EditMessageInput = {
  chatId: string | number;
  messageId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

/**
 * Rewrite a message that is already in the chat. The weekly digest confirms in
 * place with this (PRD 01 §5.2) — a second message per tap would turn a
 * five-item digest into eleven notifications.
 *
 * Never throws: an edit failing is cosmetic, and by the time it is called the
 * Win has already been written. `message is not modified` in particular is a
 * normal response to a double tap, not an error.
 */
export async function editTelegramMessageText(input: EditMessageInput): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  if (input.replyMarkup) body.reply_markup = input.replyMarkup;

  try {
    const response = await fetchImpl(buildTelegramApiUrl('editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    const parsed = TelegramSendResponseSchema.safeParse(json);
    if (!response.ok || !parsed.success || !parsed.data.ok) {
      console.warn('Telegram editMessageText failed:', { status: response.status, json });
      return false;
    }
    return true;
  } catch (error: unknown) {
    console.warn('Telegram editMessageText threw:', error);
    return false;
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

  const response = await fetchImpl(buildTelegramApiUrl('sendDocument'), {
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
  await fetchImpl(buildTelegramApiUrl('answerCallbackQuery'), {
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

  const response = await fetchImpl(buildTelegramApiUrl('setWebhook'), {
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

  const response = await fetchImpl(buildTelegramApiUrl('deleteWebhook'), {
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
  { command: 'scout', description: 'Analyse a LinkedIn job or post: /scout <link> (or just send the link)' },
  { command: 'jobs', description: 'Your best-fit jobs to review' },
  { command: 'applied', description: 'Jobs you applied to, and where each stands' },
  { command: 'insights', description: 'Your saved insights from posts' },
  { command: 'notes', description: 'Your Work Log notes and drafts' },
  { command: 'help', description: 'Everything you can send me' },
  { command: 'generate', description: 'Start with: /generate <job description>' },
  { command: 'status', description: 'Show your latest resume generation status (linked account required)' },
  { command: 'profile', description: 'View your linked profile details' },
  { command: 'unlink', description: 'Disconnect this chat from your Patronus account' },
] as const;

export async function setTelegramBotCommands(): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };

  const response = await fetchImpl(buildTelegramApiUrl('setMyCommands'), {
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

// ───────────────────────────────────────────────────── detailed transport
//
// Added for Scout (docs/impl/06-scout-agent.md). The functions above return
// void/boolean and hard-code legacy `Markdown`; Scout needs the sent message
// id (to edit progress in place), HTML parse mode (legacy Markdown cannot
// escape `_` or `*`, which job titles and comp figures contain), and to tell a
// rate limit apart from a real failure. Additive so the digest and resume bot
// paths keep their exact behaviour.

export type TelegramParseMode = 'Markdown' | 'HTML';

export type TelegramCallResult = {
  ok: boolean;
  messageId: number | null;
  description: string | null;
  /** Seconds, from a 429's `parameters.retry_after`. */
  retryAfter: number | null;
  /** Edit of identical content. Telegram calls it an error; it is a no-op. */
  notModified: boolean;
};

const DetailedResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.union([z.object({ message_id: z.number().optional() }).passthrough(), z.boolean()]).optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

/** Longest 429 wait we will absorb inline; longer and we give up this edit. */
const MAX_INLINE_RETRY_SECONDS = 5;

async function callTelegramOnce(method: string, body: Record<string, unknown>): Promise<TelegramCallResult> {
  try {
    const response = await fetchImpl(buildTelegramApiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    const parsed = DetailedResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, messageId: null, description: 'invalid telegram response', retryAfter: null, notModified: false };
    }
    const description = parsed.data.description ?? null;
    const notModified = /message is not modified/i.test(description ?? '');
    const result = parsed.data.result;
    const messageId = result && typeof result === 'object' && typeof result.message_id === 'number'
      ? result.message_id
      : null;
    return {
      ok: (response.ok && parsed.data.ok) || notModified,
      messageId,
      description,
      retryAfter: parsed.data.parameters?.retry_after ?? (response.status === 429 ? 1 : null),
      notModified,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      messageId: null,
      description: error instanceof Error ? error.message : String(error),
      retryAfter: null,
      notModified: false,
    };
  }
}

/** One call, with a single bounded retry on 429. Never throws. */
export async function callTelegram(method: string, body: Record<string, unknown>): Promise<TelegramCallResult> {
  const first = await callTelegramOnce(method, body);
  if (first.ok || first.retryAfter === null || first.retryAfter > MAX_INLINE_RETRY_SECONDS) {
    if (!first.ok) console.warn(`Telegram ${method} failed:`, { description: first.description, retryAfter: first.retryAfter });
    return first;
  }
  await sleepImpl(first.retryAfter * 1000);
  const second = await callTelegramOnce(method, body);
  if (!second.ok) console.warn(`Telegram ${method} failed after retry:`, { description: second.description });
  return second;
}

export async function sendTelegramMessageDetailed(input: SendMessageInput & { parseMode?: TelegramParseMode }): Promise<TelegramCallResult> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? 'HTML',
    disable_web_page_preview: true,
  };
  if (input.replyMarkup) body.reply_markup = input.replyMarkup;
  return callTelegram('sendMessage', body);
}

export async function editTelegramMessageDetailed(input: EditMessageInput & { parseMode?: TelegramParseMode }): Promise<TelegramCallResult> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    parse_mode: input.parseMode ?? 'HTML',
    disable_web_page_preview: true,
  };
  if (input.replyMarkup) body.reply_markup = input.replyMarkup;
  return callTelegram('editMessageText', body);
}

/**
 * Replace a sent message's inline keyboard. An empty `rows` removes it. Used
 * to take spent buttons (a confirmed Win) off the message they sat on.
 */
export async function editTelegramReplyMarkup(input: {
  chatId: string;
  messageId: number;
  rows: Array<Array<Record<string, unknown>>>;
}): Promise<TelegramCallResult> {
  return callTelegram('editMessageReplyMarkup', {
    chat_id: input.chatId,
    message_id: input.messageId,
    reply_markup: { inline_keyboard: input.rows },
  });
}
