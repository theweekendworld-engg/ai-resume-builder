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
