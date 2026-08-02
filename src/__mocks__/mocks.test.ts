/**
 * The mocks, tested.
 *
 * A mock layer is only worth having if it is itself correct — and two pieces
 * here carry real logic rather than canned answers:
 *
 *   1. **The Qdrant filter engine.** ADR-8 enforces sensitivity as a query
 *      concern, and the vector half of that rule is a `must` clause. If this
 *      mock ignored filters, "a confidential Win never reaches an external
 *      artifact" would pass whether or not the filter was ever constructed —
 *      the most important test in the product, made vacuous. So the filter is
 *      tested against the same semantics the server implements, including the
 *      one that fails closed on a condition the mock does not understand.
 *
 *   2. **The Stripe signature check.** A mock that accepted any signature would
 *      leave the webhook route's only security control untested.
 *
 * Everything else asserted here is the determinism contract: same input, same
 * bytes, every run.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { WinSensitivity } from '@prisma/client';
import { qdrantExternalFilter } from '@/lib/graph/visibility';
import { sendTelegramMessage } from '@/lib/telegram';
import {
    GithubBudgetExhaustedError,
    GithubRateLimitError,
} from '@/lib/capture/github/client';
import {
    MockGithubApi,
    MockOpenAI,
    MockQdrantClient,
    MockStripe,
    Recorder,
    deterministicVector,
    installMocks,
    uninstallMocks,
} from '.';

const COLLECTION = 'knowledge_base';
const SIZE = 8;

function store(): MockQdrantClient {
    return new MockQdrantClient(new Recorder());
}

/** A payload shaped like the one the embed handler writes for a Win. */
function winPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        userId: 'user-1',
        type: 'win',
        sensitivity: WinSensitivity.shareable,
        sourceId: 'win-1',
        tags: ['pricing', 'latency'],
        ...overrides,
    };
}

async function seedThree(client: MockQdrantClient): Promise<void> {
    await client.createCollection(COLLECTION, { vectors: { size: SIZE, distance: 'Cosine' } });
    client.seed(COLLECTION, {
        id: 'p-shareable',
        vector: deterministicVector('shareable', SIZE),
        payload: winPayload({ sourceId: 'win-shareable' }),
    });
    client.seed(COLLECTION, {
        id: 'p-internal',
        vector: deterministicVector('internal', SIZE),
        payload: winPayload({ sourceId: 'win-internal', sensitivity: WinSensitivity.internal_only }),
    });
    client.seed(COLLECTION, {
        id: 'p-confidential',
        vector: deterministicVector('confidential', SIZE),
        payload: winPayload({ sourceId: 'win-confidential', sensitivity: WinSensitivity.confidential }),
    });
}

// ═════════════════════════════════════════════════════ Qdrant filter semantics

describe('MockQdrantClient — ADR-8 is actually enforced', () => {
    test('the external filter returns only the shareable point', async () => {
        const client = store();
        await seedThree(client);

        // The real filter from the real module — not a hand-written copy.
        const results = await client.search(COLLECTION, {
            vector: deterministicVector('query', SIZE),
            limit: 10,
            filter: qdrantExternalFilter('user-1'),
        });

        expect(results).toHaveLength(1);
        expect(results[0].payload?.sourceId).toBe('win-shareable');
    });

    test('a filter that is dropped altogether would return all three', async () => {
        // The control for the test above: proves the assertion above is about
        // the filter working, not about there being only one point.
        const client = store();
        await seedThree(client);

        const results = await client.search(COLLECTION, {
            vector: deterministicVector('query', SIZE),
            limit: 10,
        });

        expect(results).toHaveLength(3);
    });

    test('another user is never reachable', async () => {
        const client = store();
        await seedThree(client);

        const results = await client.search(COLLECTION, {
            vector: deterministicVector('query', SIZE),
            limit: 10,
            filter: qdrantExternalFilter('user-2'),
        });

        expect(results).toHaveLength(0);
    });
});

