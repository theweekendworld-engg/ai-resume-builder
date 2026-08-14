/**
 * The Telegram mock — installed at the transport, not at the module.
 *
 * `src/lib/telegram.ts` has no client object, so the provider boundary is
 * `fetch`. Intercepting there means the module under test still runs: the
 * request body it builds, `parse_mode: 'Markdown'`, the reply markup, the
 * multipart document upload, and — the part that actually has a bug budget —
 * the deliberate split where `sendTelegramMessage` throws on failure while
 * `editTelegramMessageText` swallows it and returns false.
 *
 * Replacing `@/lib/telegram` with `mock.module` (as two suites do today) skips
 * all of that and asserts only that the app called a function.
 */

import { __testing as telegramTesting } from '@/lib/telegram';
import type { Recorder, TelegramRecord } from './recorder';

/** The transport the seam accepts. Pinned to the seam, not re-declared. */
type TelegramFetch = Parameters<typeof telegramTesting.setFetch>[0] & object;

/** Bot API method name → what the mock should answer. */
export type TelegramOutcome =
    | { kind: 'ok'; result?: unknown }
    | { kind: 'api_error'; description: string; status?: number }
    | { kind: 'throw'; message: string };

const TELEGRAM_URL = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(.+)$/;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export class MockTelegram {
    private outcomes = new Map<string, TelegramOutcome>();
    private defaultOutcome: TelegramOutcome = { kind: 'ok' };
    /** Deterministic message ids, seeded at a fixed base — never a clock. */
    private nextMessageId = 1000;

    constructor(private readonly recorder: Recorder) {}

    // ── assertions

    /** Every Bot API call this run. */
    get messages(): TelegramRecord[] {
        return this.recorder.telegram;
    }

    /** Just the `sendMessage` calls. */
    get sent(): TelegramRecord[] {
        return this.recorder.telegram.filter((entry) => entry.method === 'sendMessage');
    }

    /** Just the `editMessageText` calls — the in-place digest confirmations. */
    get edits(): TelegramRecord[] {
        return this.recorder.telegram.filter((entry) => entry.method === 'editMessageText');
    }

    /** Calls to one Bot API method, in order. */
    callsTo(method: string): TelegramRecord[] {
        return this.recorder.telegram.filter((entry) => entry.method === method);
    }

    toChat(chatId: string | number): TelegramRecord[] {
        return this.recorder.telegram.filter((entry) => entry.chatId === String(chatId));
    }

    // ── arrange

    /** Make one Bot API method fail. Everything else keeps succeeding. */
    setOutcome(method: string, outcome: TelegramOutcome): this {
        this.outcomes.set(method, outcome);
        return this;
    }

    setDefaultOutcome(outcome: TelegramOutcome): this {
        this.defaultOutcome = outcome;
        return this;
    }

    reset(): void {
        this.outcomes.clear();
        this.defaultOutcome = { kind: 'ok' };
        this.nextMessageId = 1000;
        this.recorder.telegram.length = 0;
    }

    // ── inbound simulation

    /**
     * A `callback_query` update, shaped for
     * `POST /api/telegram/webhook`. This is the tap on a digest button.
     */
    callbackUpdate(input: {
        data: string;
        chatId: string | number;
        /** Defaults to the message id of the last `sendMessage` this mock saw. */
        messageId?: number;
        callbackQueryId?: string;
        fromId?: string | number;
    }): Record<string, unknown> {
        const messageId = input.messageId ?? this.lastMessageId ?? this.nextMessageId;
        return {
            update_id: 1,
            callback_query: {
                id: input.callbackQueryId ?? `cbq_${messageId}`,
                data: input.data,
                from: { id: input.fromId ?? input.chatId },
                message: {
                    message_id: messageId,
                    chat: { id: input.chatId },
                },
            },
        };
    }

    /** The `message_id` the mock assigned to the most recent `sendMessage`. */
    get lastMessageId(): number | null {
        const last = this.sent.at(-1);
        return last ? (last.body.__message_id as number) : null;
    }

    // ── the transport

    /**
     * Hand this to `telegram.__testing.setFetch`. Typed as the seam's own
     * parameter type, so a change to the seam breaks here rather than silently
     * accepting a mismatched transport.
     */
    get fetch(): TelegramFetch {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const match = TELEGRAM_URL.exec(url);
            if (!match) {
                throw new Error(`mock telegram: unexpected fetch to ${url}`);
            }

            const method = match[2];
            const body = await this.readBody(init);
            const messageId = this.nextMessageId;
            this.nextMessageId += 1;

            const chat = body.chat_id;
            this.recorder.telegram.push({
                method,
                chatId: chat === undefined || chat === null ? null : String(chat),
                text: typeof body.text === 'string' ? body.text : null,
                messageId: typeof body.message_id === 'number' ? body.message_id : null,
                replyMarkup: body.reply_markup ?? null,
                body: { ...body, __message_id: messageId },
            });

            const outcome = this.outcomes.get(method) ?? this.defaultOutcome;

            if (outcome.kind === 'throw') throw new Error(outcome.message);
            if (outcome.kind === 'api_error') {
                return jsonResponse(
                    { ok: false, description: outcome.description },
                    outcome.status ?? 400,
                );
            }

            return jsonResponse({
                ok: true,
                result: outcome.result ?? { message_id: messageId, chat: { id: chat } },
            });
        };
    }

    private async readBody(init?: RequestInit): Promise<Record<string, unknown>> {
        const body = init?.body;
        if (!body) return {};

        if (typeof body === 'string') {
            try {
                const parsed = JSON.parse(body) as unknown;
                return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
            } catch {
                return { __raw: body };
            }
        }

        // `sendDocument` posts multipart. Flatten it so a test can assert on the
        // filename and caption without knowing about FormData.
        if (body instanceof FormData) {
            const out: Record<string, unknown> = {};
            for (const [key, value] of body.entries()) {
                out[key] =
                    typeof value === 'string'
                        ? value
                        : { filename: (value as File).name, size: (value as File).size };
            }
            return out;
        }

        return { __raw: String(body) };
    }
}
