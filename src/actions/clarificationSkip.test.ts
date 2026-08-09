import { describe, expect, test } from 'bun:test';

/**
 * Skipping a clarification question has to actually advance.
 *
 * The generation flow asks up to three questions about gaps it found. Until
 * now the only control was a Continue button, disabled until you typed
 * something — so a person with no answer to "tell us about your Kubernetes
 * experience" could invent one or abandon the run. On a product whose single
 * promise is that nothing on the resume is made up, a required text box is the
 * product asking to be lied to.
 *
 * The skip records an EMPTY answer rather than leaving the key absent, and
 * that detail is the whole bug risk: the question-picker used to test
 * `!answers[id]?.trim()`, which reads an empty string as unanswered and would
 * have handed the same question back forever. These tests pin the two halves —
 * the picker treats presence as answered, and the context builder still drops
 * the empty so a declined question contributes nothing to the model.
 */

/** Mirrors `getNextUnansweredQuestion` in `channelGenerate.ts`. */
function nextUnanswered(
    questions: { id: string }[],
    answers: Record<string, string>,
): { id: string } | undefined {
    return questions.find((question) => answers[question.id] === undefined);
}

/** Mirrors `buildClarificationContext`'s filter. */
function contextLines(
    questions: { id: string; gap: string }[],
    answers: Record<string, string>,
): string[] {
    return questions
        .map((question) => {
            const answer = answers[question.id]?.trim();
            return answer ? `- Gap: ${question.gap}\n  Answer: ${answer}` : '';
        })
        .filter(Boolean);
}

const QUESTIONS = [
    { id: 'q1', gap: 'Kubernetes' },
    { id: 'q2', gap: 'Mentoring' },
    { id: 'q3', gap: 'Terraform' },
];

describe('a skipped question does not come back', () => {
    test('an empty answer counts as asked and declined', () => {
        const answers: Record<string, string> = { q1: '' };
        expect(nextUnanswered(QUESTIONS, answers)?.id).toBe('q2');
    });

    test('the old truthiness check would have looped forever', () => {
        // Kept as an explicit contrast, because this is the bug: `''.trim()`
        // is falsy, so `!answers[id]?.trim()` says "still unanswered" and the
        // wizard hands q1 straight back.
        const answers: Record<string, string> = { q1: '' };
        const buggy = QUESTIONS.find((question) => !answers[question.id]?.trim());
        expect(buggy?.id).toBe('q1');
        expect(nextUnanswered(QUESTIONS, answers)?.id).not.toBe('q1');
    });

    test('skipping every question ends the round', () => {
        const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, '']));
        expect(nextUnanswered(QUESTIONS, answers)).toBeUndefined();
    });

    test('a real answer still advances', () => {
        const answers = { q1: 'Ran a 40-node cluster for two years.' };
        expect(nextUnanswered(QUESTIONS, answers)?.id).toBe('q2');
    });
});

describe('a declined question tells the model nothing', () => {
    test('empty answers are dropped from the context', () => {
        const answers = { q1: '', q2: 'Mentored three engineers; two were promoted.', q3: '' };
        const lines = contextLines(QUESTIONS, answers);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('Mentored three engineers');
    });

    test('skipping everything contributes no context at all', () => {
        const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, '']));
        expect(contextLines(QUESTIONS, answers)).toEqual([]);
    });

    test('whitespace-only is treated as declined, not as an answer', () => {
        // Otherwise a space bar becomes a claim in the model's context.
        expect(contextLines(QUESTIONS, { q1: '   ' })).toEqual([]);
    });
});
