/**
 * An in-memory Qdrant with REAL filter semantics.
 *
 * Filters are not decoration here. ADR-8 (CLAUDE.md rule 3) enforces
 * sensitivity as a *query* concern: the vector half of the rule is a
 * `must: [{ key: 'sensitivity', match: { value: 'shareable' } }]` clause, and
 * "a confidential Win never reaches an external artifact" is proven by that
 * clause being honoured. A mock that returned every point regardless of filter
 * would make the single most important test in the product vacuous — it would
 * pass whether or not the filter was ever built.
 *
 * So `must` / `should` / `must_not`, `match.value` / `match.any` /
 * `match.except` / `match.text`, `range`, `is_empty`, `has_id` and nested
 * sub-filters all behave the way the server behaves, including Qdrant's rule
 * that a condition on an array payload key matches when ANY element matches.
 *
 * Scoring is real cosine similarity over the stored vectors. Ordering is
 * total and deterministic — ties break on point id, never on insertion race.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import { cosineSimilarity } from './deterministic';
import type { Recorder } from './recorder';

// The app only ever calls these eight. Every parameter and return type is
// pulled from the installed SDK, so a signature change breaks the build.
type CoveredMethods =
    | 'getCollections'
    | 'createCollection'
    | 'getCollection'
    | 'createPayloadIndex'
    | 'scroll'
    | 'delete'
    | 'upsert'
    | 'search';

type QdrantSurface = Pick<QdrantClient, CoveredMethods>;

type PointId = string | number;
type Payload = Record<string, unknown>;

// Every shape below is derived from the SDK's own `getCollection` return type,
// so a schema change in Qdrant's OpenAPI surfaces here as a compile error
// instead of as a mock that quietly describes a collection Qdrant no longer has.
type CollectionInfo = Awaited<ReturnType<QdrantClient['getCollection']>>;
type VectorsConfig = NonNullable<NonNullable<CollectionInfo['config']>['params']>['vectors'];
type NamedVectorConfig = Extract<VectorsConfig, { size: number }>;
type Distance = NamedVectorConfig['distance'];
type PayloadSchemaEntry = NonNullable<CollectionInfo['payload_schema'][string]>;
type PayloadDataType = PayloadSchemaEntry['data_type'];

const PAYLOAD_DATA_TYPES: readonly PayloadDataType[] = [
    'text',
    'keyword',
    'integer',
    'float',
    'geo',
    'bool',
    'datetime',
    'uuid',
];

function asPayloadDataType(value: unknown): PayloadDataType {
    const candidate =
        typeof value === 'string' ? value : String((value as { type?: unknown })?.type ?? 'keyword');
    return (PAYLOAD_DATA_TYPES as readonly string[]).includes(candidate)
        ? (candidate as PayloadDataType)
        : 'keyword';
}

const DISTANCES: readonly Distance[] = ['Cosine', 'Euclid', 'Dot', 'Manhattan'];

function asDistance(value: unknown): Distance {
    return (DISTANCES as readonly string[]).includes(String(value)) ? (value as Distance) : 'Cosine';
}

type StoredPoint = {
    id: PointId;
    vector: number[];
    payload: Payload;
};

type StoredCollection = {
    name: string;
    vectorSize: number;
    distance: Distance;
    points: Map<string, StoredPoint>;
    payloadSchema: Record<string, PayloadSchemaEntry>;
};

// ───────────────────────────────────────────────────────── filter evaluation

/** Qdrant addresses nested payload with dotted paths. `a.b` reads `{a:{b:…}}`. */
function readPath(payload: Payload, key: string): unknown[] {
    let current: unknown[] = [payload];
    for (const segment of key.split('.')) {
        const next: unknown[] = [];
        for (const node of current) {
            if (node === null || node === undefined) continue;
            if (Array.isArray(node)) {
                // Qdrant flattens through arrays on the way down.
                for (const entry of node) {
                    if (entry && typeof entry === 'object') {
                        const value = (entry as Record<string, unknown>)[segment];
                        if (value !== undefined) next.push(value);
                    }
                }
                continue;
            }
            if (typeof node === 'object') {
                const value = (node as Record<string, unknown>)[segment];
                if (value !== undefined) next.push(value);
            }
        }
        current = next;
    }
    // A leaf array is a set of candidate values: `{tags:['a','b']}` matches 'a'.
    return current.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function matchesMatch(values: unknown[], match: Record<string, unknown>): boolean {
    if ('value' in match) {
        return values.some((value) => value === match.value);
    }
    if ('any' in match) {
        const any = Array.isArray(match.any) ? match.any : [];
        return values.some((value) => any.includes(value as never));
    }
    if ('except' in match) {
        const except = Array.isArray(match.except) ? match.except : [];
        // Qdrant's `except` is true when NO stored value is in the list. An
        // absent key therefore matches — the same way the server treats it.
        return !values.some((value) => except.includes(value as never));
    }
    if ('text' in match) {
        const needle = String(match.text).toLowerCase();
        return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
    }
    return false;
}

function matchesRange(values: unknown[], range: Record<string, unknown>): boolean {
    return values.some((raw) => {
        const value = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
        if (!Number.isFinite(value)) return false;
        const bound = (name: string): number | null => {
            const entry = range[name];
            if (entry === undefined || entry === null) return null;
            const parsed = typeof entry === 'string' ? Date.parse(entry) : Number(entry);
            return Number.isFinite(parsed) ? parsed : null;
        };
        const gt = bound('gt');
        const gte = bound('gte');
        const lt = bound('lt');
        const lte = bound('lte');
        if (gt !== null && !(value > gt)) return false;
        if (gte !== null && !(value >= gte)) return false;
        if (lt !== null && !(value < lt)) return false;
        if (lte !== null && !(value <= lte)) return false;
        return true;
    });
}

function matchesCondition(point: StoredPoint, condition: unknown): boolean {
    if (!condition || typeof condition !== 'object') return false;
    const entry = condition as Record<string, unknown>;

    if ('has_id' in entry) {
        const ids = Array.isArray(entry.has_id) ? entry.has_id : [];
        return ids.some((id) => String(id) === String(point.id));
    }

    // A bare nested filter is a legal condition.
    if ('must' in entry || 'should' in entry || 'must_not' in entry) {
        return matchesFilter(point, entry);
    }

    if ('is_empty' in entry) {
        const target = entry.is_empty as { key?: string } | undefined;
        if (!target?.key) return false;
        const values = readPath(point.payload, target.key);
        return values.length === 0 || values.every((value) => value === null || value === undefined);
    }

    if ('is_null' in entry) {
        const target = entry.is_null as { key?: string } | undefined;
        if (!target?.key) return false;
        return readPath(point.payload, target.key).some((value) => value === null);
    }

    const key = typeof entry.key === 'string' ? entry.key : null;
    if (!key) return false;
    const values = readPath(point.payload, key);

    if ('match' in entry && entry.match && typeof entry.match === 'object') {
        return matchesMatch(values, entry.match as Record<string, unknown>);
    }
    if ('range' in entry && entry.range && typeof entry.range === 'object') {
        return matchesRange(values, entry.range as Record<string, unknown>);
    }

    // An unrecognised condition must NOT silently pass. Fail closed: a filter
    // this mock does not understand excludes the point rather than leaking it.
    return false;
}

function asConditions(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

export function matchesFilter(point: StoredPoint, filter: unknown): boolean {
    if (!filter || typeof filter !== 'object') return true;
    const entry = filter as Record<string, unknown>;

    const must = asConditions(entry.must);
    const should = asConditions(entry.should);
    const mustNot = asConditions(entry.must_not);

    if (must.length > 0 && !must.every((condition) => matchesCondition(point, condition))) return false;
    if (mustNot.length > 0 && mustNot.some((condition) => matchesCondition(point, condition))) return false;
    if (should.length > 0 && !should.some((condition) => matchesCondition(point, condition))) return false;

    return true;
}

// ───────────────────────────────────────────────────────── payload projection

function projectPayload(payload: Payload, selector: unknown): Payload | null {
    if (selector === false) return null;
    if (selector === undefined || selector === true) return { ...payload };

    if (Array.isArray(selector)) {
        const out: Payload = {};
        for (const key of selector) {
            if (typeof key === 'string' && key in payload) out[key] = payload[key];
        }
        return out;
    }

    if (selector && typeof selector === 'object') {
        const entry = selector as { include?: unknown; exclude?: unknown };
        let out: Payload = { ...payload };
        if (Array.isArray(entry.include)) {
            out = {};
            for (const key of entry.include) {
                if (typeof key === 'string' && key in payload) out[key] = payload[key];
            }
        }
        if (Array.isArray(entry.exclude)) {
            for (const key of entry.exclude) {
                if (typeof key === 'string') delete out[key];
            }
        }
        return out;
    }

    return { ...payload };
}

// ───────────────────────────────────────────────────────────── the mock

export class MockQdrantClient implements QdrantSurface {
    private readonly collections = new Map<string, StoredCollection>();
    /** Monotonic, seeded at zero — never a clock, so ids repeat run to run. */
    private operationId = 0;

    constructor(private readonly recorder: Recorder) {}

    // ── inspection helpers for tests

    /** Every stored point in a collection, sorted by id. */
    points(collection: string): StoredPoint[] {
        const stored = this.collections.get(collection);
        if (!stored) return [];
        return [...stored.points.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }

    pointCount(collection: string): number {
        return this.collections.get(collection)?.points.size ?? 0;
    }

    hasPoint(collection: string, id: PointId): boolean {
        return this.collections.get(collection)?.points.has(String(id)) ?? false;
    }

    /** Seed a point without going through the app. For arrange-phase setup only. */
    seed(collection: string, point: { id: PointId; vector: number[]; payload: Payload }): void {
        const stored = this.ensure(collection, point.vector.length);
        stored.points.set(String(point.id), {
            id: point.id,
            vector: [...point.vector],
            payload: { ...point.payload },
        });
    }

    reset(): void {
        this.collections.clear();
        this.operationId = 0;
        this.recorder.qdrant.length = 0;
    }

    /** The single cast in the vector path. */
    asQdrantClient(): QdrantClient {
        return this as unknown as QdrantClient;
    }

    // ── internals

    private ensure(name: string, vectorSize = 0): StoredCollection {
        const existing = this.collections.get(name);
        if (existing) return existing;
        const created: StoredCollection = {
            name,
            vectorSize,
            distance: 'Cosine',
            points: new Map(),
            payloadSchema: {},
        };
        this.collections.set(name, created);
        return created;
    }

    private require(name: string): StoredCollection {
        const stored = this.collections.get(name);
        if (!stored) throw new Error(`Not found: Collection \`${name}\` doesn't exist!`);
        return stored;
    }

    private ack(): { operation_id: number; status: 'acknowledged' | 'completed' } {
        this.operationId += 1;
        return { operation_id: this.operationId, status: 'completed' };
    }

    private record(method: string, collection: string, count: number): void {
        this.recorder.qdrant.push({ method, collection, count });
    }

    // ── SDK surface

    async getCollections(): ReturnType<QdrantClient['getCollections']> {
        this.record('getCollections', '*', this.collections.size);
        return {
            collections: [...this.collections.keys()].sort().map((name) => ({ name })),
        };
    }

    async createCollection(
        ...[collectionName, args]: Parameters<QdrantClient['createCollection']>
    ): ReturnType<QdrantClient['createCollection']> {
        const vectors = args?.vectors as { size?: number; distance?: unknown } | undefined;
        const created = this.ensure(collectionName, Number(vectors?.size ?? 0));
        created.vectorSize = Number(vectors?.size ?? created.vectorSize);
        created.distance = asDistance(vectors?.distance ?? created.distance);
        this.record('createCollection', collectionName, 0);
        return true;
    }

    async getCollection(
        ...[collectionName]: Parameters<QdrantClient['getCollection']>
    ): ReturnType<QdrantClient['getCollection']> {
        const stored = this.require(collectionName);
        this.record('getCollection', collectionName, stored.points.size);
        return {
            status: 'green',
            optimizer_status: 'ok',
            segments_count: 1,
            points_count: stored.points.size,
            indexed_vectors_count: stored.points.size,
            config: {
                params: {
                    vectors: { size: stored.vectorSize, distance: stored.distance },
                },
                // Server defaults. `ensureKnowledgeBaseCollection` reads only
                // `params.vectors` and `payload_schema`, but the SDK's type
                // requires the rest, and honouring it is what keeps this mock
                // provably shaped like a real collection.
                hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10_000 },
                optimizer_config: {
                    deleted_threshold: 0.2,
                    vacuum_min_vector_number: 1_000,
                    default_segment_number: 0,
                    flush_interval_sec: 5,
                },
                wal_config: { wal_capacity_mb: 32, wal_segments_ahead: 0 },
            },
            payload_schema: stored.payloadSchema,
        };
    }

    async createPayloadIndex(
        ...[collectionName, args]: Parameters<QdrantClient['createPayloadIndex']>
    ): ReturnType<QdrantClient['createPayloadIndex']> {
        const stored = this.ensure(collectionName);
        const fieldName = String(args.field_name);
        stored.payloadSchema[fieldName] = {
            data_type: asPayloadDataType(args.field_schema),
            points: stored.points.size,
        };
        this.record('createPayloadIndex', collectionName, 1);
        return this.ack();
    }

    async upsert(
        ...[collectionName, args]: Parameters<QdrantClient['upsert']>
    ): ReturnType<QdrantClient['upsert']> {
        const stored = this.ensure(collectionName);
        const body = args as { points?: unknown; batch?: unknown };

        const incoming: StoredPoint[] = [];

        if (Array.isArray(body.points)) {
            for (const raw of body.points) {
                const point = raw as { id: PointId; vector: unknown; payload?: Payload };
                incoming.push({
                    id: point.id,
                    vector: Array.isArray(point.vector) ? (point.vector as number[]).map(Number) : [],
                    payload: { ...(point.payload ?? {}) },
                });
            }
        } else if (body.batch && typeof body.batch === 'object') {
            const batch = body.batch as { ids?: PointId[]; vectors?: number[][]; payloads?: Payload[] };
            const ids = batch.ids ?? [];
            ids.forEach((id, index) => {
                incoming.push({
                    id,
                    vector: (batch.vectors?.[index] ?? []).map(Number),
                    payload: { ...(batch.payloads?.[index] ?? {}) },
                });
            });
        }

        for (const point of incoming) {
            if (stored.vectorSize === 0) stored.vectorSize = point.vector.length;
            if (point.vector.length !== stored.vectorSize) {
                // The real server rejects this, and so must the mock — a silent
                // accept would hide a genuine dimension mismatch bug.
                throw new Error(
                    `Bad request: Wrong input: Vector dimension error: expected dim: ${stored.vectorSize}, got ${point.vector.length}`,
                );
            }
            stored.points.set(String(point.id), point);
        }

        this.record('upsert', collectionName, incoming.length);
        return this.ack();
    }

    async delete(
        ...[collectionName, args]: Parameters<QdrantClient['delete']>
    ): ReturnType<QdrantClient['delete']> {
        const stored = this.ensure(collectionName);
        const body = args as { points?: PointId[]; filter?: unknown };
        let removed = 0;

        if (Array.isArray(body.points)) {
            for (const id of body.points) {
                if (stored.points.delete(String(id))) removed += 1;
            }
        } else if (body.filter) {
            for (const [key, point] of [...stored.points.entries()]) {
                if (matchesFilter(point, body.filter)) {
                    stored.points.delete(key);
                    removed += 1;
                }
            }
        }

        this.record('delete', collectionName, removed);
        return this.ack();
    }

    async search(
        ...[collectionName, args]: Parameters<QdrantClient['search']>
    ): ReturnType<QdrantClient['search']> {
        const stored = this.require(collectionName);
        const query = (args.vector as number[]) ?? [];
        const limit = args.limit ?? 10;
        const offset = args.offset ?? 0;

        const scored = [...stored.points.values()]
            .filter((point) => matchesFilter(point, args.filter))
            .map((point) => ({ point, score: cosineSimilarity(query, point.vector) }))
            .filter((entry) =>
                args.score_threshold === undefined || args.score_threshold === null
                    ? true
                    : entry.score >= args.score_threshold,
            )
            // Total order: score first, then id. Never insertion order.
            .sort((a, b) => b.score - a.score || String(a.point.id).localeCompare(String(b.point.id)))
            .slice(offset, offset + limit);

        this.record('search', collectionName, scored.length);

        return scored.map((entry) => ({
            id: entry.point.id,
            version: 0,
            score: entry.score,
            payload: projectPayload(entry.point.payload, args.with_payload ?? true),
            ...(args.with_vector ? { vector: [...entry.point.vector] } : {}),
        }));
    }

    async scroll(
        ...[collectionName, args]: Parameters<QdrantClient['scroll']>
    ): ReturnType<QdrantClient['scroll']> {
        const stored = this.require(collectionName);
        const options = args ?? {};
        const limit = options.limit ?? 10;

        // Qdrant scrolls in point-id order and `offset` is a point id, not an
        // index — pagination that assumes an index would loop forever here.
        const ordered = [...stored.points.values()]
            .filter((point) => matchesFilter(point, options.filter))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));

        const startIndex =
            options.offset === undefined || options.offset === null
                ? 0
                : Math.max(
                      0,
                      ordered.findIndex((point) => String(point.id) === String(options.offset)),
                  );

        const page = ordered.slice(startIndex, startIndex + limit);
        const next = ordered[startIndex + limit];

        this.record('scroll', collectionName, page.length);

        return {
            points: page.map((point) => ({
                id: point.id,
                version: 0,
                payload: projectPayload(point.payload, options.with_payload ?? true),
                ...(options.with_vector ? { vector: [...point.vector] } : {}),
            })),
            next_page_offset: next ? next.id : null,
        };
    }
}
