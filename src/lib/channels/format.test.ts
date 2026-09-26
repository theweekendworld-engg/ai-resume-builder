import { describe, expect, test } from 'bun:test';
import {
    escapeTelegramHtml,
    fitLines,
    formatForTelegram,
    formatForWhatsApp,
    neutraliseWhatsApp,
    toTelegramKeyboard,
    truncateLabel,
    TELEGRAM_LIMITS,
    WHATSAPP_LIMITS,
} from './format';
import type { RichMessage, ScoutAction } from './types';
import { RUN_ID } from './testViews.test-utils';

describe('telegram escaping', () => {
    test('escapes exactly the three HTML specials', () => {
        expect(escapeTelegramHtml('C++ <Dev> & _ops_ *₹40 LPA*')).toBe('C++ &lt;Dev&gt; &amp; _ops_ *₹40 LPA*');
    });

    test('user content cannot inject a tag or break an href', () => {
        const message: RichMessage = {
            lines: [[{ text: '<b>not bold</b>', bold: true }, { text: 'link', href: 'https://x.com/?a="b"&c' }]],
            actions: [],
        };
        const { text } = formatForTelegram(message, RUN_ID);
        expect(text).toBe('<b>&lt;b&gt;not bold&lt;/b&gt;</b><a href="https://x.com/?a=&quot;b&quot;&amp;c">link</a>');
    });

    test('non-http hrefs are not linked', () => {
        const { text } = formatForTelegram({ lines: [[{ text: 'x', href: 'javascript:alert(1)' }]], actions: [] }, RUN_ID);
        expect(text).toBe('x');
    });
});

describe('whatsapp neutralising', () => {
    test('style markers in content cannot restyle the message', () => {
        expect(neutraliseWhatsApp('*a* _b_ ~c~ `d`')).not.toMatch(/[*_~`]/);
        const { text } = formatForWhatsApp({ lines: [[{ text: '5*3', bold: true }]], actions: [] }, RUN_ID);
        expect(text).toBe('*5∗3*');
    });

    test('links travel as text', () => {
        const { text } = formatForWhatsApp({ lines: [[{ text: 'Open', href: 'https://a.com/x' }]], actions: [] }, RUN_ID);
        expect(text).toBe('Open: https://a.com/x');
    });
});

describe('length limits', () => {
    const many = Array.from({ length: 400 }, (_, i) => [{ text: `line ${i} ${'x'.repeat(40)}` }]);
    const footer = [{ text: 'Full analysis: ' }, { text: 'https://a.com/scout/1', href: 'https://a.com/scout/1' }];

    test('telegram stays under 4096 and always keeps the footer', () => {
        const { text } = formatForTelegram({ lines: many, footer, actions: [] }, RUN_ID);
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_LIMITS.maxText);
        expect(text).toContain('https://a.com/scout/1');
        expect(text).toContain('…');
    });

    test('whatsapp stays under 4096 and keeps the footer', () => {
        const { text } = formatForWhatsApp({ lines: many, footer, actions: [] }, RUN_ID);
        expect(text.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.maxText);
        expect(text.endsWith('https://a.com/scout/1')).toBe(true);
    });

    test('a single enormous line is clamped, and never cut inside a tag', () => {
        const { text } = formatForTelegram({ lines: [[{ text: 'y'.repeat(10_000), bold: true }]], actions: [] }, RUN_ID);
        expect(text.length).toBeLessThanOrEqual(TELEGRAM_LIMITS.maxText);
        expect(text.startsWith('<b>')).toBe(true);
        expect(text.endsWith('</b>')).toBe(true);
    });

    test('fitLines drops whole lines from the end', () => {
        expect(fitLines(['aaaa', 'bbbb', 'cccc'], null, 10)).toBe('aaaa\nbbbb');
    });
});

describe('buttons', () => {
    const actions: ScoutAction[] = [
        { kind: 'draft', target: 'f', format: 'n', label: 'Draft referral note' },
        { kind: 'why', label: 'Why not a fit' },
        { kind: 'refresh', label: 'Refresh' },
        { kind: 'answer', index: 0, label: 'A very long option label that overflows' },
        { kind: 'open', label: 'Open in Patronus', url: 'https://aicv.theweekendworld.com/scout/x' },
    ];

    test('whatsapp gets at most 3 reply buttons with ≤20-char titles and no URL buttons', () => {
        const { buttons } = formatForWhatsApp({ lines: [], actions }, RUN_ID);
        expect(buttons).toHaveLength(3);
        for (const button of buttons) {
            expect(button.kind).toBe('callback');
            expect(button.label.length).toBeLessThanOrEqual(20);
        }
    });

    test('telegram callback data fits in 64 bytes', () => {
        const { buttons } = formatForTelegram({ lines: [], actions }, RUN_ID);
        for (const button of buttons) {
            if (button.kind === 'callback') expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
        }
        expect(buttons.some((button) => button.kind === 'url')).toBe(true);
    });

    test('telegram drops URL buttons that point at localhost (Telegram rejects the whole message)', () => {
        const { buttons } = formatForTelegram({
            lines: [],
            actions: [{ kind: 'open', label: 'Open', url: 'http://localhost:3000/scout/x' }],
        }, RUN_ID);
        expect(buttons).toHaveLength(0);
        expect(toTelegramKeyboard(buttons)).toBeUndefined();
    });

    test('truncateLabel keeps short labels and ellipsises long ones', () => {
        expect(truncateLabel('Short', 20)).toBe('Short');
        expect(truncateLabel('This label is far too long', 20)).toHaveLength(20);
    });
});
