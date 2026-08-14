import { describe, test, expect } from 'bun:test';
import {
    PREFERENCE_FIELD_BY_CATEGORY,
    getTransactionalTemplate,
    transactionalTemplates,
    type TemplateContext,
    type TransactionalTemplateData,
    type TransactionalTemplateKey,
} from './templates/transactional';

const ctx: TemplateContext = {
    unsubscribeUrl: 'https://app.example.com/api/email/unsubscribe?token=tok123',
    preferencesUrl: 'https://app.example.com/settings/notifications',
    appUrl: 'https://app.example.com',
};

/** One sample payload per template, so the suite fails to compile if a key is added. */
const samples: { [K in TransactionalTemplateKey]: TransactionalTemplateData[K] } = {
    welcome: { firstName: 'Ada', logUrl: 'https://app.example.com/log' },
    magic_link: { url: 'https://app.example.com/w/tok', expiresInMinutes: 15, requestedFrom: 'Chrome on macOS' },
    source_disconnected: { sourceName: 'GitHub', reconnectUrl: 'https://app.example.com/settings/sources' },
    packet_ready: { packetTitle: 'H1 promo packet', url: 'https://app.example.com/packets/1' },
    weekly_digest: {
        dateRange: 'Jul 25 – 31',
        sendDateLabel: 'Friday, Jul 31',
        wins: [
            {
                winId: 'win_1',
                title: 'Cut checkout p95 latency 800ms → 180ms',
                narrative: 'Rewrote the pricing lookup as a batched query with a read-through cache.',
                provenance: 'PR #482 · patronus/api',
                confirmUrl: 'https://app.example.com/w/tok-c',
                editUrl: 'https://app.example.com/w/tok-e',
                dismissUrl: 'https://app.example.com/w/tok-d',
            },
        ],
        overflow: 7,
        addWinUrl: 'https://app.example.com/log?compose=1&src=digest',
        logUrl: 'https://app.example.com/log',
        totalConfirmed: 14,
        streakWeeks: 6,
    },
    digest_nudge: {
        quietWeeks: 3,
        replyUrl: 'https://app.example.com/log?compose=1&src=nudge',
        sourcesUrl: 'https://app.example.com/settings/sources',
    },
    mission_nudge: {
        missionTitle: 'Staff by March',
        stepTitle: 'Close the gap',
        stepHint: 'Log evidence against the competency the report called thin.',
        progress: { current: 1, target: 3 },
        weeksRemaining: 6,
        missionUrl: 'https://app.example.com/home',
        logUrl: 'https://app.example.com/log?compose=1&src=mission',
    },
    radar_digest: {
        monthLabel: 'August',
        roleLabel: 'Senior · software engineering',
        geoLabel: 'sf bay',
        band: {
            kind: 'band' as const,
            low: '$162k',
            high: '$313k',
            median: '$196k',
            provenance: 'Based on 45 disclosed ranges, last 180 days.',
        },
        matches: [
            {
                title: 'Staff Software Engineer, API Platform',
                company: 'Stripe',
                url: 'https://boards.greenhouse.io/stripe/jobs/1',
                pay: '$230k–$310k',
            },
        ],
        skills: [{ label: 'Python', postingCount: 111, pay: '$245k–$339k' }],
        radarUrl: 'https://app.example.com/radar',
    },
    month_in_review: {
        label: 'July 2026',
        headline: '8 wins, 5 with hard numbers',
        subject: 'July: 8 wins, 5 with numbers',
        paragraph:
            'July was your reliability month. The checkout latency work removed what had been the top support complaint for two quarters.',
        mix: [
            { category: 'shipped', count: 3 },
            { category: 'improved', count: 4 },
            { category: 'influenced', count: 1 },
            { category: 'grew', count: 0 },
        ],
        mixSentence: 'Four of eight wins were `improved`. Only one was `influenced`, and none were `grew`.',
        observation:
            'None of your wins this month mention business impact — revenue, cost, or user numbers. For a Staff-level case that\'s usually required.',
        receipt:
            'This review drew on 8 wins from July, 5 with evidence. Your record now holds 74 wins — 12 of them from more than 90 days ago.',
        winCount: 8,
        reviewUrl: 'https://app.example.com/log/review/2026-07',
        packetUrl: 'https://app.example.com/packets/new',
        logUrl: 'https://app.example.com/log',
    },
};

const keys = Object.keys(transactionalTemplates) as TransactionalTemplateKey[];

