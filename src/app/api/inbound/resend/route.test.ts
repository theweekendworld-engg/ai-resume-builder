import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac, randomBytes } from 'node:crypto';
import { __testing, type ResendReceivedEmail } from '@/lib/journey/inboundResend';
import { POST } from './route';

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString('base64')}`;
const saved = { secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET, key: process.env.RESEND_API_KEY };

beforeEach(() => {
    process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
    process.env.RESEND_API_KEY = 're_test_dummy';
});
afterEach(() => {
    __testing.setFetcher(null);
    for (const [name, value] of [['RESEND_INBOUND_WEBHOOK_SECRET', saved.secret], ['RESEND_API_KEY', saved.key]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

function signed(body: string, key: Buffer = KEY): Request {
    const id = 'msg_test';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
    return new Request('https://www.patronus.cv/api/inbound/resend', {
        method: 'POST',
        headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
        body,
    });
}

const received = (emailId = 'em_1') => JSON.stringify({ type: 'email.received', created_at: '2026-11-09T10:00:00.000Z', data: { email_id: emailId } });

const unroutableEmail: ResendReceivedEmail = {
    object: 'email', id: 'em_1', to: ['nobody@example.com'], from: 'a@acme.com', created_at: '2026-11-09T10:00:00.000Z',
    subject: 'hello', bcc: null, cc: null, reply_to: null, received_for: ['nobody@example.com'], html: null, text: 'hi',
    headers: null, message_id: '<m@acme.com>', attachments: [],
};

describe('/api/inbound/resend', () => {
    test('closed when the signing secret or API key is missing', async () => {
        delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;
        expect((await POST(signed(received()))).status).toBe(503);
        process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
        delete process.env.RESEND_API_KEY;
        expect((await POST(signed(received()))).status).toBe(503);
    });

    test('refuses an unsigned or wrongly signed request', async () => {
        const unsigned = new Request('https://www.patronus.cv/api/inbound/resend', { method: 'POST', body: received() });
        expect((await POST(unsigned)).status).toBe(401);
        expect((await POST(signed(received(), randomBytes(24)))).status).toBe(401);
    });

    test('other event types are acknowledged and ignored', async () => {
        let fetched = false;
        __testing.setFetcher(async () => { fetched = true; return unroutableEmail; });
        const response = await POST(signed(JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } })));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, status: 'ignored' });
        expect(fetched).toBe(false);
    });

    test('fetches the body by id and hands it to the parser', async () => {
        const ids: string[] = [];
        __testing.setFetcher(async (id) => { ids.push(id); return unroutableEmail; });
        const response = await POST(signed(received('em_42')));
        expect(ids).toEqual(['em_42']);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, status: 'unroutable' });
    });

    test('a failed fetch is a 502 so Resend retries', async () => {
        __testing.setFetcher(async () => { throw new Error('boom'); });
        expect((await POST(signed(received()))).status).toBe(502);
    });
});
