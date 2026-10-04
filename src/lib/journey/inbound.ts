/**
 * Inbound job email, parsed (docs/prd/11-job-journey.md §3). Pure.
 *
 * Mail reaches us by forwarding, so no Gmail scope is ever requested: the
 * user adds one Gmail filter that forwards job mail to
 * `jobs+<token>@<INBOUND_EMAIL_DOMAIN>`. The inbound provider (Postmark's
 * inbound JSON is the accepted shape) posts each message to
 * `/api/inbound/email`.
 *
 * Three kinds of message arrive:
 *   1. Gmail's forwarding confirmation, sent once when the user adds the
 *      address. Its code is shown in Settings so setup can finish.
 *   2. A filter-forwarded message: headers are the original sender's.
 *   3. A hand-forwarded one ("Fwd:"): the sender is the user, and the
 *      original sender sits in a quoted header block in the body.
 */

import { z } from 'zod';

/** Postmark inbound webhook, the fields we read. Unknown fields pass through. */
export const InboundPayloadSchema = z.object({
    From: z.string().optional().default(''),
    FromName: z.string().optional().nullable(),
    FromFull: z.object({ Email: z.string().optional().default(''), Name: z.string().optional().nullable() }).partial().optional().nullable(),
    To: z.string().optional().default(''),
    ToFull: z.array(z.object({ Email: z.string().optional().default('') }).partial()).optional().nullable(),
    OriginalRecipient: z.string().optional().nullable(),
    Subject: z.string().optional().default(''),
    MessageID: z.string().optional().nullable(),
    Date: z.string().optional().nullable(),
    TextBody: z.string().optional().nullable(),
    HtmlBody: z.string().optional().nullable(),
    StrippedTextReply: z.string().optional().nullable(),
    Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional().nullable(),
}).passthrough();

export type InboundPayload = z.infer<typeof InboundPayloadSchema>;

/** Stored body cap. A job email that needs more than this is a newsletter. */
export const BODY_MAX_CHARS = 20_000;

export type ParsedInbound =
    | { kind: 'forwarding_confirmation'; token: string; code: string | null; confirmUrl: string | null; forwardingFrom: string | null }
    | {
        kind: 'message';
        token: string;
        messageId: string;
        fromEmail: string;
        fromName: string | null;
        subject: string;
        receivedAt: Date;
        text: string;
    }
    | { kind: 'unroutable'; reason: string };

const TOKEN_RE = /jobs\+([a-z0-9]{12,40})@/i;

function header(payload: InboundPayload, name: string): string | null {
    const found = payload.Headers?.find((h) => h.Name.toLowerCase() === name.toLowerCase());
    return found?.Value ?? null;
}

/** The address token, from the envelope recipient first (headers keep the original To). */
export function tokenOf(payload: InboundPayload, domain: string | null): string | null {
    const candidates = [
        payload.OriginalRecipient ?? '',
        ...(payload.ToFull ?? []).map((entry) => entry.Email ?? ''),
        payload.To ?? '',
        header(payload, 'X-Forwarded-To') ?? '',
        header(payload, 'Delivered-To') ?? '',
    ];
    for (const value of candidates) {
        const match = TOKEN_RE.exec(value);
        if (!match) continue;
        if (domain && !value.toLowerCase().includes(`@${domain.toLowerCase()}`)) continue;
        return match[1].toLowerCase();
    }
    return null;
}

export function htmlToText(html: string): string {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<\/?(td|th)[^>]*>/gi, ' ')
        // Inline tags (b, a, span…) vanish without a gap: "<b>Jai</b>," is "Jai,".
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function parseAddress(value: string): { email: string; name: string | null } {
    const angle = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
    if (angle) return { email: angle[2].trim().toLowerCase(), name: angle[1].trim() || null };
    const bare = /([^\s<>"]+@[^\s<>"]+)/.exec(value);
    return { email: (bare?.[1] ?? value).trim().toLowerCase(), name: null };
}

