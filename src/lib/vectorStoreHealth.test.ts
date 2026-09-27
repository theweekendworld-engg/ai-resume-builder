import { describe, expect, test } from 'bun:test';
import { probeVectorStore, vectorStoreCheck, type VectorStoreProbe } from './vectorStoreHealth';

const PROBE: VectorStoreProbe = {
    store: 'pgvector', available: true, installedVersion: '0.8.0',
    collections: [{ name: 'knowledge_base_1536', size: 1536, points: 12 }],
    activeCollection: 'knowledge_base_1536',
};

describe('vector store health', () => {
    test('reads the real local database', async () => {
        const probe = await probeVectorStore();
        expect(probe.error).toBeUndefined();
        expect(probe.available).toBe(true);
        expect(probe.activeCollection).toMatch(/^knowledge_base_\d+$/);
    });

    test('available but not yet created is healthy: first use creates it', () => {
        const check = vectorStoreCheck({ ...PROBE, installedVersion: null, collections: [] });
        expect(check?.ok).toBe(true);
        expect(check?.impact).toContain('not yet created');
    });

    test('reports the active collection and its point count', () => {
        expect(vectorStoreCheck(PROBE)?.impact).toContain('knowledge_base_1536: 12 points');
    });

    test('a server without pgvector, or a failed probe, is an error', () => {
        expect(vectorStoreCheck({ ...PROBE, available: false })?.ok).toBe(false);
        expect(vectorStoreCheck({ ...PROBE, error: 'boom' })?.ok).toBe(false);
    });

    test('says nothing when Qdrant is the store', () => {
        expect(vectorStoreCheck({ ...PROBE, store: 'qdrant' })).toBeNull();
    });
});
