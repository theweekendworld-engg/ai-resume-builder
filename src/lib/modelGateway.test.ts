import { describe, expect, test } from 'bun:test';

import { resolveModelGateway } from '@/lib/config';

/**
 * Which key sends chat, and which one must never be touched.
 *
 * The failure this guards against is not hypothetical: overloading
 * OPENAI_API_KEY with a router key moves chat AND silently repoints the
 * embedding client, so retrieval starts 401-ing from a subsystem nobody
 * edited. A named OPENROUTER_API_KEY makes the two independent, and these
 * tests pin that independence rather than trusting a comment about it.
 */
describe('gateway resolution', () => {
    test('no router key means OpenAI, unchanged', () => {
        const g = resolveModelGateway({ OPENAI_API_KEY: 'sk-openai' });
        expect(g.provider).toBe('openai');
        expect(g.apiKey).toBe('sk-openai');
        // Undefined, not an empty string: the SDK treats '' as a real override
        // and would build a client pointed at nowhere.
        expect(g.baseURL).toBeUndefined();
    });

    test('a router key moves chat and supplies the default endpoint', () => {
        const g = resolveModelGateway({
            OPENAI_API_KEY: 'sk-openai',
            OPENROUTER_API_KEY: 'sk-or-v1',
        });
        expect(g.provider).toBe('openrouter');
        expect(g.apiKey).toBe('sk-or-v1');
        expect(g.baseURL).toBe('https://openrouter.ai/api/v1');
    });

    test('the OpenAI key survives the switch untouched', () => {
        // The whole reason for a separate variable. If this ever fails,
        // embeddings — and therefore every retrieval — go down with it.
        const env = { OPENAI_API_KEY: 'sk-openai', OPENROUTER_API_KEY: 'sk-or-v1' };
        resolveModelGateway(env);
        expect(env.OPENAI_API_KEY).toBe('sk-openai');
    });

    test('the router endpoint is overridable', () => {
        const g = resolveModelGateway({
            OPENROUTER_API_KEY: 'sk-or-v1',
            OPENROUTER_BASE_URL: 'https://proxy.internal/v1',
        });
        expect(g.baseURL).toBe('https://proxy.internal/v1');
    });

    test('OPENAI_BASE_URL still works for any other compatible endpoint', () => {
        const g = resolveModelGateway({
            OPENAI_API_KEY: 'sk-local',
            OPENAI_BASE_URL: 'http://localhost:8000/v1',
        });
        expect(g.provider).toBe('custom');
        expect(g.baseURL).toBe('http://localhost:8000/v1');
    });

    test('naming a vendor beats naming a URL', () => {
        const g = resolveModelGateway({
            OPENROUTER_API_KEY: 'sk-or-v1',
            OPENAI_BASE_URL: 'http://localhost:8000/v1',
        });
        expect(g.provider).toBe('openrouter');
        expect(g.baseURL).toBe('https://openrouter.ai/api/v1');
    });

    test('a blank or whitespace router key is not a router key', () => {
        // An env var left declared-but-empty in a deploy config is the usual
        // way this goes wrong, and '' is falsy but '  ' is not.
        for (const blank of ['', '   ']) {
            const g = resolveModelGateway({ OPENAI_API_KEY: 'sk-openai', OPENROUTER_API_KEY: blank });
            expect(g.provider).toBe('openai');
            expect(g.apiKey).toBe('sk-openai');
        }
    });

    test('a blank OPENAI_BASE_URL does not fabricate a custom provider', () => {
        const g = resolveModelGateway({ OPENAI_API_KEY: 'sk-openai', OPENAI_BASE_URL: '  ' });
        expect(g.provider).toBe('openai');
        expect(g.baseURL).toBeUndefined();
    });

    test('a missing key resolves to empty rather than the string "undefined"', () => {
        expect(resolveModelGateway({}).apiKey).toBe('');
    });
});
