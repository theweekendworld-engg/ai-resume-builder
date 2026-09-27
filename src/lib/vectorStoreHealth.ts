/**
 * Can the database the app is ACTUALLY connected to hold vectors?
 *
 * The vector store moved into Postgres on 2026-09-27. Whether pgvector exists
 * is a property of the live database, not of any env var, so `configHealth`
 * (pure over env) cannot answer it. This asks the database, and reports what
 * it holds: whether the extension is available and installed, and how many
 * points each collection has, so "the sweep re-filled the store" is visible
 * rather than assumed.
 *
 * Read-only. Never creates the extension: that happens on first real use
 * (src/lib/pgVectorClient.ts), and a health check must not change what it
 * measures.
 */

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { KNOWLEDGE_BASE_COLLECTION } from '@/lib/embeddings';
import type { HealthCheck } from '@/lib/health';

export type VectorStoreProbe = {
    store: 'pgvector' | 'qdrant';
    /** The extension can be created on this server. */
    available: boolean;
    /** Null until first use creates it. */
    installedVersion: string | null;
    collections: { name: string; size: number; points: number }[];
    /** The collection the current embedding model writes to. */
    activeCollection: string;
    error?: string;
};

export async function probeVectorStore(): Promise<VectorStoreProbe> {
    const base = {
        store: config.vectorStore,
        available: false,
        installedVersion: null,
        collections: [],
        activeCollection: KNOWLEDGE_BASE_COLLECTION,
    } satisfies VectorStoreProbe;
    if (config.vectorStore !== 'pgvector') return base;

    try {
        const [ext] = await prisma.$queryRaw<{ installed_version: string | null }[]>`
            SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'`;
        const probe: VectorStoreProbe = {
            ...base,
            available: Boolean(ext),
            installedVersion: ext?.installed_version ?? null,
        };
        const [table] = await prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT to_regclass('"VectorCollection"') IS NOT NULL AS exists`;
        if (table?.exists) {
            const rows = await prisma.$queryRaw<{ name: string; size: number; points: bigint }[]>`
                SELECT c."name", c."size", COUNT(p."id")::bigint AS points
                FROM "VectorCollection" c
                LEFT JOIN "VectorPoint" p ON p."collection" = c."name"
                GROUP BY c."name", c."size" ORDER BY c."name"`;
            probe.collections = rows.map((row) => ({ name: row.name, size: row.size, points: Number(row.points) }));
        }
        return probe;
    } catch (error: unknown) {
        return { ...base, error: error instanceof Error ? error.message : 'probe failed' };
    }
}

/** The probe as an ops-page check. */
export function vectorStoreCheck(probe: VectorStoreProbe): HealthCheck | null {
    if (probe.store !== 'pgvector') return null;
    const active = probe.collections.find((c) => c.name === probe.activeCollection);
    return {
        id: 'vector_store_live',
        ok: probe.available && !probe.error,
        severity: 'error',
        impact: probe.error
            ? `The vector store probe failed: ${probe.error}`
            : !probe.available
              ? 'This Postgres server has no pgvector extension: semantic search and Win embedding fail.'
              : `pgvector ${probe.installedVersion ?? 'not yet created (created on first use)'}; ` +
                `${probe.activeCollection}: ${active ? `${active.points} points` : 'not yet created'}.`,
        fix: 'Use a Postgres with pgvector (Supabase and Neon have it), or VECTOR_STORE=qdrant',
    };
}

/** One line at boot, so the live answer is in the runtime logs. Never throws. */
export async function logVectorStoreHealth(): Promise<void> {
    try {
        const probe = await probeVectorStore();
        if (probe.store !== 'pgvector') return;
        const line = `[health] vector store: pgvector available=${probe.available} installed=${probe.installedVersion ?? 'no'} ` +
            `active=${probe.activeCollection} collections=${JSON.stringify(probe.collections)}` +
            (probe.error ? ` error=${probe.error}` : '');
        if (probe.available && !probe.error) console.info(line);
        else console.error(line);
    } catch {
        // Health reporting must never take the app down.
    }
}
