/**
 * A revision keeps the draft's paragraphs. The live test (2026-11-08):
 * v1 ended "…makes sense.\n\nJai", and "add that I graduated from IIT Delhi"
 * came back "…makes sense.\nJai".
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { keepSignOffParagraph, reviseDraftText } from './revise';

const V1 = 'Hi,\n\nI would like to apply for the Forward Deployed AI Engineer role. I build agent systems in Go and Python.\n\nMy resume is attached. Let me know if a short call makes sense.\n\nJai';
const GLUED = 'Hi,\n\nI would like to apply for the Forward Deployed AI Engineer role. I build agent systems in Go and Python, and I graduated from IIT Delhi.\n\nMy resume is attached. Let me know if a short call makes sense.\nJai';

describe('keepSignOffParagraph', () => {
    test('a sign-off glued to the last paragraph gets its blank line back', () => {
        expect(keepSignOffParagraph(V1, GLUED, 'add that I graduated from IIT Delhi', 'email')).toEndWith('makes sense.\n\nJai');
    });

    test('"Thanks,\\nJai" stays a two-line block', () => {
        const before = 'Hi,\n\nShort note.\n\nThanks,\nJai';
        expect(keepSignOffParagraph(before, 'Hi,\n\nShorter note.\nThanks,\nJai', 'shorter', 'email')).toBe('Hi,\n\nShorter note.\n\nThanks,\nJai');
    });

    test('already right: unchanged', () => {
        expect(keepSignOffParagraph(V1, V1, 'shorter', 'email')).toBe(V1);
    });

    test('an email revision that dropped the sign-off gets it back, unless the instruction was about it', () => {
        const dropped = 'Hi,\n\nI would like to apply. My resume is attached.';
        expect(keepSignOffParagraph(V1, dropped, 'shorter', 'email')).toBe(`${dropped}\n\nJai`);
        expect(keepSignOffParagraph(V1, dropped, 'remove my sign-off', 'email')).toBe(dropped);
    });

    test('no sign-off before, nothing invented', () => {
        expect(keepSignOffParagraph('Hi, quick note about the role.', 'Hi, a quicker note.', 'shorter', 'linkedin_note')).toBe('Hi, a quicker note.');
    });
});

describe('reviseDraftText', () => {
    beforeAll(() => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setBudgetGuard(async () => undefined);
        aiTesting.setObjectRunner(async () => ({
            object: { subject: 'Forward Deployed AI Engineer application', body: GLUED },
            inputTokens: 1,
            outputTokens: 1,
        }));
    });
    afterAll(() => aiTesting.reset());

    test('the saved version keeps the sign-off as its own paragraph', async () => {
        const outcome = await reviseDraftText({
            userId: 'u',
            format: 'email',
            previous: { subject: 'Forward Deployed AI Engineer application', body: V1, version: 1 },
            instruction: 'add that I graduated from IIT Delhi',
            evidence: [],
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.body).toContain('IIT Delhi');
        expect(outcome.body).toEndWith('makes sense.\n\nJai');
        expect(outcome.body.split('\n\n')).toHaveLength(4);
    });
});