describe('MockQdrantClient — filter operators', () => {
    let client: MockQdrantClient;

    beforeEach(async () => {
        client = store();
        await seedThree(client);
    });

    async function ids(filter: unknown): Promise<string[]> {
        const results = await client.search(COLLECTION, {
            vector: deterministicVector('query', SIZE),
            limit: 10,
            filter: filter as never,
        });
        return results.map((entry) => String(entry.id)).sort();
    }

    test('must — every condition has to hold', async () => {
        expect(
            await ids({
                must: [
                    { key: 'userId', match: { value: 'user-1' } },
                    { key: 'sensitivity', match: { value: 'confidential' } },
                ],
            }),
        ).toEqual(['p-confidential']);

        expect(
            await ids({
                must: [
                    { key: 'userId', match: { value: 'nobody' } },
                    { key: 'sensitivity', match: { value: 'confidential' } },
                ],
            }),
        ).toEqual([]);
    });

    test('must_not — any hit excludes the point', async () => {
        expect(
            await ids({ must_not: [{ key: 'sensitivity', match: { value: 'confidential' } }] }),
        ).toEqual(['p-internal', 'p-shareable']);
    });

    test('should — at least one has to hold', async () => {
        expect(
            await ids({
                should: [
                    { key: 'sensitivity', match: { value: 'shareable' } },
                    { key: 'sensitivity', match: { value: 'internal_only' } },
                ],
            }),
        ).toEqual(['p-internal', 'p-shareable']);
    });

    test('match.any is a set membership test', async () => {
        expect(
            await ids({
                must: [{ key: 'sensitivity', match: { any: ['shareable', 'confidential'] } }],
            }),
        ).toEqual(['p-confidential', 'p-shareable']);
    });

    test('match.except is its complement', async () => {
        expect(
            await ids({ must: [{ key: 'sensitivity', match: { except: ['confidential'] } }] }),
        ).toEqual(['p-internal', 'p-shareable']);
    });

    test('a condition on an array key matches when ANY element matches', async () => {
        expect(await ids({ must: [{ key: 'tags', match: { value: 'latency' } }] })).toHaveLength(3);
        expect(await ids({ must: [{ key: 'tags', match: { value: 'absent' } }] })).toHaveLength(0);
    });

    test('has_id selects by point id', async () => {
        expect(await ids({ must: [{ has_id: ['p-internal'] }] })).toEqual(['p-internal']);
    });

    test('a nested sub-filter composes', async () => {
        expect(
            await ids({
                must: [
                    { key: 'type', match: { value: 'win' } },
                    { should: [{ key: 'sensitivity', match: { value: 'shareable' } }] },
                ],
            }),
        ).toEqual(['p-shareable']);
    });

    test('an unrecognised condition fails CLOSED', async () => {
        // The safety property. A filter this mock cannot interpret must exclude
        // the point, because the alternative is a mock that leaks confidential
        // content the moment someone uses an operator it has not learned yet.
        expect(await ids({ must: [{ key: 'sensitivity', geo_radius: {} }] })).toEqual([]);
    });
});

describe('MockQdrantClient — storage behaviour', () => {
    test('scroll pages by point id and reports the next offset', async () => {
        const client = store();
        await client.createCollection(COLLECTION, { vectors: { size: SIZE, distance: 'Cosine' } });
        for (const index of [1, 2, 3, 4, 5]) {
            client.seed(COLLECTION, {
                id: `p-${index}`,
                vector: deterministicVector(`v${index}`, SIZE),
                payload: { type: 'win', sourceId: `win-${index}` },
            });
        }

        const first = await client.scroll(COLLECTION, {
            filter: { must: [{ key: 'type', match: { value: 'win' } }] },
            limit: 2,
            with_payload: { include: ['sourceId'] },
            with_vector: false,
        });

        expect(first.points.map((point) => String(point.id))).toEqual(['p-1', 'p-2']);
        expect(first.next_page_offset).toBe('p-3');
        // `with_payload.include` really projects.
        expect(first.points[0].payload).toEqual({ sourceId: 'win-1' });

        const second = await client.scroll(COLLECTION, {
            filter: { must: [{ key: 'type', match: { value: 'win' } }] },
            limit: 2,
            offset: first.next_page_offset ?? undefined,
        });
        expect(second.points.map((point) => String(point.id))).toEqual(['p-3', 'p-4']);
    });

    test('search orders by cosine similarity and honours limit', async () => {
        const client = store();
        await client.createCollection(COLLECTION, { vectors: { size: SIZE, distance: 'Cosine' } });
        const target = deterministicVector('target', SIZE);
        client.seed(COLLECTION, { id: 'exact', vector: target, payload: { type: 'win' } });
        client.seed(COLLECTION, {
            id: 'other',
            vector: deterministicVector('other', SIZE),
            payload: { type: 'win' },
        });

        const results = await client.search(COLLECTION, { vector: target, limit: 1 });
        expect(results).toHaveLength(1);
        expect(String(results[0].id)).toBe('exact');
        expect(results[0].score).toBeCloseTo(1, 6);
    });

    test('upsert replaces by id, and delete removes', async () => {
        const client = store();
        await client.createCollection(COLLECTION, { vectors: { size: SIZE, distance: 'Cosine' } });
        const vector = deterministicVector('a', SIZE);

        await client.upsert(COLLECTION, { wait: true, points: [{ id: 'p', vector, payload: { n: 1 } }] });
        await client.upsert(COLLECTION, { wait: true, points: [{ id: 'p', vector, payload: { n: 2 } }] });
        expect(client.pointCount(COLLECTION)).toBe(1);
        expect(client.points(COLLECTION)[0].payload.n).toBe(2);

        await client.delete(COLLECTION, { wait: true, points: ['p'] });
        expect(client.pointCount(COLLECTION)).toBe(0);
    });

    test('a dimension mismatch is rejected, exactly as the server rejects it', async () => {
        const client = store();
        await client.createCollection(COLLECTION, { vectors: { size: SIZE, distance: 'Cosine' } });
        await expect(
            client.upsert(COLLECTION, { wait: true, points: [{ id: 'p', vector: [1, 2], payload: {} }] }),
        ).rejects.toThrow(/dimension/i);
    });
});

