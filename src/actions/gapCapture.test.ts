import { describe, expect, test } from 'bun:test';

import { questionForRequirement } from '@/lib/resume/gapQuestion';

/**
 * The wording carries the whole idea, so it is worth pinning.
 *
 * The gap report is the most useful thing this product generates and, until
 * now, the only thing it did with the insight was print it. Turning it into a
 * capture is the one place the resume writes BACK into the Work Log — but only
 * if the question asks for something a Win can be made of.
 */
describe('the question asks for evidence, not agreement', () => {
    test('it asks for one occasion, with the outcome', () => {
        const question = questionForRequirement('Experience mentoring engineers');
        // "Do you have experience with X?" invites yes, and a yes cannot become
        // a Win. An instance can.
        expect(question).toContain('one time you did this');
        expect(question).toContain('what changed because of it');
    });

    test('it quotes the employer, so the user answers the real thing', () => {
        const question = questionForRequirement('Experience with Kubernetes in production');
        expect(question).toContain('Experience with Kubernetes in production');
    });

    test('a trailing full stop from the posting does not double up', () => {
        // Requirements arrive punctuated or not depending on the posting.
        const question = questionForRequirement('Mentor engineers and raise the bar.');
        expect(question).toContain('“Mentor engineers and raise the bar”');
        expect(question).not.toContain('bar.”');
    });

    test('surrounding whitespace never reaches the user', () => {
        expect(questionForRequirement('   Owns a service   ')).toContain('“Owns a service”');
    });
});
