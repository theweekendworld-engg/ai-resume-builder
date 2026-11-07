/**
 * The webhook's contract with Telegram: answer fast, work after the response.
 *
 * Before, the work was awaited; a throw became a 500, Telegram redelivered,
 * the receipt made the retry a silent 200, and the user heard nothing. These
 * pin the new order: secret, digest fast path, 200, then the scheduled work.
 */

import { describe, expect, test } from 'bun:test';
import type { TelegramUpdatePayload } from '@/services/telegramAgent';
import { handleTelegramWebhook, type TelegramWebhookDeps } from './handler';

type Calls = { processed: TelegramUpdatePayload[]; answered: string[]; digests: unknown[]; scheduled: Array<() => Promise<void>> };

function deps(over: Partial<TelegramWebhookDeps> = {}): TelegramWebhookDeps & { calls: Calls } {
    const calls: Calls = { processed: [], answered: [], digests: [], scheduled: [] };
    return {
        calls,
        verifySecret: (value) => value === 'right',
        schedule: (work) => {
            calls.scheduled.push(work);
        },
        process: async (update) => {
            calls.processed.push(update);
            return 'handled';
        },
        handleDigest: async (input) => {
            calls.digests.push(input);
            return { handled: true, outcome: 'applied', notice: 'Confirmed.' };
        },
        answerCallback: async (id) => {
            calls.answered.push(id);
        },
        ...over,
    };
}

const textUpdate = { update_id: 77, message: { message_id: 5, text: 'https://www.linkedin.com/jobs/view/1', chat: { id: 42, type: 'private' } } };

async function runScheduled(calls: Calls): Promise<void> {
    for (const work of calls.scheduled) await work();
}

describe('telegram webhook', () => {
    test('a wrong or missing secret is a 401, and nothing is scheduled', async () => {
        for (const secret of [null, 'wrong']) {
            const d = deps();
            const response = await handleTelegramWebhook({ body: textUpdate, secret }, d);
            expect(response.status).toBe(401);
            expect(d.calls.scheduled).toHaveLength(0);
        }
    });

    test('a message is acknowledged before it is processed', async () => {
        const d = deps();
        const response = await handleTelegramWebhook({ body: textUpdate, secret: 'right' }, d);
        expect(response).toEqual({ status: 200, body: { ok: true } });
        // Nothing ran inside the request: the work waits for the response.
        expect(d.calls.processed).toHaveLength(0);
        expect(d.calls.scheduled).toHaveLength(1);

        await runScheduled(d.calls);
        expect(d.calls.processed).toEqual([textUpdate]);
    });

    test('a button tap is answered, then processed, both after the response', async () => {
        const d = deps();
        const tap = { update_id: 78, callback_query: { id: 'cb1', data: 'sc:r:run1', message: { message_id: 9, chat: { id: 42, type: 'private' } } } };
        await handleTelegramWebhook({ body: tap, secret: 'right' }, d);
        expect(d.calls.answered).toEqual([]);
        await runScheduled(d.calls);
        expect(d.calls.answered).toEqual(['cb1']);
        expect(d.calls.processed).toHaveLength(1);
    });

    test('digest taps stay on the fast path: handled inline, answered, never scheduled', async () => {
        const d = deps();
        const tap = { update_id: 79, callback_query: { id: 'cb2', data: 'd:c1:dig1', message: { message_id: 12, chat: { id: 42 } } } };
        const response = await handleTelegramWebhook({ body: tap, secret: 'right' }, d);
        expect(response).toEqual({ status: 200, body: { ok: true, digest: 'applied' } });
        expect(d.calls.digests).toEqual([{ data: 'd:c1:dig1', chatId: '42', messageId: 12 }]);
        expect(d.calls.answered).toEqual(['cb2']);
        expect(d.calls.scheduled).toHaveLength(0);
    });

    test('a `d:` tap the digest does not own goes on to the agent', async () => {
        const d = deps({ handleDigest: async () => ({ handled: false }) });
        const tap = { update_id: 80, callback_query: { id: 'cb3', data: 'd:unknown', message: { message_id: 1, chat: { id: 42 } } } };
        await handleTelegramWebhook({ body: tap, secret: 'right' }, d);
        expect(d.calls.scheduled).toHaveLength(1);
    });

    test('a digest failure is a 500 without the error text, so Telegram retries it', async () => {
        const d = deps({ handleDigest: async () => { throw new Error('connection refused at db.internal:5432'); } });
        const tap = { update_id: 81, callback_query: { id: 'cb4', data: 'd:c1:dig1', message: { message_id: 12, chat: { id: 42 } } } };
        const response = await handleTelegramWebhook({ body: tap, secret: 'right' }, d);
        expect(response).toEqual({ status: 500, body: { ok: false } });
    });

    test('a body that is not an update is a 200 with nothing to do', async () => {
        const d = deps();
        const response = await handleTelegramWebhook({ body: { hello: 'world', message: { text: 'no chat' } }, secret: 'right' }, d);
        expect(response.status).toBe(200);
        expect(d.calls.scheduled).toHaveLength(0);
    });

    test('scheduled work never rejects, even if processing throws', async () => {
        const d = deps({ process: async () => { throw new Error('boom'); } });
        await handleTelegramWebhook({ body: textUpdate, secret: 'right' }, d);
        await expect(runScheduled(d.calls)).resolves.toBeUndefined();
    });
});
