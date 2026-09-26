/**
 * The WhatsApp Cloud API mock — installed at the transport, like Telegram's.
 *
 * `src/lib/whatsapp.ts` calls `fetch` directly, so the seam is `fetch` and the
 * module under test still builds the real Graph API payloads (button/list
 * limits, `messaging_product`, the read receipt). Not wired into
 * `installMocks()` — install it per suite with `installWhatsAppMock()`.
 *
 * Also builds inbound webhook bodies and their `X-Hub-Signature-256`, so a
 * suite can drive the webhook exactly as Meta would, signature included.
 */

import { createHmac } from 'node:crypto';
import { __testing as whatsappTesting } from '@/lib/whatsapp';

export type WhatsAppCall = {
    url: string;
    body: Record<string, unknown>;
};

const GRAPH_URL = /^https:\/\/graph\.facebook\.com\/v[\d.]+\/([^/]+)\/messages$/;

export class MockWhatsApp {
    readonly calls: WhatsAppCall[] = [];
    private nextId = 1;
    private failing: string | null = null;

    /** Plain text sends, in order. */
    get texts(): string[] {
        return this.calls
            .filter((call) => call.body.type === 'text')
            .map((call) => String((call.body.text as { body: string }).body));
    }

    /** Interactive (button/list) sends. */
    get interactive(): Record<string, unknown>[] {
        return this.calls.filter((call) => call.body.type === 'interactive').map((call) => call.body.interactive as Record<string, unknown>);
    }

    fail(message: string | null): this {
        this.failing = message;
        return this;
    }

    reset(): void {
        this.calls.length = 0;
        this.nextId = 1;
        this.failing = null;
    }

    get fetch() {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!GRAPH_URL.test(url)) throw new Error(`mock whatsapp: unexpected fetch to ${url}`);
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            this.calls.push({ url, body });
            if (this.failing) {
                return new Response(JSON.stringify({ error: { message: this.failing, code: 131000 } }), { status: 400 });
            }
            if (body.status === 'read') return new Response(JSON.stringify({ success: true }), { status: 200 });
            const id = `wamid.mock${this.nextId++}`;
            return new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
        };
    }
}

export function installWhatsAppMock(): MockWhatsApp {
    const mock = new MockWhatsApp();
    whatsappTesting.setFetch(mock.fetch);
    return mock;
}

export function uninstallWhatsAppMock(): void {
    whatsappTesting.reset();
}

/** An inbound webhook body, shaped like Meta's. */
export function inboundWebhook(message: {
    id: string;
    from: string;
    text?: string;
    buttonReply?: { id: string; title: string };
    listReply?: { id: string; title: string };
}): Record<string, unknown> {
    const base: Record<string, unknown> = { id: message.id, from: message.from, timestamp: '1758600000' };
    if (message.text !== undefined) Object.assign(base, { type: 'text', text: { body: message.text } });
    if (message.buttonReply) Object.assign(base, { type: 'interactive', interactive: { type: 'button_reply', button_reply: message.buttonReply } });
    if (message.listReply) Object.assign(base, { type: 'interactive', interactive: { type: 'list_reply', list_reply: message.listReply } });
    return {
        object: 'whatsapp_business_account',
        entry: [{
            id: 'WABA_ID',
            changes: [{
                field: 'messages',
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { display_phone_number: '15550000000', phone_number_id: 'PNID' },
                    contacts: [{ wa_id: message.from, profile: { name: 'Test User' } }],
                    messages: [base],
                },
            }],
        }],
    };
}

export function signWhatsAppBody(rawBody: string, appSecret: string): string {
    return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}
