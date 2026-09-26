import { afterEach, describe, expect, test } from 'bun:test';
import { SourceSet } from '@/lib/agent/sources';
import { __testing, createMemoryStore, readResearch, researchKey, TTL_DAYS, writeResearch } from './cache';

afterEach(() => __testing.setStore(null));

const step = () => ({ sources: new SourceSet(), log: () => undefined });

describe('researchKey', () => {
    test('built only from public attributes, normalised', () => {
        expect(researchKey('comp', 'Stripe, Inc.', 'software_engineering', 'senior', 'bengaluru')).toBe('comp:stripe:software_engineering:senior:bengaluru');
        expect(researchKey('interviews', 'Acme', null)).toBe('interviews:acme:any');
    });
});

describe('read/write', () => {
    test('a hit re-registers its pages so citations still verify', async () => {
        const store = createMemoryStore();
        __testing.setStore(store);
        await writeResearch({
            key: 'k',
            kind: 'company',
            value: { facts: [1] },
            pages: [{ url: 'https://techcrunch.com/a', title: 'A', text: 'Acme raised $45 million', publishedAt: null }],
        });
        const s = step();
        const hit = await readResearch<{ facts: number[] }>(s, 'k');
        expect(hit?.payload).toEqual({ facts: [1] });
        expect(s.sources.has('https://techcrunch.com/a')).toBe(true);
        expect(s.sources.text('https://techcrunch.com/a')).toContain('$45 million');
    });

    test('expired entries miss; empty entries use the short TTL', async () => {
        const store = createMemoryStore();
        __testing.setStore(store);
        const now = new Date('2026-09-01T00:00:00Z');
        await writeResearch({ key: 'e', kind: 'comp', value: null, pages: [], empty: true, now });
        const expiresAt = store.rows.get('e')!.expiresAt.getTime();
        expect(expiresAt - now.getTime()).toBe(TTL_DAYS.empty * 86_400_000);

        const later = new Date(now.getTime() + (TTL_DAYS.empty + 1) * 86_400_000);
        expect(await readResearch(step(), 'e', later)).toBeNull();
    });

    test('a store outage is a miss, not a throw', async () => {
        __testing.setStore({
            get: async () => { throw new Error('db down'); },
            put: async () => { throw new Error('db down'); },
        });
        expect(await readResearch(step(), 'k')).toBeNull();
        await writeResearch({ key: 'k', kind: 'comp', value: 1, pages: [] });
    });
});
