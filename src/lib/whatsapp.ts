/**
 * WhatsApp Cloud API (Meta Graph API) client and webhook helpers.
 *
 * Checked against Meta's docs on 2026-09-23: Graph API v25.0, send endpoint
 * `POST /<PHONE_NUMBER_ID>/messages`; interactive reply buttons are max 3,
 * titles max 20 chars, ids max 256, body max 1024; plain text body max 4096.
 *
 * ── The off switch ──────────────────────────────────────────────────────────
 *
 * No `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` means not configured:
 * sends return `{ok:false}` without a network call, the webhook refuses, and
 * the settings card says WhatsApp is not set up. There is no feature flag.
 *
 * ── The 24-hour window ──────────────────────────────────────────────────────
 *
 * Meta only allows free-form (non-template) messages within 24h of the user's
 * last message. Every Scout reply is a response to something the user just
 * sent, and runs finish in minutes, so we are always inside the window and no
 * message templates are needed. A future proactive push (e.g. "3 new roles
 * match") would NOT be, and must use an approved template instead.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_GRAPH_VERSION = 'v25.0';
export const WHATSAPP_TEXT_MAX = 4096;
export const WHATSAPP_INTERACTIVE_BODY_MAX = 1024;
export const WHATSAPP_MAX_BUTTONS = 3;
export const WHATSAPP_BUTTON_TITLE_MAX = 20;
export const WHATSAPP_LIST_ROWS_MAX = 10;
export const WHATSAPP_LIST_ROW_TITLE_MAX = 24;
export const WHATSAPP_LIST_BUTTON_MAX = 20;

export type WhatsAppConfig = {
    accessToken: string;
    phoneNumberId: string;
    appSecret: string;
    verifyToken: string;
    publicNumber: string;
    graphVersion: string;
};

export function readWhatsAppConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
    const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim() ?? '';
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
    if (!accessToken || !phoneNumberId) return null;
    return {
        accessToken,
        phoneNumberId,
        appSecret: env.WHATSAPP_APP_SECRET?.trim() ?? '',
        verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() ?? '',
        publicNumber: (env.WHATSAPP_PUBLIC_NUMBER ?? '').replace(/[^\d]/g, ''),
        graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION,
    };
}

export function isWhatsAppConfigured(): boolean {
    return readWhatsAppConfig() !== null;
}

// ───────────────────────────────────────────────────────────── transport

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const realFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
let fetchImpl: FetchLike = realFetch;

export const __testing = {
    setFetch(impl: FetchLike | null) {
        fetchImpl = impl ?? realFetch;
    },
    reset() {
        fetchImpl = realFetch;
    },
};

export type WhatsAppSendResult = { ok: boolean; messageId: string | null; error: string | null };

const SendResponseSchema = z.object({
    messages: z.array(z.object({ id: z.string() })).optional(),
    success: z.boolean().optional(),
    error: z.object({ message: z.string().optional(), code: z.number().optional() }).optional(),
});

async function post(payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const cfg = readWhatsAppConfig();
    if (!cfg) return { ok: false, messageId: null, error: 'WhatsApp is not configured' };
    const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
        });
        const json = await response.json().catch(() => ({}));
        const parsed = SendResponseSchema.safeParse(json);
        if (!response.ok || !parsed.success || parsed.data.error) {
            const error = parsed.success ? parsed.data.error?.message ?? `HTTP ${response.status}` : 'invalid response';
            console.warn('[whatsapp] send failed', { status: response.status, error });
            return { ok: false, messageId: null, error };
        }
        return { ok: true, messageId: parsed.data.messages?.[0]?.id ?? null, error: null };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[whatsapp] send threw', { error: message });
        return { ok: false, messageId: null, error: message };
    }
}

function clip(value: string, max: number): string {
    const clean = value.trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export async function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
    return post({
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: clip(body, WHATSAPP_TEXT_MAX) },
    });
}

export type WhatsAppButton = { id: string; title: string };

/** Interactive reply buttons. Extra buttons beyond 3 are dropped, not sent. */
export async function sendWhatsAppButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<WhatsAppSendResult> {
    return post({
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: clip(body, WHATSAPP_INTERACTIVE_BODY_MAX) },
            action: {
                buttons: buttons.slice(0, WHATSAPP_MAX_BUTTONS).map((button) => ({
                    type: 'reply',
                    reply: { id: button.id.slice(0, 256), title: clip(button.title, WHATSAPP_BUTTON_TITLE_MAX) },
                })),
            },
        },
    });
}

