import { describe, expect, test } from 'bun:test';

import { config } from '@/lib/config';
import { __pricing } from '@/lib/usageTracker';

/**
 * Whatever models this deployment is configured to use, we must be able to
 * price them.
 *
 * The cost tripwires are the only thing standing between a model swap and a
 * surprise bill, and they are computed from a hardcoded table that nothing
 * previously kept in step with the model map. An unpriced model logs $0, so the
 * failure mode is not a crash — it is a dashboard that reads zero while real
 * money leaves, which is the most expensive kind of quiet.
 *
 * This asserts against the RESOLVED config rather than the literal defaults, so
 * it also covers a deployment that points OPENAI_MODEL_* at a gateway model:
 * set one that isn't in the table and this test fails before the bill does.
 */
describe('every configured model has a price', () => {
    const configured = Object.entries(config.openai.models);

    test('the task map is not empty (guards against a vacuous pass)', () => {
        expect(configured.length).toBeGreaterThan(10);
    });

    for (const [task, model] of configured) {
        test(`${task} → ${model}`, () => {
            expect(__pricing.has(model)).toBe(true);
        });
    }

    test('the embedding model is priced too', () => {
        expect(__pricing.has(config.openai.embedding.model)).toBe(true);
    });
});

describe('the price lookup is actually discriminating', () => {
    // Mutation check: if `has` returned true unconditionally the suite above
    // would pass while proving nothing.
    test('an unknown model is reported as unpriced', () => {
        expect(__pricing.has('not-a-real-model-9000')).toBe(false);
    });

    test('lookup is case- and whitespace-insensitive', () => {
        expect(__pricing.has('  GPT-5-MINI ')).toBe(true);
    });

    test('an empty model name is unpriced rather than throwing', () => {
        expect(__pricing.has('')).toBe(false);
    });
});