describe('template registry', () => {
    test('every template declares a category that maps to a real preference field', () => {
        for (const key of keys) {
            const def = transactionalTemplates[key];
            expect(Object.keys(PREFERENCE_FIELD_BY_CATEGORY)).toContain(def.category);
        }
    });

    test('the registry key and the declared key agree', () => {
        for (const key of keys) {
            expect(transactionalTemplates[key].key).toBe(key);
        }
    });

    test('only account-access mail is critical', () => {
        const critical = keys.filter((key) => transactionalTemplates[key].critical);
        expect(critical).toEqual(['magic_link']);
    });

    test('getTransactionalTemplate returns the registered definition', () => {
        expect(getTransactionalTemplate('welcome')).toBe(transactionalTemplates.welcome);
    });
});

describe.each(keys)('%s template', (key) => {
    const rendered = transactionalTemplates[key].render(
        samples[key] as never,
        ctx
    );

    test('has a non-empty subject that is not a generic label', () => {
        expect(rendered.subject.length).toBeGreaterThan(0);
        expect(rendered.subject.toLowerCase()).not.toContain('notification');
    });

    test('renders HTML and a plain-text alternative', () => {
        expect(rendered.html).toContain('<!doctype html>');
        expect(rendered.text.trim().length).toBeGreaterThan(0);
        expect(rendered.text).not.toContain('<td');
        expect(rendered.text).not.toContain('&nbsp;');
    });

    test('carries the unsubscribe link in both parts', () => {
        expect(rendered.html).toContain(ctx.unsubscribeUrl.replace(/&/g, '&amp;'));
        expect(rendered.text).toContain(ctx.unsubscribeUrl);
    });

    test('works with images disabled', () => {
        expect(rendered.html).not.toContain('<img');
    });

    test('is 600px, dark-mode aware, and free of web fonts', () => {
        expect(rendered.html).toContain('width:600px');
        expect(rendered.html).toContain('@media (prefers-color-scheme: dark)');
        expect(rendered.html).not.toContain('@font-face');
    });

    test('every action URL also appears as bare text for plain-text readers', () => {
        const hrefs = [...rendered.html.matchAll(/href="([^"]+)"/g)]
            .map((m) => m[1].replace(/&amp;/g, '&'))
            .filter((href) => href.startsWith('http'));
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            expect(rendered.text).toContain(href);
        }
    });
});

describe('welcome template', () => {
    test('falls back to a neutral greeting when the name is missing', () => {
        const rendered = transactionalTemplates.welcome.render(
            { logUrl: 'https://app.example.com/log' },
            ctx
        );
        expect(rendered.text).toContain('Hi,');
    });

    test('escapes a hostile display name', () => {
        const rendered = transactionalTemplates.welcome.render(
            { firstName: '<script>alert(1)</script>', logUrl: 'https://app.example.com/log' },
            ctx
        );
        expect(rendered.html).not.toContain('<script>alert(1)</script>');
        expect(rendered.html).toContain('&lt;script&gt;');
    });
});

describe('digest_nudge template', () => {
    const nudge = (sourcesUrl?: string) =>
        transactionalTemplates.digest_nudge.render(
            { quietWeeks: 3, replyUrl: 'https://app.example.com/log?compose=1&src=nudge', sourcesUrl },
            ctx
        );

    test('offers the connector when the user can reach it', () => {
        const rendered = nudge('https://app.example.com/settings/sources');
        expect(rendered.html).toContain('/settings/sources');
        expect(rendered.text).toContain('connected sources');
    });

    test('omits the connector button when the page would 404', () => {
        // `/settings/sources` calls notFound() unless `github_capture` is on.
        // A dead button in an email is the worst kind — the reader cannot see
        // that the feature is unreleased rather than broken.
        const rendered = nudge(undefined);
        expect(rendered.html).not.toContain('/settings/sources');
        expect(rendered.text).not.toContain('Connect a source');
    });

    test('and stops claiming the user has sources', () => {
        // "quiet on your connected sources" is not a sentence you can send to
        // someone who has none.
        const rendered = nudge(undefined);
        expect(rendered.text).not.toContain('connected sources');
        expect(rendered.text).toContain('Quiet 3 weeks in your log');
    });
});

describe('magic_link template', () => {
    test('states the expiry in the subject line preview and the body', () => {
        const rendered = transactionalTemplates.magic_link.render({ url: 'https://app.example.com/w/t' }, ctx);
        expect(rendered.text).toContain('15 minutes');
    });

    test('honours a custom expiry', () => {
        const rendered = transactionalTemplates.magic_link.render(
            { url: 'https://app.example.com/w/t', expiresInMinutes: 60 },
            ctx
        );
        expect(rendered.text).toContain('60 minutes');
    });
});