export type WhatsAppListRow = { id: string; title: string; description?: string };

/** A list message, for more than three choices (max 10 rows). */
export async function sendWhatsAppList(
    to: string,
    body: string,
    buttonText: string,
    rows: WhatsAppListRow[],
): Promise<WhatsAppSendResult> {
    return post({
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: clip(body, WHATSAPP_INTERACTIVE_BODY_MAX) },
            action: {
                button: clip(buttonText, WHATSAPP_LIST_BUTTON_MAX),
                sections: [{
                    title: 'Choose one',
                    rows: rows.slice(0, WHATSAPP_LIST_ROWS_MAX).map((row) => ({
                        id: row.id.slice(0, 200),
                        title: clip(row.title, WHATSAPP_LIST_ROW_TITLE_MAX),
                        ...(row.description ? { description: clip(row.description, 72) } : {}),
                    })),
                }],
            },
        },
    });
}

/** Blue ticks. Cosmetic; failures are ignored. */
export async function markWhatsAppRead(messageId: string): Promise<void> {
    await post({ status: 'read', message_id: messageId }).catch(() => undefined);
}

// ────────────────────────────────────────────────────────────── webhook

/**
 * Verify `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 of the RAW request
 * body with the app secret. Must be the raw bytes: re-serialised JSON differs
 * in whitespace and key order, and the signature would never match.
 * An unset app secret fails closed.
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | null, appSecret: string): boolean {
    if (!appSecret || !header) return false;
    const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
    if (!match) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
    const received = Buffer.from(match[1], 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
}

/** GET handshake: echo `hub.challenge` iff mode and token match. */
export function verifyWhatsAppHandshake(params: URLSearchParams, verifyToken: string): string | null {
    if (!verifyToken) return null;
    if (params.get('hub.mode') !== 'subscribe') return null;
    const token = params.get('hub.verify_token') ?? '';
    const a = Buffer.from(token);
    const b = Buffer.from(verifyToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return params.get('hub.challenge');
}

const WebhookSchema = z.object({
    entry: z.array(z.object({
        changes: z.array(z.object({
            value: z.object({
                contacts: z.array(z.object({
                    wa_id: z.string(),
                    profile: z.object({ name: z.string().optional() }).optional(),
                })).optional(),
                messages: z.array(z.object({
                    id: z.string(),
                    from: z.string(),
                    type: z.string(),
                    text: z.object({ body: z.string() }).optional(),
                    interactive: z.object({
                        type: z.string(),
                        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                        list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                    }).optional(),
                    button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
                })).optional(),
            }).passthrough(),
        })).default([]),
    })).default([]),
}).passthrough();

export type WhatsAppInbound = {
    id: string;
    /** The sender's wa_id — the `externalId` of their ChannelIdentity. */
    from: string;
    text: string | null;
    /** Interactive reply id (our `sc:` action), when a button was tapped. */
    replyId: string | null;
    replyTitle: string | null;
    profileName: string | null;
};

/**
 * Inbound user messages only. Status callbacks (sent/delivered/read) arrive
 * on the same webhook and are ignored here.
 */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInbound[] {
    const parsed = WebhookSchema.safeParse(payload);
    if (!parsed.success) return [];
    const out: WhatsAppInbound[] = [];
    for (const entry of parsed.data.entry) {
        for (const change of entry.changes) {
            const names = new Map((change.value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? null]));
            for (const message of change.value.messages ?? []) {
                const reply = message.interactive?.button_reply ?? message.interactive?.list_reply ?? null;
                out.push({
                    id: message.id,
                    from: message.from,
                    text: message.text?.body ?? message.button?.text ?? null,
                    replyId: reply?.id ?? message.button?.payload ?? null,
                    replyTitle: reply?.title ?? null,
                    profileName: names.get(message.from) ?? null,
                });
            }
        }
    }
    return out;
}

/** Click-to-chat link that pre-fills "link <token>". */
export function whatsAppLinkDeepLink(publicNumber: string, token: string): string | null {
    const digits = publicNumber.replace(/[^\d]/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(`link ${token}`)}`;
}
