/**
 * Month in Review — the email (design/02 §K2).
 *
 * Pure render tests: no database, no provider, no clock. The shared suite in
 * `src/lib/email/templates.test.ts` already covers the envelope (600px,
 * dark mode, unsubscribe, images-off, plain text). This file covers what is
 * specific to this message — the five blocks, and the copy rules that make it
 * a review rather than a notification.
 */

import { describe, expect, test } from 'bun:test';
import {
    MONTH_IN_REVIEW_TEMPLATE_KEY,
    monthInReviewTemplate,
    renderMixLine,
    type MonthInReviewEmailData,
} from './monthInReview';
import type { TemplateContext } from './transactional';

const ctx: TemplateContext = {
    unsubscribeUrl: 'https://app.example.com/api/email/unsubscribe?token=tok123',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    appUrl: 'https://app.example.com',
};

function makeData(overrides: Partial<MonthInReviewEmailData> = {}): MonthInReviewEmailData {
    return {
        label: 'July 2026',
        headline: '8 wins, 5 with hard numbers',
        subject: 'July: 8 wins, 5 with numbers',
        paragraph:
            'The checkout latency work took p95 from 800ms to 180ms, and the payments design ' +
            'review you ran changed how that team handles webhook retries.',
        mix: [
            { category: 'shipped', count: 3 },
            { category: 'improved', count: 4 },
            { category: 'influenced', count: 1 },
            { category: 'grew', count: 0 },
        ],
        mixSentence:
            'Four of eight wins were `improved`. Only one was `influenced`, and none were `grew`.',
        observation:
            'None of your wins this month mention business impact — revenue, cost, or user numbers. ' +
            "For a Staff-level case that's usually required.",
        receipt:
            'This review drew on 8 wins from July, 5 with evidence. Your record now holds 74 wins — ' +
            '12 of them from more than 90 days ago.',
        winCount: 8,
        reviewUrl: 'https://app.example.com/log/review/2026-07',
        packetUrl: 'https://app.example.com/packets/new',
        logUrl: 'https://app.example.com/log',
        ...overrides,
    };
}

describe('the mix line', () => {
    test('scales the bars to the largest count and marks an empty category', () => {
        const line = renderMixLine([
            { category: 'improved', count: 4 },
            { category: 'shipped', count: 2 },
            { category: 'grew', count: 0 },
        ]);
        expect(line).toBe('improved ▓▓▓▓▓▓   shipped ▓▓▓   grew ·');
    });

    test('renders nothing for a month with no counted work', () => {
        expect(renderMixLine([{ category: 'grew', count: 0 }])).toBe('');
    });
});

describe('the month in review email', () => {
    const rendered = monthInReviewTemplate.render(makeData(), ctx);

    test('is governed by the monthlyReview preference and is not critical mail', () => {
        expect(monthInReviewTemplate.key).toBe(MONTH_IN_REVIEW_TEMPLATE_KEY);
        expect(monthInReviewTemplate.category).toBe('monthlyReview');
        expect(monthInReviewTemplate.critical).toBeUndefined();
    });

    test('the subject is the real count, never a generic label', () => {
        expect(rendered.subject).toBe('July: 8 wins, 5 with numbers');
        expect(rendered.subject.toLowerCase()).not.toContain('summary');
        expect(rendered.subject.toLowerCase()).not.toContain('digest');
        expect(rendered.subject.toLowerCase()).not.toContain('your month');
    });

    test('carries all five blocks of §E in order', () => {
        const text = rendered.text;
        const order = [
            'July 2026',
            '8 wins, 5 with hard numbers',
            'The checkout latency work',
            'Your mix',
            'Four of eight wins were improved',
            'Worth knowing',
            'None of your wins this month mention business impact',
            'Start your review packet',
        ];
        let cursor = -1;
        for (const fragment of order) {
            const index = text.indexOf(fragment);
            expect({ fragment, found: index >= 0 }).toEqual({ fragment, found: true });
            expect(index).toBeGreaterThan(cursor);
            cursor = index;
        }
    });

    test('states the receipt, including the clause about wins older than 90 days', () => {
        expect(rendered.text).toContain('This review drew on 8 wins from July, 5 with evidence');
        expect(rendered.text).toContain('12 of them from more than 90 days ago');
        expect(rendered.html).toContain('12 of them from more than 90 days ago');
    });

    test('never celebrates, and never celebrates the tool', () => {
        const copy = `${rendered.subject}\n${rendered.text}`;
        expect(copy).not.toContain('!');
        for (const banned of ['great job', 'congrat', 'amazing', 'well done', 'keep it up', 'streak']) {
            expect(copy.toLowerCase()).not.toContain(banned);
        }
    });

    test('the preheader is the substance, not a notification', () => {
        expect(rendered.html).toContain('8 wins, 5 with hard numbers. This review drew on');
        expect(rendered.html.toLowerCase()).not.toContain('is ready to view');
    });

    test('backticks are stripped: they are a web marker, not copy', () => {
        expect(rendered.text).not.toContain('`');
        expect(rendered.html).not.toContain('`');
        expect(rendered.text).toContain('Four of eight wins were improved.');
    });

    test('links to the packet, the log, and the web copy of the same document', () => {
        for (const url of [
            'https://app.example.com/packets/new',
            'https://app.example.com/log',
            'https://app.example.com/log/review/2026-07',
        ]) {
            expect(rendered.text).toContain(url);
        }
    });

    test('a review with no grounded paragraph still sends every other block', () => {
        const withoutParagraph = monthInReviewTemplate.render(makeData({ paragraph: null }), ctx);
        expect(withoutParagraph.text).not.toContain('The checkout latency work');
        expect(withoutParagraph.text).toContain('8 wins, 5 with hard numbers');
        expect(withoutParagraph.text).toContain('Worth knowing');
        expect(withoutParagraph.text).toContain('This review drew on 8 wins from July');
        // No apology and no placeholder where the paragraph would have been.
        expect(withoutParagraph.text.toLowerCase()).not.toContain('could not');
        expect(withoutParagraph.text.toLowerCase()).not.toContain('unavailable');
    });

    test('a month with no specific observation renders no observation block', () => {
        const withoutObservation = monthInReviewTemplate.render(makeData({ observation: null }), ctx);
        expect(withoutObservation.text).not.toContain('Worth knowing');
        expect(withoutObservation.text).toContain('Start your review packet');
    });

    test('escapes hostile content rather than rendering it', () => {
        const hostile = monthInReviewTemplate.render(
            makeData({ paragraph: '<script>alert(1)</script>' }),
            ctx,
        );
        expect(hostile.html).not.toContain('<script>alert(1)</script>');
        expect(hostile.html).toContain('&lt;script&gt;');
    });
});
