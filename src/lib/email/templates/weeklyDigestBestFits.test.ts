import { describe, expect, test } from 'bun:test';
import {
    bestFitLine,
    bestFitsWaitingLine,
    renderTelegramDigest,
    toTelegramView,
    weeklyDigestTemplate,
    type DigestBestFits,
    type WeeklyDigestData,
} from './weeklyDigest';

const APP = 'https://aicv.theweekendworld.com';

const base: WeeklyDigestData = {
    dateRange: 'Sep 21 – 27',
    sendDateLabel: 'Friday, Sep 26',
    wins: [{
        winId: 'w1',
        title: 'Shipped the retry queue',
        narrative: '',
        provenance: null,
        confirmUrl: `${APP}/w/a`,
        editUrl: `${APP}/w/b`,
        dismissUrl: `${APP}/w/c`,
    }],
    overflow: 0,
    addWinUrl: `${APP}/log?compose=1`,
    logUrl: `${APP}/log`,
    totalConfirmed: 3,
    streakWeeks: 2,
};

const fits: DigestBestFits = {
    items: [
        { role: 'Backend Engineer', company: 'Nightfall AI', verdictLabel: 'Possible fit', score: 56, city: 'Bengaluru', url: `${APP}/scout/run1` },
        { role: 'SDE II', company: 'Amazon', verdictLabel: 'Strong fit', score: 81, city: 'Chennai', url: `${APP}/scout/run2` },
        { role: 'Platform Engineer', company: null, verdictLabel: null, score: null, city: null, url: `${APP}/scout` },
        { role: 'Fourth', company: 'Extra', verdictLabel: 'Stretch', score: 40, city: 'Pune', url: `${APP}/scout/run4` },
    ],
    waiting: 4,
    inboxUrl: `${APP}/scout`,
};

const ctx = { unsubscribeUrl: `${APP}/u`, preferencesUrl: `${APP}/p` };

describe('best fits this week — email', () => {
    test('renders at most three linked lines and the waiting count', () => {
        const { html, text } = weeklyDigestTemplate.render({ ...base, bestFits: fits }, ctx as never);
        expect(text).toContain('Best fits this week');
        expect(text).toContain('Backend Engineer @ Nightfall AI · Possible fit (56) · Bengaluru');
        expect(text).toContain('SDE II @ Amazon · Strong fit (81) · Chennai');
        expect(text).toContain('Platform Engineer');
        expect(text).not.toContain('Fourth @ Extra');
        expect(text).toContain('4 jobs waiting in your inbox');
        expect(html).toContain(`${APP}/scout/run1`);
        expect(html).toContain(`${APP}/scout/run2`);
    });

    test('is absent when there is nothing to show', () => {
        const without = weeklyDigestTemplate.render(base, ctx as never);
        expect(without.text).not.toContain('Best fits this week');
        const empty = weeklyDigestTemplate.render({ ...base, bestFits: { ...fits, items: [] } }, ctx as never);
        expect(empty.text).not.toContain('Best fits this week');
    });

    test('never claims fewer jobs waiting than it just listed', () => {
        expect(bestFitsWaitingLine(1)).toBe('1 job waiting in your inbox');
        const { text } = weeklyDigestTemplate.render({ ...base, bestFits: { ...fits, waiting: 0 } }, ctx as never);
        expect(text).toContain('3 jobs waiting in your inbox');
    });
});

describe('best fits this week — telegram', () => {
    test('the same block, as Markdown links, before the footer', () => {
        const message = renderTelegramDigest(toTelegramView({ ...base, bestFits: fits }));
        expect(message).toContain('*Best fits this week*');
        expect(message).toContain(`(${APP}/scout/run1)`);
        expect(message).not.toContain('Fourth');
        expect(message.indexOf('Best fits this week')).toBeLessThan(message.lastIndexOf('_'));
    });

    test('escapes Markdown in stored fields', () => {
        const message = renderTelegramDigest(toTelegramView({
            ...base,
            bestFits: { ...fits, items: [{ ...fits.items[0], role: 'Senior_Engineer [Payments]' }] },
        }));
        expect(message).toContain('Senior\\_Engineer \\[Payments\\]');
    });

    test('is absent without best fits', () => {
        expect(renderTelegramDigest(toTelegramView(base))).not.toContain('Best fits this week');
    });
});

describe('bestFitLine', () => {
    test('drops what it does not know rather than printing placeholders', () => {
        expect(bestFitLine({ role: 'SRE', company: null, verdictLabel: null, score: null, city: null, url: APP })).toBe('SRE');
        expect(bestFitLine({ role: 'SRE', company: 'Acme', verdictLabel: null, score: 60, city: null, url: APP })).toBe('SRE @ Acme · Fit 60');
    });
});
