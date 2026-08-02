/**
 * The Resend mock — installed at the PROVIDER boundary.
 *
 * This is the whole point of the mock layer. With this underneath,
 * `sendEmail` runs for real: the preference lookup, the suppression rules, the
 * plain-text part, the `List-Unsubscribe` / `List-Unsubscribe-Post` headers and
 * the `EmailSend` bookkeeping all execute, and the only thing that does not
 * happen is the HTTP request. Mocking `@/lib/email/send` instead skips every
 * one of those — which is to say it skips the logic worth testing.
 *
 * Fidelity: `send` is declared as `Pick<Resend['emails'], 'send'>`, so its
 * payload and response types come from the installed SDK. If Resend changes
 * `emails.send`, this file stops compiling.
 */

import type { Resend } from 'resend';
import { shortId } from './deterministic';
import type { EmailRecord, Recorder, ResendSendOptions, ResendSendPayload } from './recorder';

type ResendEmails = Resend['emails'];
type SendResponse = Awaited<ReturnType<ResendEmails['send']>>;

/**
 * The SDK's own error-code union. Taken from the response type rather than
 * re-declared, so an added or removed code is a compile error here.
 */
export type ResendErrorCode = Extract<SendResponse, { data: null }>['error']['name'];

/** How the next `send` should behave. Set by a test to exercise a failure path. */
export type ResendOutcome =
    | { kind: 'ok' }
    /** The provider answered, but with an error body — `sendEmail` must not throw. */
    | { kind: 'error'; message: string; name?: ResendErrorCode; statusCode?: number | null }
    /**
     * A 200 carrying no usable id. `sendEmail` guards this with `!data?.id`
     * separately from the error branch, so it needs its own outcome — and the
     * SDK's type says `data` is non-null here, hence an empty id rather than a
     * null body. Reproducing it as `{data: null, error: null}` would not type.
     */
    | { kind: 'no_id' }
    /** The network threw. `sendEmail` must still resolve to a `failed` result. */
    | { kind: 'throw'; message: string };

function toArray(value: string | string[] | undefined | null): string[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? [...value] : [value];
}

function toHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[key] = String(entry);
    }
    return out;
}

function toTags(value: unknown): { name: string; value: string }[] {
    if (!Array.isArray(value)) return [];
    return value.map((tag) => {
        const entry = tag as { name?: unknown; value?: unknown };
        return { name: String(entry?.name ?? ''), value: String(entry?.value ?? '') };
    });
}

/**
 * The `emails` sub-resource. Only `send` is implemented — it is the only method
 * the app calls. See COVERAGE BOUNDARY in the mocks README section of the
 * report for everything on `Emails` that is deliberately absent.
 */
export class MockResendEmails implements Pick<ResendEmails, 'send'> {
    private outcome: ResendOutcome = { kind: 'ok' };

    constructor(private readonly recorder: Recorder) {}

    setOutcome(outcome: ResendOutcome): void {
        this.outcome = outcome;
    }

    async send(payload: ResendSendPayload, options?: ResendSendOptions): Promise<SendResponse> {
        const to = toArray(payload.to as string | string[]);
        const idempotencyKey =
            (options as { idempotencyKey?: string } | undefined)?.idempotencyKey ?? null;

        // Deterministic and content-addressed: two identical sends produce the
        // same provider id, which is exactly what an idempotency key means.
        const providerId = `re_${shortId(idempotencyKey ?? '', to.join(','), payload.subject ?? '')}`;

        const record: EmailRecord = {
            to,
            from: String(payload.from ?? ''),
            subject: String(payload.subject ?? ''),
            html: typeof payload.html === 'string' ? payload.html : '',
            text: typeof payload.text === 'string' ? payload.text : '',
            replyTo: toArray(payload.replyTo as string | string[] | undefined),
            headers: toHeaders(payload.headers),
            tags: toTags(payload.tags),
            idempotencyKey,
            providerId,
            payload,
        };

        if (this.outcome.kind === 'throw') {
            // Recorded before throwing: the call did leave the app.
            this.recorder.emails.push(record);
            throw new Error(this.outcome.message);
        }

        this.recorder.emails.push(record);

        if (this.outcome.kind === 'error') {
            return {
                data: null,
                error: {
                    message: this.outcome.message,
                    name: this.outcome.name ?? 'application_error',
                    statusCode: this.outcome.statusCode ?? 422,
                },
                headers: null,
            };
        }

        if (this.outcome.kind === 'no_id') {
            return { data: { id: '' }, error: null, headers: {} };
        }

        return { data: { id: providerId }, error: null, headers: {} };
    }
}

/**
 * The client handed to `__testing.setResendClient`.
 *
 * `Resend` cannot be `implements`-ed structurally — its sub-resources are
 * classes with private fields, so only a subclass can satisfy the nominal
 * check. The compile-time guarantee therefore lives one level down, on
 * {@link MockResendEmails}, which is where the app's only call site is.
 */
export class MockResend {
    readonly emails: MockResendEmails;

    constructor(private readonly recorder: Recorder) {
        this.emails = new MockResendEmails(recorder);
    }

    /** Everything the system handed to the provider this run. */
    get sent(): EmailRecord[] {
        return this.recorder.emails;
    }

    /** The emails sent to one address, in order. */
    to(address: string): EmailRecord[] {
        return this.recorder.emails.filter((email) => email.to.includes(address));
    }

    /** The most recent send, or null. */
    get last(): EmailRecord | null {
        return this.recorder.emails.at(-1) ?? null;
    }

    setOutcome(outcome: ResendOutcome): void {
        this.emails.setOutcome(outcome);
    }

    reset(): void {
        this.emails.setOutcome({ kind: 'ok' });
        this.recorder.emails.length = 0;
    }

    /** The single cast in the email path, isolated here rather than at call sites. */
    asResend(): Resend {
        return this as unknown as Resend;
    }
}
