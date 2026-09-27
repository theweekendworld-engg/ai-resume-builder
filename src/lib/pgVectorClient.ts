/**
 * The vector store, in Postgres (pgvector), behind the Qdrant client surface.
 *
 * Production ran on Qdrant Cloud until 2026-09-27, when the free cluster was
 * suspended for inactivity: every semantic search failed with "fetch failed",
 * and every Win confirmed after that sat in the queue unembedded. The data is
 * a few hundred points per user and already lives next to its rows, so it now
 * lives in the same database. One store is one thing that can be down.
 *
 * It implements the eight `QdrantClient` methods the app calls, with the same
 * shapes, so `src/lib/embeddings.ts` and every test double stay as they are.
 * `src/__mocks__/qdrant.ts` is the reference semantics, and
 * `pgVectorClient.test.ts` runs the same operations against both.
 *
 * Filters support what the app uses: `must` / `should` / `must_not`, nested
 * filters, `has_id`, `match.value` and `match.any`, on top-level payload keys.
 * Anything else THROWS. Silently dropping a condition could return another
 * user's points or a confidential Win, so an unknown filter is a bug to see,
 * not a clause to skip.
 */

import { Prisma } from '@prisma/client';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { prisma } from '@/lib/prisma';

type Payload = Record<string, unknown>;
type PointId = string | number;

/** Payload keys copied into indexed columns; filters on these use the column. */
const COLUMN_KEYS = { userId: '"userId"', type: '"type"', sourceId: '"sourceId"' } as const;

export class UnsupportedVectorFilterError extends Error {
    constructor(detail: string) {
        super(`pgvector store: unsupported filter (${detail})`);
        this.name = 'UnsupportedVectorFilterError';
    }
}

// ───────────────────────────────────────────────────────────── helpers

function vectorLiteral(vector: unknown): string {
    if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('pgvector store: a point needs a non-empty vector');
    }
    const values = vector.map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
        throw new Error('pgvector store: vector contains a non-finite value');
    }
    return `[${values.join(',')}]`;
}

function asConditions(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function keyExpression(key: string, value: unknown): Prisma.Sql {
    if (key in COLUMN_KEYS) {
        return Prisma.sql`${Prisma.raw(COLUMN_KEYS[key as keyof typeof COLUMN_KEYS])} = ${String(value)}`;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new UnsupportedVectorFilterError(`key "${key}"`);
    }
    // `@>` on jsonb: a scalar contains itself, and an array contains any of its
    // elements, which is Qdrant's "any element matches" rule for array keys.
    return Prisma.sql`("payload" -> ${key}) @> ${JSON.stringify(value)}::jsonb`;
}

function conditionSql(condition: unknown): Prisma.Sql {
    if (!condition || typeof condition !== 'object') throw new UnsupportedVectorFilterError('empty condition');
    const entry = condition as Record<string, unknown>;

    if ('must' in entry || 'should' in entry || 'must_not' in entry) return filterSql(entry);

    if ('has_id' in entry) {
        const ids = (Array.isArray(entry.has_id) ? entry.has_id : []).map(String);
        if (ids.length === 0) return Prisma.sql`FALSE`;
        return Prisma.sql`"id" IN (${Prisma.join(ids)})`;
    }

    const key = typeof entry.key === 'string' ? entry.key : null;
    const match = entry.match as Record<string, unknown> | undefined;
    if (!key || !match || typeof match !== 'object') {
        throw new UnsupportedVectorFilterError(JSON.stringify(entry).slice(0, 120));
    }
    if ('value' in match) return keyExpression(key, match.value);
    if ('any' in match) {
        const any = Array.isArray(match.any) ? match.any : [];
        if (any.length === 0) return Prisma.sql`FALSE`;
        return Prisma.sql`(${Prisma.join(any.map((value) => keyExpression(key, value)), ' OR ')})`;
    }
    throw new UnsupportedVectorFilterError(`match ${JSON.stringify(match).slice(0, 80)}`);
}

export function filterSql(filter: unknown): Prisma.Sql {
    if (!filter || typeof filter !== 'object') return Prisma.sql`TRUE`;
    const entry = filter as Record<string, unknown>;
    const parts: Prisma.Sql[] = [];

    const must = asConditions(entry.must);
    const should = asConditions(entry.should);
    const mustNot = asConditions(entry.must_not);

    for (const condition of must) parts.push(conditionSql(condition));
    for (const condition of mustNot) parts.push(Prisma.sql`NOT (${conditionSql(condition)})`);
    if (should.length > 0) parts.push(Prisma.sql`(${Prisma.join(should.map(conditionSql), ' OR ')})`);

    return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, ' AND ');
}