/**
 * A hand-forwarded message: the quoted block Gmail and Outlook write.
 *   ---------- Forwarded message ---------
 *   From: Priya <priya@acme.com>
 *   Date: ...
 *   Subject: Interview availability
 */
export function unwrapForward(text: string): { fromEmail: string; fromName: string | null; subject: string | null; body: string } | null {
    const marker = /-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-----Original Message-----/i.exec(text);
    if (!marker) return null;
    const rest = text.slice(marker.index + marker[0].length);
    const from = /^\s*From:\s*(.+)$/im.exec(rest);
    if (!from) return null;
    const subject = /^\s*Subject:\s*(.+)$/im.exec(rest);
    const { email, name } = parseAddress(from[1]);
    // The body starts after the header block's first blank line.
    const blank = /\n\s*\n/.exec(rest.slice(from.index));
    const body = blank ? rest.slice(from.index + blank.index).trim() : rest.trim();
    return { fromEmail: email, fromName: name, subject: subject?.[1].trim() ?? null, body };
}

function isGmailForwardingConfirmation(fromEmail: string, subject: string): boolean {
    return /forwarding-noreply@google\.com$/i.test(fromEmail) || /Gmail Forwarding Confirmation/i.test(subject);
}

export function parseInbound(payload: InboundPayload, domain: string | null, now: Date = new Date()): ParsedInbound {
    const token = tokenOf(payload, domain);
    if (!token) return { kind: 'unroutable', reason: 'no jobs+<token> recipient' };

    const fromRaw = payload.FromFull?.Email || payload.From || '';
    const from = parseAddress(fromRaw);
    const subject = (payload.Subject ?? '').trim();
    const rawText = (payload.TextBody?.trim() || (payload.HtmlBody ? htmlToText(payload.HtmlBody) : '')).replace(/\r\n/g, '\n');

    if (isGmailForwardingConfirmation(from.email, subject)) {
        const code = /\(#(\d{6,12})\)/.exec(subject)?.[1] ?? /confirmation code:\s*(\d{6,12})/i.exec(rawText)?.[1] ?? null;
        const confirmUrl = /(https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"'<>)]+)/i.exec(rawText)?.[1] ?? null;
        const forwardingFrom = /Receive Mail from\s+(\S+@\S+)/i.exec(subject)?.[1] ?? null;
        return { kind: 'forwarding_confirmation', token, code, confirmUrl, forwardingFrom };
    }

    const forwarded = /^(fwd?|fw):/i.test(subject) ? unwrapForward(rawText) : null;
    const date = payload.Date ? new Date(payload.Date) : now;
    const messageId = (payload.MessageID || header(payload, 'Message-ID') || `${from.email}:${subject}:${date.toISOString()}`).trim().replace(/^<|>$/g, '');

    return {
        kind: 'message',
        token,
        messageId: messageId.slice(0, 300),
        fromEmail: (forwarded?.fromEmail ?? from.email).slice(0, 300),
        fromName: (forwarded?.fromName ?? payload.FromFull?.Name ?? payload.FromName ?? from.name ?? null)?.slice(0, 200) ?? null,
        subject: (forwarded?.subject ?? subject.replace(/^(fwd?|fw):\s*/i, '')).slice(0, 500) || '(no subject)',
        receivedAt: Number.isFinite(date.getTime()) ? date : now,
        text: (forwarded?.body ?? rawText).slice(0, BODY_MAX_CHARS),
    };
}

/** The sender's organisation domain, for matching: "talent@mail.acme.com" → "acme.com". */
export function senderDomain(email: string): string | null {
    const domain = email.split('@')[1]?.toLowerCase().trim();
    if (!domain) return null;
    const parts = domain.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : domain;
}

/** Hosted ATS and free mail, whose domain says nothing about the employer. */
export const GENERIC_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me',
    'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workday.com', 'myworkday.com', 'smartrecruiters.com',
    'icims.com', 'jobvite.com', 'workable.com', 'bamboohr.com', 'linkedin.com', 'naukri.com', 'indeed.com',
]);
