import { describe, expect, test } from 'bun:test';
import { CLARIFICATION_ANSWER_HINT, replyToText } from './renderText';
import type { ChatCard } from './types';

const APP = 'https://app.example.com/';

function generation(over: Partial<Extract<ChatCard, { type: 'generation' }>> = {}): ChatCard {
    return { type: 'generation', sessionId: 's1', resumeId: null, status: 'generating', title: 'Plivo', question: null, ...over };
}

describe('generation card as text', () => {
    // Audit 2026-11-07: Telegram said "One question first" and never asked it.
    test('a waiting resume shows its question and how to answer it', () => {
        const text = replyToText({
            text: 'One question first, so the resume says the right thing.',
            cards: [generation({ status: 'awaiting_clarification', question: 'Have you used Kafka in production?' })],
        }, APP);
        expect(text).toBe([
            'One question first, so the resume says the right thing.',
            '📄 Resume for Plivo',
            `Have you used Kafka in production?\n\n${CLARIFICATION_ANSWER_HINT}`,
        ].join('\n\n'));
    });

    test('the hint is the one the Telegram /generate flow uses', () => {
        expect(CLARIFICATION_ANSWER_HINT).toBe('Answer it, or say "skip", "skip all" or "cancel".');
    });

    test('a resume being made, or made, has no question and no hint', () => {
        expect(replyToText({ text: '', cards: [generation()] }, APP)).toBe('📄 Resume for Plivo');
        expect(replyToText({ text: '', cards: [generation({ status: 'completed', resumeId: 'r1' })] }, APP))
            .toBe('📄 Resume for Plivo: https://app.example.com/editor/r1');
    });

    test('a waiting resume without a question text does not print an empty hint', () => {
        const text = replyToText({ text: '', cards: [generation({ status: 'awaiting_clarification', question: null })] }, APP);
        expect(text).toBe('📄 Resume for Plivo');
    });
});
