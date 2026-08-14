/**
 * The outbound-call ledger.
 *
 * Every mock writes here, so a test can assert on what the system *sent* rather
 * than only on what it returned. One shared instance is handed to every mock by
 * {@link installMocks}, which is what makes `mocks.email.sent`,
 * `mocks.telegram.messages` and `mocks.openai.calls` views onto the same run.
 *
 * Nothing in this file is random or clock-dependent — a recorded call is a pure
 * function of the arguments the system passed.
 */

import type { Resend } from 'resend';

// ───────────────────────────────────────────────────────────── record shapes

/** The exact payload type `sendEmail` hands to the provider. */
export type ResendSendPayload = Parameters<Resend['emails']['send']>[0];
export type ResendSendOptions = NonNullable<Parameters<Resend['emails']['send']>[1]>;

export type EmailRecord = {
    /** Normalized to an array; Resend accepts a bare string. */
    to: string[];
    from: string;
    subject: string;
    html: string;
    text: string;
    replyTo: string[];
    /** Includes `List-Unsubscribe` and `List-Unsubscribe-Post` when the real code built them. */
    headers: Record<string, string>;
    tags: { name: string; value: string }[];
    idempotencyKey: string | null;
    /** The id the mock handed back, so a test can join it to an `EmailSend` row. */
    providerId: string;
    /** The untouched payload, for assertions this projection does not cover. */
    payload: ResendSendPayload;
};

export type TelegramRecord = {
    /** `sendMessage`, `editMessageText`, `sendDocument`, `answerCallbackQuery`, … */
    method: string;
    chatId: string | null;
    text: string | null;
    messageId: number | null;
    replyMarkup: unknown;
    /** Parsed JSON body, or a field map for the multipart `sendDocument` call. */
    body: Record<string, unknown>;
};

export type OpenAiRecord =
    | {
          kind: 'embedding';
          model: string;
          input: string[];
          /** Stable digest of the input — the same text always yields the same value. */
          fingerprint: string;
      }
    | {
          kind: 'object';
          model: string;
          system: string;
          prompt: string;
          temperature: number | null;
          fingerprint: string;
      };

export type StripeRecord = {
    /** Dotted path, e.g. `subscriptions.update`. */
    method: string;
    args: unknown[];
};

export type GithubRecord = {
    method: string;
    /** Human-readable argument summary, e.g. `patronus/api#4821`. */
    detail: string;
};

export type QdrantRecord = {
    method: string;
    collection: string;
    /** Points touched, or results returned, depending on the method. */
    count: number;
};

// ───────────────────────────────────────────────────────────── the recorder

export class Recorder {
    readonly emails: EmailRecord[] = [];
    readonly telegram: TelegramRecord[] = [];
    readonly openai: OpenAiRecord[] = [];
    readonly stripe: StripeRecord[] = [];
    readonly github: GithubRecord[] = [];
    readonly qdrant: QdrantRecord[] = [];

    reset(): void {
        this.emails.length = 0;
        this.telegram.length = 0;
        this.openai.length = 0;
        this.stripe.length = 0;
        this.github.length = 0;
        this.qdrant.length = 0;
    }

    /** Every recorded call, in the order the system made them. Useful for ordering assertions. */
    get counts(): Record<string, number> {
        return {
            emails: this.emails.length,
            telegram: this.telegram.length,
            openai: this.openai.length,
            stripe: this.stripe.length,
            github: this.github.length,
            qdrant: this.qdrant.length,
        };
    }
}
