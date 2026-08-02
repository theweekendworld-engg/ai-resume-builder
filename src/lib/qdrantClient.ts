/**
 * The Qdrant client, and the seam for swapping it in tests.
 *
 * Lives here rather than in `src/actions/embed.ts` for a hard reason: that file
 * is `'use server'`, and Next only permits async function exports from a server
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

function createClient(): QdrantClient {
    return new QdrantClient({
        url: config.qdrant.url || 'http://localhost:6333',
        ...(config.qdrant.apiKey && { apiKey: config.qdrant.apiKey }),
    });
}

export let qdrantClient: QdrantClient = createClient();

/**
 * Test seam. Typed as the real `QdrantClient`, so a fake that drifts from the
 * SDK stops compiling rather than quietly diverging.
 */
export function setQdrantClient(client: QdrantClient): void {
    qdrantClient = client;
}

export function resetQdrantClient(): void {
    qdrantClient = createClient();
}
