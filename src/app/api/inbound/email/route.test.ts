import { afterEach, describe, expect, test } from 'bun:test';
import { POST } from './route';

const SECRET = process.env.INBOUND_EMAIL_SECRET;
afterEach(() => {
    if (SECRET === undefined) delete process.env.INBOUND_EMAIL_SECRET;
    else process.env.INBOUND_EMAIL_SECRET = SECRET;
});

const post = (headers: Record<string, string> = {}, query = '', body = '{}') =>
    POST(new Request(`https://www.patronus.cv/api/inbound/email${query}`, { method: 'POST', headers, body }));

describe('/api/inbound/email auth', () => {
    test('closed when no secret is configured', async () => {
        delete process.env.INBOUND_EMAIL_SECRET;
        expect((await post()).status).toBe(503);
    });

    test('refuses a missing or wrong secret', async () => {
        process.env.INBOUND_EMAIL_SECRET = 's3cret-value';
        expect((await post()).status).toBe(401);
        expect((await post({}, '?secret=nope')).status).toBe(401);
        expect((await post({ authorization: `Basic ${Buffer.from('inbound:nope').toString('base64')}` })).status).toBe(401);
    });

    test('accepts the secret as basic auth or a query param; unroutable mail is a quiet 200', async () => {
        process.env.INBOUND_EMAIL_SECRET = 's3cret-value';
        const basic = await post({ authorization: `Basic ${Buffer.from('inbound:s3cret-value').toString('base64')}` }, '', JSON.stringify({ To: 'nobody@example.com' }));
        expect(basic.status).toBe(200);
        expect(await basic.json()).toEqual({ ok: true, status: 'unroutable' });
        expect((await post({}, '?secret=s3cret-value', 'not json')).status).toBe(400);
    });
});