// ═══════════════════════════════════════════════════════════════ determinism

describe('determinism', () => {
    test('the same text always embeds to the same vector', () => {
        expect(deterministicVector('hello', 16)).toEqual(deterministicVector('hello', 16));
        expect(deterministicVector('hello', 16)).not.toEqual(deterministicVector('hell0', 16));
    });

    test('vectors are unit length, so cosine scores are comparable', () => {
        const vector = deterministicVector('anything', 32);
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        expect(norm).toBeCloseTo(1, 10);
    });

    test('the drafter is keyed by prompt — and a changed prompt changes the draft', () => {
        const openai = new MockOpenAI(new Recorder(), 8);
        const schema = z.object({ title: z.string(), category: z.enum(['shipped', 'improved']) });

        const a = openai.draft(schema, 'seed-one');
        const b = openai.draft(schema, 'seed-one');
        const c = openai.draft(schema, 'seed-two');

        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
        // Whatever it produces must satisfy the schema the caller asked for,
        // because `generateStructured` validates for real on top of this.
        expect(schema.safeParse(a).success).toBe(true);
    });

    test('scripted responses win over the synthesized default, and calls are recorded', async () => {
        const recorder = new Recorder();
        const openai = new MockOpenAI(recorder, 8);
        const schema = z.object({ title: z.string() });
        openai.onObject('draft a win', { object: { title: 'Batched the pricing lookup' } });

        const result = await openai.objectRunner({
            model: 'gpt-5-mini',
            schema,
            system: 'You draft a win.',
            prompt: 'draft a win from this signal',
        });

        expect(result.object).toEqual({ title: 'Batched the pricing lookup' });
        expect(openai.objectCalls).toHaveLength(1);
        expect(openai.objectCalls[0].model).toBe('gpt-5-mini');
    });

    test('embeddings record the call and return the configured dimension', async () => {
        const recorder = new Recorder();
        const openai = new MockOpenAI(recorder, 8);

        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: 'a win about pricing',
        });

        expect(response.data[0].embedding).toHaveLength(8);
        expect(openai.embeddingCalls).toHaveLength(1);
        expect(openai.embeddingCalls[0].input).toEqual(['a win about pricing']);
    });
});

// ═══════════════════════════════════════════════════════ Stripe signatures

