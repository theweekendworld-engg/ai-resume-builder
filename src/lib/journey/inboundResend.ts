/**
 * Resend Inbound → the inbound payload the parser reads (docs/prd/11 §3).
 *
 * Resend's `email.received` webhook carries only metadata (sender,
 * recipients, subject, ids). The body and headers are fetched from the
 * Receiving API by email id, then mapped onto the Postmark-shaped
 * `InboundPayload`, so parsing, routing and filing are the same code for
 * every provider.
 */

import { Resend, type GetReceivingEmailResponseSuccess } from 'resend';
import type { InboundPayload } from '@/lib/journey/inbound';

export type ResendReceivedEmail = GetReceivingEmailResponseSuccess;

function headerValue(headers: Record<string, string> | null, name: string): string | null {
    if (!headers) return null;
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
}

/** Pure. The envelope recipient (`received_for`) goes first: headers keep the original To. */
export function fromResendEmail(email: ResendReceivedEmail): InboundPayload {
    const to = email.to ?? [];
    const receivedFor = email.received_for ?? [];
    return {
        From: email.from ?? '',
        FromName: null,
        FromFull: null,
        To: to.join(', '),
        ToFull: [...receivedFor, ...to].map((address) => ({ Email: address })),
        OriginalRecipient: receivedFor[0] ?? null,
        Subject: email.subject ?? '',
        MessageID: email.message_id || null,
        // The message's own Date header; when it is missing, the time Resend received it.
        Date: headerValue(email.headers, 'date') ?? email.created_at ?? null,
        TextBody: email.text,
        HtmlBody: email.html,
        StrippedTextReply: null,
        Headers: Object.entries(email.headers ?? {}).map(([Name, Value]) => ({ Name, Value: String(Value) })),
    };
}

type Fetcher = (emailId: string) => Promise<ResendReceivedEmail>;
let fetcherForTests: Fetcher | null = null;

/** The full received email. Throws when Resend cannot return it (Resend retries the webhook). */
export async function fetchReceivedEmail(emailId: string): Promise<ResendReceivedEmail> {
    if (fetcherForTests) return fetcherForTests(emailId);
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) throw new Error('RESEND_API_KEY is not set');
    const { data, error } = await new Resend(key).emails.receiving.get(emailId);
    if (error || !data) throw new Error(`Resend receiving.get failed: ${error?.message ?? 'no data'}`);
    return data;
}

export const __testing = {
    setFetcher(fetcher: Fetcher | null) {
        fetcherForTests = fetcher;
    },
};
