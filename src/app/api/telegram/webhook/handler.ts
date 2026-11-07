/**
 * The Telegram webhook, as a plain function the route file wraps.
 *
 * Lives outside `route.ts` because Next only permits HTTP-method and config
 * exports from a route module, and this needs testing without a request scope.
 *
 * Telegram gets its 200 as soon as the secret checks out and the body parses;
 * the work is scheduled to run after the response (`after()` in the route).
 * It used to be awaited, so a throw returned 500, Telegram redelivered, the
 * receipt written before the throw turned the retry into a silent 200, and
 * the user never heard back. Now `processTelegramUpdate` claims the update id
 * (a redelivery is a no-op) and turns any failure into a plain reply to the
 * user plus an operator alert.
 */

import { z } from 'zod';
import type { handleDigestCallback } from '@/lib/jobs/handlers/weeklyDigest';
import { TelegramUpdateSchema, type TelegramUpdatePayload } from '@/services/telegramAgent';

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

export type TelegramWebhookDeps = {
    verifySecret: (headerValue: string | null) => boolean;
    /** Runs work after the response is sent: `after()` in the route. */
    schedule: (work: () => Promise<void>) => void;
    /** `processTelegramUpdate`: claims the update id, never throws. */
    process: (update: TelegramUpdatePayload) => Promise<unknown>;
    handleDigest: typeof handleDigestCallback;
    answerCallback: (callbackQueryId: string) => Promise<void>;
};

export type TelegramWebhookResponse = { status: number; body: Record<string, unknown> };

export async function handleTelegramWebhook(
    input: { body: unknown; secret: string | null },
    deps: TelegramWebhookDeps,
): Promise<TelegramWebhookResponse> {
    if (!deps.verifySecret(input.secret)) return { status: 401, body: { ok: false } };

    // Digest routing first: it owns the `d:` callback namespace and must not
    // fall through to the resume agent's callback handling. It stays inline
    // (it edits one message and has no receipt), so a throw here is a 500 and
    // Telegram's redelivery retries it.
    const digestCallback = DigestCallbackSchema.safeParse(input.body);
    if (digestCallback.success && digestCallback.data.callback_query.data.startsWith('d:')) {
        const { id, data, message } = digestCallback.data.callback_query;
        if (message?.chat.id !== undefined) {
            try {
                const result = await deps.handleDigest({ data, chatId: String(message.chat.id), messageId: message.message_id });
                if (result.handled) {
                    await deps.answerCallback(id);
                    return { status: 200, body: { ok: true, digest: result.outcome } };
                }
            } catch (error: unknown) {
                console.error('[telegram] digest callback failed', { error: error instanceof Error ? error.message : String(error) });
                return { status: 500, body: { ok: false } };
            }
        }
    }

    const payload = TelegramUpdateSchema.safeParse(input.body);
    if (!payload.success) return { status: 200, body: { ok: true } };

    const update = payload.data;
    deps.schedule(async () => {
        try {
            // Stops the button's spinner first; never throws.
            if (update.callback_query?.id) await deps.answerCallback(update.callback_query.id);
            await deps.process(update);
        } catch (error: unknown) {
            // `process` handles its own failures; this is the last line, for logs.
            console.error('[telegram] scheduled update failed', {
                updateId: update.update_id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    return { status: 200, body: { ok: true } };
}