describe('MockStripe — webhook signatures are really verified', () => {
    test('a signature it produced is accepted', () => {
        const stripe = new MockStripe(new Recorder());
        const { payload, signature } = stripe.event('customer.subscription.updated', { id: 'sub_1' });

        const event = stripe.webhooks.constructEvent(payload, signature, stripe.webhookSecret);
        expect(event.type).toBe('customer.subscription.updated');
    });

    test('a tampered body is rejected', () => {
        const stripe = new MockStripe(new Recorder());
        const { payload, signature } = stripe.event('customer.subscription.deleted', { id: 'sub_1' });
        const tampered = payload.replace('sub_1', 'sub_2');

        expect(() => stripe.webhooks.constructEvent(tampered, signature, stripe.webhookSecret)).toThrow(
            /No signatures found/,
        );
    });

    test('the wrong secret is rejected', () => {
        const stripe = new MockStripe(new Recorder());
        const { payload, signature } = stripe.event('invoice.paid', { id: 'in_1' });

        expect(() => stripe.webhooks.constructEvent(payload, signature, 'whsec_wrong')).toThrow(
            /No signatures found/,
        );
    });

    test('subscription state survives an update, so cancel-at-period-end is observable', async () => {
        const stripe = new MockStripe(new Recorder());
        stripe.seedSubscription({ id: 'sub_1', customer: 'cus_1', priceId: 'price_career' });

        await stripe.subscriptions.update('sub_1', { cancel_at_period_end: true });
        const after = await stripe.subscriptions.retrieve('sub_1');

        expect(after.cancel_at_period_end).toBe(true);
        // Still active to Stripe — which is exactly why `localSubscriptionStatus`
        // exists, and why a mock that dropped the update would hide the bug.
        expect(after.status).toBe('active');
        expect(stripe.callsTo('subscriptions.update')).toHaveLength(1);
    });
});

// ═════════════════════════════════════════════════════════ GitHub budget

describe('MockGithubApi — the budget contract is reproduced', () => {
    test('spending past the budget raises, so a runaway loop cannot pass', async () => {
        const api = new MockGithubApi(new Recorder(), {}, { maxRequests: 2 });

        await api.searchIssues('is:merged', 1, 10);
        await api.searchIssues('is:merged', 2, 10);

        expect(api.requestsUsed()).toBe(2);
        await expect(api.searchIssues('is:merged', 3, 10)).rejects.toBeInstanceOf(
            GithubBudgetExhaustedError,
        );
    });

    test('a rate limit is a resumable partial, not a crash', async () => {
        const api = new MockGithubApi(new Recorder(), {}, { rateLimitAfter: 1, rateLimitStatus: 429 });

        await api.searchIssues('is:merged', 1, 10);
        await expect(api.searchIssues('is:merged', 2, 10)).rejects.toBeInstanceOf(GithubRateLimitError);
    });

    test('search paginates the seeded corpus', async () => {
        const items = Array.from({ length: 3 }, (_unused, index) => ({
            nodeId: `node-${index}`,
            number: index,
            title: `PR ${index}`,
            body: '',
            htmlUrl: '',
            repo: 'acme/api',
            labels: [],
            authorLogin: 'ada',
            authorType: 'User' as const,
            createdAt: '2026-07-01T00:00:00Z',
            closedAt: null,
            pullRequestMergedAt: '2026-07-02T00:00:00Z',
            isPullRequest: true,
            commentCount: 0,
        }));
        const api = new MockGithubApi(new Recorder(), { merged: items }, { pageSize: 2 });

        const first = await api.searchIssues('is:merged', 1, 2);
        const second = await api.searchIssues('is:merged', 2, 2);

        expect(first.items.map((item) => item.nodeId)).toEqual(['node-0', 'node-1']);
        expect(second.items.map((item) => item.nodeId)).toEqual(['node-2']);
        expect(first.totalCount).toBe(3);
    });
});

// ══════════════════════════════════════════════════ Telegram, module for real

describe('MockTelegram — the real sendTelegramMessage runs on top of it', () => {
    const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    const mocks = installMocks({ only: ['telegram'] });

    afterAll(() => {
        uninstallMocks();
        process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
    });

    test('the request body the module builds is what gets recorded', async () => {
        mocks.telegram.reset();

        await sendTelegramMessage({
            chatId: 'chat-1',
            text: 'You shipped 3 things',
            replyMarkup: { inline_keyboard: [[{ text: '✓ Log it', callback_data: 'd:c0:1' }]] },
        });

        expect(mocks.telegram.messages).toHaveLength(1);
        const [message] = mocks.telegram.messages;
        expect(message.method).toBe('sendMessage');
        expect(message.chatId).toBe('chat-1');
        expect(message.text).toBe('You shipped 3 things');
        // Built by the real module, not by the test: proof the module ran.
        expect(message.body.parse_mode).toBe('Markdown');
        expect(message.body.disable_web_page_preview).toBe(true);
    });

    test('a provider error makes the real module throw, as its contract says', async () => {
        mocks.telegram.reset();
        mocks.telegram.setOutcome('sendMessage', { kind: 'api_error', description: 'chat not found' });

        await expect(sendTelegramMessage({ chatId: 'gone', text: 'hi' })).rejects.toThrow(
            /chat not found/,
        );
    });
});