function projectPayload(payload: Payload, selector: unknown): Payload | null {
    if (selector === false) return null;
    if (selector === undefined || selector === null || selector === true) return payload;
    const pick = (keys: unknown[]) =>
        Object.fromEntries(keys.filter((k): k is string => typeof k === 'string' && k in payload).map((k) => [k, payload[k]]));
    if (Array.isArray(selector)) return pick(selector);
    const entry = selector as { include?: unknown; exclude?: unknown };
    let out: Payload = Array.isArray(entry.include) ? pick(entry.include) : { ...payload };
    if (Array.isArray(entry.exclude)) {
        out = Object.fromEntries(Object.entries(out).filter(([k]) => !(entry.exclude as unknown[]).includes(k)));
    }
    return out;
}

function parseVector(text: string): number[] {
    return text.replace(/^\[|\]$/g, '').split(',').filter(Boolean).map(Number);
}

/** Before first use the tables may not exist yet (42P01), which means "no collection". */
function isMissingTable(error: unknown): boolean {
    return error instanceof Error && /relation "VectorCollection" does not exist|42P01/.test(error.message);
}

const ACK = { operation_id: 0, status: 'completed' as const };

// ───────────────────────────────────────────────────────────── the client

type Surface = Pick<
    QdrantClient,
    'getCollections' | 'createCollection' | 'getCollection' | 'createPayloadIndex' | 'scroll' | 'delete' | 'upsert' | 'search'
>;

export class PgVectorClient implements Surface {
    /** Collection sizes, so an upsert can refuse a wrong-dimension vector the way Qdrant does. */
    private readonly sizes = new Map<string, number>();

