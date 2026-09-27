/**
 * The vector-store client, and the seam for swapping it in tests.
 *
 * The binding is typed as `QdrantClient` because that is the surface the app
 * calls. By default it is backed by Postgres (`PgVectorClient`); set
 * `VECTOR_STORE=qdrant` to talk to a Qdrant server instead.
 *
 * Lives here rather than beside the embedding code (formerly the `'use server'`
 * file `src/actions/embed.ts`, now `src/lib/embeddings.ts`) for a hard reason: that file
 * was `'use server'`, and Next only permits async function exports from a server
 * module. A client singleton and its test seam are neither, so putting them
 * there compiles under `tsc` and then fails the Next build — the kind of error
 * a type-check will not catch for you.
 *
 * Consumers import the binding directly. ESM live bindings mean a swap through
 * `setQdrantClient` is visible to every existing importer without changing a
 * single call site.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '@/lib/config';
import { PgVectorClient } from '@/lib/pgVectorClient';

function createClient(): QdrantClient {
    if (config.vectorStore === 'pgvector') return new PgVectorClient().asQdrantClient();
    return new QdrantClient({
        url: config.qdrant.url || 'http://localhost:6333',
        ...(config.qdrant.apiKey && { apiKey: config.qdrant.apiKey }),
    });
}

export let qdrantClient: QdrantClient = createClient();

/**
 * Whether `ensureKnowledgeBaseCollection()` has already run for the CURRENT
 * client.
 *
 * It lives here rather than in `embed.ts` because it describes the client, not
 * the module: a cache that outlives the thing it caches is a bug waiting for a
 * test to find it. Swapping in a mock, or resetting one whose store has been
 * cleared, must invalidate it — otherwise `ensure` short-circuits while the
 * collection no longer exists and the next read fails with "Collection doesn't
 * exist".
 */
let collectionEnsured = false;

export function isCollectionEnsured(): boolean {
    return collectionEnsured;
}

export function markCollectionEnsured(): void {
    collectionEnsured = true;
}

export function invalidateCollectionEnsured(): void {
    collectionEnsured = false;
}

/**
 * Test seam. Typed as the real `QdrantClient`, so a mock that drifts from the
 * SDK stops compiling rather than quietly diverging.
 */
export function setQdrantClient(client: QdrantClient): void {
    qdrantClient = client;
    collectionEnsured = false;
}

export function resetQdrantClient(): void {
    qdrantClient = createClient();
    collectionEnsured = false;
}
