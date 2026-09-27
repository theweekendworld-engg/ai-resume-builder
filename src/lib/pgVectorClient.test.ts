/**
 * The pgvector store must behave like Qdrant for everything the app does.
 *
 * `src/__mocks__/qdrant.ts` is the reference: it is what every other test
 * trusts. So each case here runs the same operations against it and against
 * `PgVectorClient` on the real local Postgres, and requires the same answer.
 * A store that drifted from the reference would make the rest of the suite
 * prove things about a system production no longer runs.
 *
 * Uses its own collection name, and removes only that collection's rows: the
 * local database holds real development data.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { prisma } from '@/lib/prisma';
import { MockQdrantClient } from '@/__mocks__/qdrant';
import { Recorder } from '@/__mocks__/recorder';
import { PgVectorClient, UnsupportedVectorFilterError } from './pgVectorClient';

const COLLECTION = `contract_${process.pid}_${Date.now()}`;
const pg = new PgVectorClient().asQdrantClient();
const ref = new MockQdrantClient(new Recorder()).asQdrantClient();

const POINTS = [
    { id: '0a-alice-win', vector: [1, 0, 0, 0], payload: { userId: 'alice', type: 'win', sourceId: 'w1', sensitivity: 'shareable', tags: ['go', 'k8s'] } },
    { id: '0b-alice-win2', vector: [0.9, 0.1, 0, 0], payload: { userId: 'alice', type: 'win', sourceId: 'w2', sensitivity: 'confidential', tags: ['rust'] } },
    { id: '0c-alice-proj', vector: [0, 1, 0, 0], payload: { userId: 'alice', type: 'project', sourceId: 'p1', stars: 3 } },
    { id: '0d-bob-win', vector: [1, 0, 0, 0], payload: { userId: 'bob', type: 'win', sourceId: 'w3', sensitivity: 'shareable' } },
    { id: '0e-alice-exp', vector: [0.5, 0.5, 0.5, 0.5], payload: { userId: 'alice', type: 'experience', sourceId: 'e1' } },
];

async function both<T>(run: (client: QdrantClient) => Promise<T>): Promise<[T, T]> {
    return [await run(pg), await run(ref)];
}

const ids = (hits: { id: string | number }[]) => hits.map((hit) => String(hit.id));

beforeAll(async () => {
    for (const client of [pg, ref]) {
        await client.createCollection(COLLECTION, { vectors: { size: 4, distance: 'Cosine' } });
        await client.upsert(COLLECTION, { wait: true, points: POINTS });
    }
});

afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "VectorPoint" WHERE "collection" = ${COLLECTION}`;
    await prisma.$executeRaw`DELETE FROM "VectorCollection" WHERE "name" = ${COLLECTION}`;
});

describe('pgvector store matches the Qdrant reference', () => {
    test('lists and describes the collection', async () => {
        const [pgList] = await both((c) => c.getCollections());
        expect(pgList.collections.map((c) => c.name)).toContain(COLLECTION);
        const info = await pg.getCollection(COLLECTION);
        expect(info.points_count).toBe(POINTS.length);
        expect((info.config.params.vectors as { size: number }).size).toBe(4);
    });

    test('search scopes to one user and one type, ordered by cosine score', async () => {
        const filter = { must: [{ key: 'userId', match: { value: 'alice' } }, { key: 'type', match: { value: 'win' } }] };
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 5, filter }));
        expect(ids(a)).toEqual(ids(b));
        expect(ids(a)).toEqual(['0a-alice-win', '0b-alice-win2']);
        a.forEach((hit, i) => expect(hit.score).toBeCloseTo(b[i].score, 6));
        expect(a[0].payload).toEqual(b[0].payload);
    });

    test('never returns another user\'s points', async () => {
        const filter = { must: [{ key: 'userId', match: { value: 'bob' } }] };
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 10, filter }));
        expect(ids(a)).toEqual(['0d-bob-win']);
        expect(ids(a)).toEqual(ids(b));
    });

    test('the sensitivity clause (rule 3) excludes a confidential Win', async () => {
        const filter = {
            must: [
                { key: 'userId', match: { value: 'alice' } },
                { key: 'type', match: { value: 'win' } },
                { key: 'sensitivity', match: { value: 'shareable' } },
            ],
        };
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 10, filter }));
        expect(ids(a)).toEqual(['0a-alice-win']);
        expect(ids(a)).toEqual(ids(b));
    });

    test('must_not, should, match.any, array payload keys and has_id', async () => {
        const filters = [
            { must_not: [{ key: 'type', match: { value: 'win' } }] },
            { should: [{ key: 'type', match: { value: 'project' } }, { key: 'type', match: { value: 'experience' } }] },
            { must: [{ key: 'type', match: { any: ['project', 'experience'] } }] },
            { must: [{ key: 'tags', match: { value: 'k8s' } }] },
            { must: [{ key: 'stars', match: { value: 3 } }] },
            { must: [{ has_id: ['0c-alice-proj', '0d-bob-win'] }] },
            { must: [{ must_not: [{ key: 'userId', match: { value: 'alice' } }] }] },
        ];
        for (const filter of filters) {
            const [a, b] = await both((c) => c.search(COLLECTION, { vector: [0.5, 0.5, 0, 0], limit: 10, filter }));
            expect({ filter, ids: ids(a).sort() }).toEqual({ filter, ids: ids(b).sort() });
        }
    });

    test('score_threshold and offset', async () => {
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 10, score_threshold: 0.9 }));
        expect(ids(a).sort()).toEqual(ids(b).sort());
        const [p1, r1] = await both((c) => c.search(COLLECTION, { vector: [0, 1, 0, 0], limit: 2, offset: 1 }));
        expect(ids(p1)).toEqual(ids(r1));
    });

    test('scroll pages by point id with a projected payload', async () => {
        const collect = async (client: QdrantClient) => {
            const out: { id: string; payload: unknown }[] = [];
            let offset: string | number | null | undefined;
            for (let guard = 0; guard < 10; guard += 1) {
                const page = await client.scroll(COLLECTION, {
                    filter: { must: [{ key: 'type', match: { value: 'win' } }] },
                    limit: 2,
                    offset: offset ?? undefined,
                    with_payload: { include: ['sourceId'] },
                    with_vector: false,
                });
                out.push(...page.points.map((p) => ({ id: String(p.id), payload: p.payload })));
                offset = page.next_page_offset as string | null;
                if (!offset) break;
            }
            return out;
        };
        const [a, b] = await both(collect);
        expect(a).toEqual(b);
        expect(a.map((p) => p.id)).toEqual(['0a-alice-win', '0b-alice-win2', '0d-bob-win']);
        expect(a[0].payload).toEqual({ sourceId: 'w1' });
    });

    test('upsert replaces a point in place', async () => {
        const updated = { id: '0c-alice-proj', vector: [0, 0, 1, 0], payload: { userId: 'alice', type: 'project', sourceId: 'p1', stars: 4 } };
        await both((c) => c.upsert(COLLECTION, { wait: true, points: [updated] }));
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [0, 0, 1, 0], limit: 1 }));
        expect(ids(a)).toEqual(['0c-alice-proj']);
        expect(a[0].payload).toEqual(b[0].payload);
        expect(a[0].score).toBeCloseTo(1, 6);
    });

    test('delete by id and by filter', async () => {
        await both((c) => c.delete(COLLECTION, { wait: true, points: ['0e-alice-exp'] }));
        await both((c) => c.delete(COLLECTION, { wait: true, filter: { must: [{ key: 'userId', match: { value: 'bob' } }] } }));
        const [a, b] = await both((c) => c.search(COLLECTION, { vector: [1, 1, 1, 1], limit: 10 }));
        expect(ids(a).sort()).toEqual(ids(b).sort());
        expect(ids(a)).not.toContain('0e-alice-exp');
        expect(ids(a)).not.toContain('0d-bob-win');
    });

    test('rejects a vector of the wrong dimension, as Qdrant does', async () => {
        const bad = { id: 'bad', vector: [1, 0, 0], payload: { userId: 'alice' } };
        await expect(pg.upsert(COLLECTION, { wait: true, points: [bad] })).rejects.toThrow(/dimension/);
        await expect(ref.upsert(COLLECTION, { wait: true, points: [bad] })).rejects.toThrow(/dimension/);
    });

    test('an unknown filter throws instead of being dropped', async () => {
        const filter = { must: [{ key: 'userId', range: { gte: 1 } }] };
        await expect(pg.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 5, filter })).rejects.toBeInstanceOf(
            UnsupportedVectorFilterError,
        );
        const dotted = { must: [{ key: 'a.b', match: { value: 'x' } }] };
        await expect(pg.search(COLLECTION, { vector: [1, 0, 0, 0], limit: 5, filter: dotted })).rejects.toBeInstanceOf(
            UnsupportedVectorFilterError,
        );
    });

    test('a missing collection reads as missing, not as a crash', async () => {
        await expect(pg.getCollection('no_such_collection_here')).rejects.toThrow(/doesn't exist/);
        await expect(pg.search('no_such_collection_here', { vector: [1, 0, 0, 0], limit: 1 })).rejects.toThrow(/doesn't exist/);
    });
});
