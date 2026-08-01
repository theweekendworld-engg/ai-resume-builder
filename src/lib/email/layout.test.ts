import { describe, test, expect } from 'bun:test';
import {
    EMAIL_MAX_WIDTH,
    button,
    buttonRow,
    bulletList,
    divider,
    escapeHtml,
    footer,
    heading,
    paragraph,
    renderEmail,
    safeUrl,
    section,
    wrapText,
} from './layout';

const baseFooter = footer({
    unsubscribeUrl: 'https://app.example.com/api/email/unsubscribe?token=abc',
    preferencesUrl: 'https://app.example.com/settings/notifications',
});

function render(blocks = [heading('Hello'), paragraph('Body copy.')]) {
    return renderEmail({
        title: 'Test email',
        preheader: 'A preheader line',
        blocks,
        footer: baseFooter,
    });
}

describe('escapeHtml', () => {
    test('escapes every character that can break out of an attribute or a text node', () => {
        expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
            '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;'
        );
    });

    test('ampersand is escaped first so entities are not double-broken', () => {
        expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
    });
});

describe('safeUrl', () => {
    test('allows http, https and mailto', () => {
        expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
        expect(safeUrl('http://example.com/')).toBe('http://example.com/');
        expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    });

    test('collapses javascript:, data: and relative paths to #', () => {
        expect(safeUrl('javascript:alert(1)')).toBe('#');
        expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('#');
        expect(safeUrl('/log')).toBe('#');
        expect(safeUrl('')).toBe('#');
    });
});

describe('renderEmail document shell', () => {
    test('produces a complete document', () => {
        const { html } = render();
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('<title>Test email</title>');
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
    });

    test('is 600px and table-based', () => {
        const { html } = render();
        expect(html).toContain(`width:${EMAIL_MAX_WIDTH}px`);
        expect(html).toContain(`max-width:${EMAIL_MAX_WIDTH}px`);
        expect(html).toContain('role="presentation"');
        expect(html).not.toContain('display:flex');
        expect(html).not.toContain('display:grid');
    });

    test('has no images at all — the email must work with images disabled', () => {
        const { html } = render([heading('Hi'), button({ label: 'Go', href: 'https://example.com' })]);
        expect(html).not.toContain('<img');
        expect(html).not.toContain('background-image');
    });

    test('uses no web fonts', () => {
        const { html } = render();
        expect(html).not.toContain('@font-face');
        expect(html).not.toContain('fonts.googleapis');
        expect(html).toContain('-apple-system');
    });

    test('carries a dark-mode media query and a color-scheme declaration', () => {
        const { html } = render();
        expect(html).toContain('@media (prefers-color-scheme: dark)');
        expect(html).toContain('name="color-scheme"');
        expect(html).toContain('name="supported-color-schemes"');
    });

    test('every colour overridden in dark mode also has an inline light value', () => {
        // A client that strips <style> must still render a readable email.
        const { html } = render();
        expect(html).toContain('style="margin:0;padding:0;width:100%;background-color:#f3f5f7');
        expect(html).toContain('color:#141a29');
    });

    test('renders the preheader hidden, before any visible content', () => {
        const { html } = render();
        expect(html).toContain('A preheader line');
        const preheaderIndex = html.indexOf('A preheader line');
        const bodyIndex = html.indexOf('Body copy.');
        expect(preheaderIndex).toBeGreaterThan(-1);
        expect(preheaderIndex).toBeLessThan(bodyIndex);
        expect(html).toContain('display:none;font-size:1px');
    });

    test('always produces a plain-text alternative from the same blocks', () => {
        const { text } = render();
        expect(text).toContain('Hello');
        expect(text).toContain('Body copy.');
        expect(text).toContain('Unsubscribe: https://app.example.com/api/email/unsubscribe?token=abc');
        expect(text).not.toContain('<td');
    });

    test('the masthead can be suppressed', () => {
        const withHeader = render();
        const withoutHeader = renderEmail({
            title: 'T',
            preheader: 'P',
            blocks: [paragraph('x')],
            footer: baseFooter,
            showHeader: false,
        });
        expect(withHeader.text).toContain('PATRONUS');
        expect(withoutHeader.text.startsWith('PATRONUS')).toBe(false);
    });
});

