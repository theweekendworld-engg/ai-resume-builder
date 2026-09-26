import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { inboundWebhook, installWhatsAppMock, signWhatsAppBody, uninstallWhatsAppMock, type MockWhatsApp } from '@/__mocks__/whatsapp';
import {
    parseWhatsAppWebhook,
    readWhatsAppConfig,
    sendWhatsAppButtons,
    sendWhatsAppList,
    sendWhatsAppText,
    verifyWhatsAppHandshake,
    verifyWhatsAppSignature,
    whatsAppLinkDeepLink,
} from './whatsapp';

const SECRET = 'app-secret-for-tests';
const ENV = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_GRAPH_VERSION'];

describe('signature', () => {
    const raw = JSON.stringify(inboundWebhook({ id: 'wamid.1', from: '919999999999', text: 'hi' }));

    test('a correct HMAC of the raw body passes', () => {
        expect(verifyWhatsAppSignature(raw, signWhatsAppBody(raw, SECRET), SECRET)).toBe(true);
    });

    test('a different secret, a tampered body, a missing header or no secret all fail', () => {
        expect(verifyWhatsAppSignature(raw, signWhatsAppBody(raw, 'other'), SECRET)).toBe(false);
        expect(verifyWhatsAppSignature(`${raw} `, signWhatsAppBody(raw, SECRET), SECRET)).toBe(false);
        expect(verifyWhatsAppSignature(raw, null, SECRET)).toBe(false);
        expect(verifyWhatsAppSignature(raw, 'sha256=zz', SECRET)).toBe(false);
        expect(verifyWhatsAppSignature(raw, signWhatsAppBody(raw, ''), '')).toBe(false);
    });

    test('re-serialised JSON does not verify — the raw body is what is signed', () => {
        const pretty = JSON.stringify(JSON.parse(raw), null, 2);
        expect(verifyWhatsAppSignature(pretty, signWhatsAppBody(raw, SECRET), SECRET)).toBe(false);
    });
});

describe('handshake', () => {
    test('echoes the challenge only for subscribe + the right token', () => {
        const good = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' });
        expect(verifyWhatsAppHandshake(good, 'tok')).toBe('12345');
        expect(verifyWhatsAppHandshake(new URLSearchParams({ ...Object.fromEntries(good), 'hub.verify_token': 'nope' }), 'tok')).toBeNull();
        expect(verifyWhatsAppHandshake(new URLSearchParams({ ...Object.fromEntries(good), 'hub.mode': 'unsubscribe' }), 'tok')).toBeNull();
        expect(verifyWhatsAppHandshake(good, '')).toBeNull();
    });
});

describe('parsing inbound', () => {
    test('text, button replies and list replies; statuses ignored', () => {
        expect(parseWhatsAppWebhook(inboundWebhook({ id: 'a', from: '91', text: 'https://lnkd.in/x' }))[0]).toMatchObject({ id: 'a', from: '91', text: 'https://lnkd.in/x', replyId: null, profileName: 'Test User' });
        expect(parseWhatsAppWebhook(inboundWebhook({ id: 'b', from: '91', buttonReply: { id: 'sc:r:abcdefgh12', title: 'Refresh' } }))[0].replyId).toBe('sc:r:abcdefgh12');
        expect(parseWhatsAppWebhook(inboundWebhook({ id: 'c', from: '91', listReply: { id: 'sc:a:abcdefgh12:4', title: 'x' } }))[0].replyId).toBe('sc:a:abcdefgh12:4');
        const statusOnly = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid', status: 'read' }] } }] }] };
        expect(parseWhatsAppWebhook(statusOnly)).toEqual([]);
        expect(parseWhatsAppWebhook('garbage')).toEqual([]);
    });
});

describe('sending', () => {
    let mock: MockWhatsApp;
    beforeEach(() => {
        process.env.WHATSAPP_ACCESS_TOKEN = 'token';
        process.env.WHATSAPP_PHONE_NUMBER_ID = 'PNID';
        mock = installWhatsAppMock();
    });
    afterEach(() => {
        for (const key of ENV) delete process.env[key];
        uninstallWhatsAppMock();
    });

    test('unconfigured is the off switch: no network call', async () => {
        delete process.env.WHATSAPP_ACCESS_TOKEN;
        expect(readWhatsAppConfig()).toBeNull();
        const result = await sendWhatsAppText('91', 'hi');
        expect(result.ok).toBe(false);
        expect(mock.calls).toHaveLength(0);
    });

    test('text goes to the v25.0 messages endpoint and is capped at 4096', async () => {
        const result = await sendWhatsAppText('91', 'x'.repeat(5000));
        expect(result).toMatchObject({ ok: true, messageId: 'wamid.mock1' });
        expect(mock.calls[0].url).toBe('https://graph.facebook.com/v25.0/PNID/messages');
        expect(mock.calls[0].body.messaging_product).toBe('whatsapp');
        expect(mock.texts[0].length).toBe(4096);
    });

    test('buttons: at most 3, titles ≤ 20, body ≤ 1024', async () => {
        await sendWhatsAppButtons('91', 'b'.repeat(2000), [
            { id: '1', title: 'One' }, { id: '2', title: 'A title well over twenty chars' }, { id: '3', title: 'Three' }, { id: '4', title: 'Four' },
        ]);
        const interactive = mock.interactive[0] as { body: { text: string }; action: { buttons: { reply: { title: string } }[] } };
        expect(interactive.action.buttons).toHaveLength(3);
        for (const button of interactive.action.buttons) expect(button.reply.title.length).toBeLessThanOrEqual(20);
        expect(interactive.body.text.length).toBe(1024);
    });

    test('list: rows capped at 10 with ≤24-char titles', async () => {
        const rows = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: `Option number ${i} with a long title` }));
        await sendWhatsAppList('91', 'Pick', 'Choose', rows);
        const interactive = mock.interactive[0] as { action: { sections: { rows: { title: string }[] }[] } };
        expect(interactive.action.sections[0].rows).toHaveLength(10);
        for (const row of interactive.action.sections[0].rows) expect(row.title.length).toBeLessThanOrEqual(24);
    });

    test('an API error returns ok:false rather than throwing', async () => {
        mock.fail('Recipient not in allowed list');
        const result = await sendWhatsAppText('91', 'hi');
        expect(result).toMatchObject({ ok: false, error: 'Recipient not in allowed list' });
    });
});

test('deep link pre-fills the link command', () => {
    expect(whatsAppLinkDeepLink('+91 99999-99999', 'abc123')).toBe('https://wa.me/919999999999?text=link%20abc123');
    expect(whatsAppLinkDeepLink('', 'abc')).toBeNull();
});
