/**
 * Messages from production (2026-10-03) and their neighbours. Each of the
 * first four was wrongly stored as an answer to "Do you have hands-on
 * experience with …?", and the last one started a generation.
 */
import { describe, expect, test } from 'bun:test';
import { clarificationProgress, routeClarificationReply } from './clarification';

const now = new Date('2026-10-03T09:05:00Z');
const askedAt = new Date('2026-10-03T09:04:00Z');
const route = (text: string) => routeClarificationReply({ text, askedAt, now });

describe('routeClarificationReply', () => {
    test('a command with words after it is never an answer', () => {
        expect(route('/help what should i do now')).toBe('pass');
        expect(route('/status')).toBe('pass');
    });

    test('frustration, questions and greetings are not answers', () => {
        for (const text of ['what the hell are you doing', 'what are you doing?', 'why are you asking me this', 'hii', 'hello', 'ok', 'wtf', 'i don\'t understand']) {
            expect(route(text)).toBe('pass');
        }
    });

    test('"no" and its variants skip the question instead of being stored', () => {
        for (const text of ['no', 'No.', 'nope', 'none', 'n/a', 'not really', "I don't", 'no experience with it', "haven't used it"]) {
            expect(route(text)).toBe('skip');
        }
    });

    test('cancel, stop and never mind cancel', () => {
        for (const text of ['cancel', 'stop', 'never mind', 'nevermind', 'Cancel.']) expect(route(text)).toBe('cancel');
    });

    test('a real answer is an answer', () => {
        for (const text of [
            'yes, built the payments service in Go at Razorpay',
            'Used AWS Lambda and SQS for the webhook retry queue, cut p99 from 900ms to 300ms',
            '2 years of Java at Amazon on the Alexa team',
        ]) {
            expect(route(text)).toBe('answer');
        }
    });

    test('skip and skip all still work, and a stale question passes', () => {
        expect(route('skip')).toBe('skip');
        expect(route('skip all')).toBe('skip_all');
        expect(routeClarificationReply({ text: 'built it in Go', askedAt: new Date('2026-10-03T07:00:00Z'), now })).toBe('pass');
    });
});

describe('clarificationProgress', () => {
    test('counts the question being asked, one-based', () => {
        const value = { questions: [{ id: 'a', question: 'A?' }, { id: 'b', question: 'B?' }, { id: 'c', question: 'C?' }], answers: { a: 'x' } };
        expect(clarificationProgress(value)).toEqual({ current: 2, total: 3 });
        expect(clarificationProgress({})).toBeNull();
    });
});