    /**
     * Create the extension and tables if absent. The same idempotent DDL as
     * migration `20260927120000_pgvector_store`, so the store works the moment
     * this deploys, whether or not `migrate deploy` has run yet.
     */
    private async provision(): Promise<void> {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VectorCollection" (
            "name" TEXT NOT NULL, "size" INTEGER NOT NULL, "distance" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "VectorCollection_pkey" PRIMARY KEY ("name"))`);
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VectorPoint" (
            "collection" TEXT NOT NULL, "id" TEXT NOT NULL, "userId" TEXT, "type" TEXT, "sourceId" TEXT,
            "payload" JSONB NOT NULL, "embedding" vector NOT NULL,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "VectorPoint_pkey" PRIMARY KEY ("collection", "id"))`);
        await prisma.$executeRawUnsafe(
            'CREATE INDEX IF NOT EXISTS "VectorPoint_collection_userId_type_idx" ON "VectorPoint"("collection", "userId", "type")',
        );
        await prisma.$executeRawUnsafe(
            'CREATE INDEX IF NOT EXISTS "VectorPoint_collection_type_idx" ON "VectorPoint"("collection", "type")',
        );
    }

    private async collectionRow(name: string): Promise<{ size: number; distance: string } | null> {
        try {
            const rows = await prisma.$queryRaw<{ size: number; distance: string }[]>`
                SELECT "size", "distance" FROM "VectorCollection" WHERE "name" = ${name}`;
            return rows[0] ?? null;
        } catch (error: unknown) {
            if (isMissingTable(error)) return null;
            throw error;
        }
    }

    private async requireSize(name: string): Promise<number> {
        const cached = this.sizes.get(name);
        if (cached !== undefined) return cached;
        const row = await this.collectionRow(name);
        if (!row) throw new Error(`Not found: Collection \`${name}\` doesn't exist!`);
        this.sizes.set(name, row.size);
        return row.size;
    }

    async getCollections(): ReturnType<QdrantClient['getCollections']> {
        try {
            const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT "name" FROM "VectorCollection" ORDER BY "name"`;
            return { collections: rows.map((row) => ({ name: row.name })) };
        } catch (error: unknown) {
            if (isMissingTable(error)) return { collections: [] };
            throw error;
        }
    }

    async createCollection(
        ...[name, args]: Parameters<QdrantClient['createCollection']>
    ): ReturnType<QdrantClient['createCollection']> {
        const vectors = args?.vectors as { size?: number; distance?: string } | undefined;
        const size = Number(vectors?.size);
        if (!Number.isInteger(size) || size <= 0) throw new Error('pgvector store: createCollection needs vectors.size');
        const distance = vectors?.distance ?? 'Cosine';
        if (distance !== 'Cosine') throw new Error(`pgvector store: only Cosine distance is supported, got ${distance}`);
        await this.provision();
        await prisma.$executeRaw`
            INSERT INTO "VectorCollection" ("name", "size", "distance") VALUES (${name}, ${size}, ${distance})
            ON CONFLICT ("name") DO NOTHING`;
        this.sizes.delete(name);
        return true;
    }

    async getCollection(...[name]: Parameters<QdrantClient['getCollection']>): ReturnType<QdrantClient['getCollection']> {
        const row = await this.collectionRow(name);
        if (!row) throw new Error(`Not found: Collection \`${name}\` doesn't exist!`);
        const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count FROM "VectorPoint" WHERE "collection" = ${name}`;
        const points = Number(count);
        return {
            status: 'green',
            optimizer_status: 'ok',
            segments_count: 1,
            points_count: points,
            indexed_vectors_count: points,
            config: {
                params: { vectors: { size: row.size, distance: 'Cosine' } },
                hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10_000 },
                optimizer_config: {
                    deleted_threshold: 0.2,
                    vacuum_min_vector_number: 1_000,
                    default_segment_number: 0,
                    flush_interval_sec: 5,
                },
                wal_config: { wal_capacity_mb: 32, wal_segments_ahead: 0 },
            },
            // userId / type are indexed columns, so report them as indexed:
            // `ensureKnowledgeBaseCollection` then has nothing to create.
            payload_schema: {
                userId: { data_type: 'keyword', points },
                type: { data_type: 'keyword', points },
            },
        };
    }

    async createPayloadIndex(): ReturnType<QdrantClient['createPayloadIndex']> {
        // The filterable keys are real columns with real indexes (see the schema).
        return ACK;
    }

    async upsert(...[name, args]: Parameters<QdrantClient['upsert']>): ReturnType<QdrantClient['upsert']> {
        const size = await this.requireSize(name);
        const points = (args as { points?: unknown }).points;
        if (!Array.isArray(points)) throw new Error('pgvector store: upsert supports { points: [...] } only');

        for (const raw of points) {
            const point = raw as { id: PointId; vector: unknown; payload?: Payload };
            const literal = vectorLiteral(point.vector);
            const dims = (point.vector as unknown[]).length;
            if (dims !== size) {
                throw new Error(`Bad request: Wrong input: Vector dimension error: expected dim: ${size}, got ${dims}`);
            }
            const payload = point.payload ?? {};
            const column = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : null);
            await prisma.$executeRaw`
                INSERT INTO "VectorPoint" ("collection", "id", "userId", "type", "sourceId", "payload", "embedding", "updatedAt")
                VALUES (${name}, ${String(point.id)}, ${column('userId')}, ${column('type')}, ${column('sourceId')},
                        ${JSON.stringify(payload)}::jsonb, ${literal}::vector, NOW())
                ON CONFLICT ("collection", "id") DO UPDATE SET
                    "userId" = EXCLUDED."userId", "type" = EXCLUDED."type", "sourceId" = EXCLUDED."sourceId",
                    "payload" = EXCLUDED."payload", "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()`;
        }
        return ACK;
    }

    async delete(...[name, args]: Parameters<QdrantClient['delete']>): ReturnType<QdrantClient['delete']> {
        const body = args as { points?: PointId[]; filter?: unknown };
        if (Array.isArray(body.points)) {
            const ids = body.points.map(String);
            if (ids.length > 0) {
                await prisma.$executeRaw`DELETE FROM "VectorPoint" WHERE "collection" = ${name} AND "id" IN (${Prisma.join(ids)})`;
            }
        } else if (body.filter) {
            await prisma.$executeRaw`DELETE FROM "VectorPoint" WHERE "collection" = ${name} AND ${filterSql(body.filter)}`;
        }
        return ACK;
    }

    async search(...[name, args]: Parameters<QdrantClient['search']>): ReturnType<QdrantClient['search']> {
        await this.requireSize(name);
        const literal = vectorLiteral(args.vector);
        const limit = args.limit ?? 10;
        const offset = args.offset ?? 0;
        const threshold = args.score_threshold ?? null;

        const rows = await prisma.$queryRaw<{ id: string; payload: Payload; score: number; embedding: string }[]>`
            SELECT "id", "payload", "embedding"::text AS embedding,
                   (1 - ("embedding" <=> ${literal}::vector))::float8 AS score
            FROM "VectorPoint"
            WHERE "collection" = ${name} AND ${filterSql(args.filter)}
              AND (${threshold}::float8 IS NULL OR 1 - ("embedding" <=> ${literal}::vector) >= ${threshold}::float8)
            ORDER BY "embedding" <=> ${literal}::vector, "id"
            LIMIT ${limit} OFFSET ${offset}`;

        return rows.map((row) => ({
            id: row.id,
            version: 0,
            score: Number(row.score),
            payload: projectPayload(row.payload, args.with_payload ?? true),
            ...(args.with_vector ? { vector: parseVector(row.embedding) } : {}),
        }));
    }

    async scroll(...[name, args]: Parameters<QdrantClient['scroll']>): ReturnType<QdrantClient['scroll']> {
        await this.requireSize(name);
        const options = args ?? {};
        const limit = options.limit ?? 10;
        const offset = options.offset === undefined || options.offset === null ? null : String(options.offset);

        // Point-id order with the id as the cursor, as Qdrant does. COLLATE "C"
        // keeps the order byte-wise, so a page boundary never depends on locale.
        const rows = await prisma.$queryRaw<{ id: string; payload: Payload; embedding: string | null }[]>`
            SELECT "id", "payload", ${options.with_vector ? Prisma.sql`"embedding"::text` : Prisma.sql`NULL::text`} AS embedding
            FROM "VectorPoint"
            WHERE "collection" = ${name} AND ${filterSql(options.filter)}
              AND (${offset}::text IS NULL OR "id" COLLATE "C" >= ${offset}::text)
            ORDER BY "id" COLLATE "C"
            LIMIT ${limit + 1}`;

        const page = rows.slice(0, limit);
        return {
            points: page.map((row) => ({
                id: row.id,
                version: 0,
                payload: projectPayload(row.payload, options.with_payload ?? true),
                ...(options.with_vector && row.embedding ? { vector: parseVector(row.embedding) } : {}),
            })),
            next_page_offset: rows[limit]?.id ?? null,
        };
    }

    /** The single cast in the vector path, as in the test double. */
    asQdrantClient(): QdrantClient {
        return this as unknown as QdrantClient;
    }
}
