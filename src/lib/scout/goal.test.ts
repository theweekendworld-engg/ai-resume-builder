/**
 * Share and go, step zero: what the user wants done with a share
 * (docs/impl/07-telegram-apply.md §5). Code first, one closed-enum model call
 * only when code cannot tell, and `evaluate` whenever in doubt.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { __testing as aiTesting } from '@/lib/ai/structured';
import { decideShareGoal, goalByCode, goalOf, splitShare } from './goal';

const JOB = 'https://www.linkedin.com/jobs/view/4455902670';
const POST = [
    'Forward Deployed AI Engineer | Claude',
    'We are building agentic systems for enterprise customers and need engineers who ship.',
    'You will own integrations end to end, from discovery calls to production rollouts.',
    'Send resumes to jobs@iserveworld.com',
].join('\n');

describe('goalByCode', () => {
    test('apply, in the ways people say it', () => {
        for (const note of ['apply', 'Apply for me', 'apply for me pls', 'please apply', 'apply to this one', 'send my resume', 'help me apply', 'Submit my application', 'can you apply for this job']) {
            expect(goalByCode(note)).toBe('apply');
        }
    });

    test('"should I apply?" is a question about fit, not an instruction', () => {
        for (const note of ['should I apply?', 'worth it?', 'is this a good fit for me', 'thoughts?', 'am I qualified', 'fit?', 'wdyt']) {
            expect(goalByCode(note)).toBe('evaluate');
        }
    });

    test('people and save', () => {
        for (const note of ['who should I talk to?', 'who should i reach out to', 'can you find me a referral', "who's the hiring manager"]) {
            expect(goalByCode(note)).toBe('people');
        }
        for (const note of ['save for later', 'save it', 'bookmark this', 'later', 'keep it for later']) {
            expect(goalByCode(note)).toBe('save');
        }
    });

    test('nothing it can be sure of is null, so the model is asked', () => {
        for (const note of ['iServe job', 'go for it', 'this one looks fun', '']) expect(goalByCode(note)).toBeNull();
    });

    test('a stored goal reads defensively', () => {
        expect(goalOf({ goal: 'apply' })).toBe('apply');
        expect(goalOf({ goal: 'nonsense' })).toBe('evaluate');
        expect(goalOf(null)).toBe('evaluate');
    });
});

describe('splitShare', () => {
    test('a link with a line of the user\'s own: the link is the post, the line is the note', () => {
        expect(splitShare(`apply for me ${JOB}`)).toEqual({ url: JOB, text: null, note: 'apply for me' });
        expect(splitShare(`${JOB}\nworth it?`)).toEqual({ url: JOB, text: null, note: 'worth it?' });
    });

    test('a bare link has no note', () => {
        expect(splitShare(JOB)).toEqual({ url: JOB, text: null, note: null });
    });

    test('share-sheet text is not the user talking', () => {
        expect(splitShare(`Check out this job at iServeWorld: Forward Deployed AI Engineer\n${JOB}`).note).toBeNull();
    });

    test('a short hiring post with its link is the post, not a note', () => {
        expect(splitShare(`We're hiring an SDE II. Send resumes to jobs@x.com ${JOB}`).note).toBeNull();
        // ...unless the user said what they want in it.
        expect(splitShare(`apply for me, they want resumes at jobs@x.com ${JOB}`).note).toContain('apply for me');
    });

    test('a paste with "apply for me" on top: the note comes off, the post stays whole', () => {
        const shared = splitShare(`apply for me\n\n${POST}`);
        expect(shared.note).toBe('apply for me');
        expect(shared.text).toBe(POST);
        expect(shared.url).toBeNull();
    });

    test('a paste with "worth it?" at the bottom', () => {
        const shared = splitShare(`${POST}\n\nworth it?`);
        expect(shared.note).toBe('worth it?');
        expect(shared.text).toBe(POST);
    });

    test('a post\'s own first line never starts an application', () => {
        // "Apply now!" is the poster talking: no first person, not a short question.
        const shared = splitShare(`Apply now!\n\n${POST}`);
        expect(shared.note).toBeNull();
        expect(shared.text).toStartWith('Apply now!');
    });

    test('the same post with and without the note is the same text, so one run', () => {
        expect(splitShare(`apply for me\n${POST}`).text).toBe(splitShare(POST).text);
    });

    test('a file: the caption is the note, the document is the post', () => {
        expect(splitShare('ignored', { post: POST, note: 'apply for me' })).toEqual({ url: null, text: POST, note: 'apply for me' });
        expect(splitShare('ignored', { post: POST, note: undefined }).note).toBeNull();
    });
});

describe('decideShareGoal', () => {
    const calls: string[] = [];
    let answer: unknown = { goal: 'apply' };

    beforeAll(() => {
        aiTesting.setUsageLogger(async () => {});
        aiTesting.setBudgetGuard(async () => undefined);
        aiTesting.setObjectRunner(async ({ prompt }) => {
            calls.push(prompt);
            if (answer instanceof Error) throw answer;
            return { object: answer, inputTokens: 1, outputTokens: 1 };
        });
    });
    afterEach(() => {
        calls.length = 0;
        answer = { goal: 'apply' };
    });
    afterAll(() => aiTesting.reset());

    test('no note: evaluate, no call', async () => {
        expect(await decideShareGoal({ userId: 'u', note: null })).toEqual({ goal: 'evaluate', by: 'none', costUsd: 0 });
        expect(calls).toHaveLength(0);
    });

    test('keywords decide without a call', async () => {
        expect((await decideShareGoal({ userId: 'u', note: 'apply for me' })).goal).toBe('apply');
        expect((await decideShareGoal({ userId: 'u', note: 'who should I talk to?' })).goal).toBe('people');
        expect(calls).toHaveLength(0);
    });

    test('an unclear note asks the model once, with the note and a closed list', async () => {
        const decided = await decideShareGoal({ userId: 'u', note: 'go for it' });
        expect(decided).toMatchObject({ goal: 'apply', by: 'model' });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('go for it');
    });

    test('a failed call, or an answer outside the list, is evaluate', async () => {
        answer = new Error('provider down');
        expect(await decideShareGoal({ userId: 'u', note: 'go for it' })).toMatchObject({ goal: 'evaluate', by: 'fallback' });
        answer = { goal: 'send_email_now' };
        expect(await decideShareGoal({ userId: 'u', note: 'go for it' })).toMatchObject({ goal: 'evaluate', by: 'fallback' });
    });
});