describe('blocks', () => {
    test('a button is a real link, sized for a thumb', () => {
        const block = button({ label: 'Log it', href: 'https://example.com/log' });
        expect(block.html).toContain('<a class="p-btn-a" href="https://example.com/log"');
        expect(block.html).toContain('min-width:120px');
        expect(block.html).toContain('padding:11px 24px'); // 11 + 18 line-height + 11 = 40px
        expect(block.text).toContain('Log it: https://example.com/log');
    });

    test('a hostile button label or href cannot inject markup', () => {
        const block = button({ label: '"><script>x</script>', href: 'javascript:alert(1)' });
        expect(block.html).not.toContain('<script>');
        expect(block.html).toContain('href="#"');
    });

    test('buttonRow renders several actions and lists each URL in the text part', () => {
        const block = buttonRow([
            { label: 'Log it', href: 'https://example.com/a' },
            { label: 'Not a win', href: 'https://example.com/b', variant: 'secondary' },
        ]);
        expect(block.html).toContain('https://example.com/a');
        expect(block.html).toContain('https://example.com/b');
        expect(block.text).toContain('Log it: https://example.com/a');
        expect(block.text).toContain('Not a win: https://example.com/b');
    });

    test('an empty buttonRow renders nothing', () => {
        expect(buttonRow([])).toEqual({ html: '', text: '' });
    });

    test('paragraph links render as anchors in HTML and as spelled-out URLs in text', () => {
        const block = paragraph(['Open ', { text: 'your log', href: 'https://example.com/log' }, '.']);
        expect(block.html).toContain('<a class="p-link" href="https://example.com/log"');
        expect(block.text).toBe('Open your log <https://example.com/log>.');
    });

    test('bulletList renders one row per item', () => {
        const block = bulletList(['one', 'two']);
        expect(block.text).toBe('  - one\n  - two');
        expect(block.html.match(/<tr>/g)?.length).toBe(3); // wrapper row + two items
    });

    test('divider is a styled div, not an <hr> or an image', () => {
        const block = divider();
        expect(block.html).toContain('height:1px');
        expect(block.html).not.toContain('<hr');
        expect(block.html).not.toContain('<img');
    });

    test('section nests child rows and joins their text', () => {
        const block = section([paragraph('a'), paragraph('b')], { tone: 'subtle' });
        expect(block.html).toContain('class="p-subtle"');
        expect(block.text).toBe('a\n\nb');
    });
});

describe('footer', () => {
    test('always includes a visible unsubscribe link even with no preferences URL', () => {
        const block = footer({ unsubscribeUrl: 'https://example.com/u?token=t' });
        expect(block.html).toContain('Unsubscribe');
        expect(block.text).toContain('Unsubscribe: https://example.com/u?token=t');
    });

    test('includes the preferences link and a summary line when supplied', () => {
        const block = footer({
            unsubscribeUrl: 'https://example.com/u?token=t',
            preferencesUrl: 'https://example.com/settings/notifications',
            summary: '14 wins logged · 6 weeks running',
        });
        expect(block.html).toContain('Change when you get this');
        expect(block.text).toContain('14 wins logged');
    });
});

describe('wrapText', () => {
    test('wraps at the requested width on word boundaries', () => {
        const wrapped = wrapText('aaa bbb ccc ddd', 7);
        expect(wrapped).toBe('aaa bbb\nccc ddd');
    });

    test('leaves an unbreakable token (a long URL) intact', () => {
        const url = `https://example.com/${'x'.repeat(120)}`;
        expect(wrapText(url, 72)).toBe(url);
    });

    test('preserves existing newlines', () => {
        expect(wrapText('short\nlines', 72)).toBe('short\nlines');
    });
});
