/**
 * The shared email layout shell (design/02 §K, ADR-4).
 *
 * Constraints this file exists to enforce, so no template author has to:
 *   - 600px, table-based, `role="presentation"` throughout
 *   - every style inline (a <style> block is present ONLY for the dark-mode
 *     media query, which cannot be expressed inline)
 *   - no web fonts — system stack only
 *   - fully functional with images disabled: there are no <img> tags anywhere.
 *     Every action is a real <a href>, never an image.
 *   - a plain-text alternative is produced from the same call, so it can never
 *     drift from the HTML or be forgotten
 *
 * COMPOSITION RULE: a block is one or more `<tr>` rows. `renderEmail` drops them
 * into the 600px card table. Helpers that group other blocks (`section`) nest a
 * full table inside a `<td>`. Template authors write structure — never table soup.
 */

/** A rendered fragment: the HTML rows and the plain-text equivalent. */
export type EmailBlock = { html: string; text: string };

/** Inline content. A bare string is plain text; the object form adds a link or weight. */
export type Inline =
    | string
    | { text: string; href?: string; bold?: boolean; muted?: boolean };

export const EMAIL_MAX_WIDTH = 600;

export const EMAIL_BRAND = 'PATRONUS';

/** System stack only — no web fonts (they are stripped or blocked by most clients). */
export const EMAIL_FONT_STACK =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Derived from the design tokens in docs/design/00-foundations.md §3, converted
 * to hex because email clients do not support CSS custom properties.
 *
 * One deliberate divergence: dark `muted` is lightened from the app token
 * (`215 12% 52%` = #768293, ~3.9:1 on the dark card) to #9aa6b6 (~7:1). The
 * foundations contrast floor is 4.5:1 and email has no theme toggle to escape to.
 */
export const emailPalette = {
    light: {
        pageBg: '#f3f5f7',
        cardBg: '#ffffff',
        subtleBg: '#f7f9fb',
        text: '#141a29',
        muted: '#5c697a',
        border: '#dee2e8',
        accent: '#1879bf',
        accentText: '#ffffff',
    },
    dark: {
        pageBg: '#090d16',
        cardBg: '#10141e',
        subtleBg: '#151b27',
        text: '#f3f5f7',
        muted: '#9aa6b6',
        border: '#202732',
        accent: '#7bc2f4',
        accentText: '#0c111d',
    },
} as const;

const L = emailPalette.light;
const D = emailPalette.dark;

const GUTTER = 32;

// ---------------------------------------------------------------------------
// Escaping and URL safety
// ---------------------------------------------------------------------------

/** HTML-escape. Applied to every piece of caller-supplied text, without exception. */
export function escapeHtml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Only http(s) and mailto survive. Anything else (javascript:, data:, a relative
 * path that would resolve against the mail client) collapses to '#', because a
 * broken link in an email cannot be hotfixed after it is delivered.
 */
export function safeUrl(href: string): string {
    const trimmed = String(href ?? '').trim();
    if (!trimmed) return '#';
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
            return parsed.toString();
        }
    } catch {
        return '#';
    }
    return '#';
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function toInlineArray(content: Inline | Inline[]): Inline[] {
    return Array.isArray(content) ? content : [content];
}

function renderInlineHtml(content: Inline | Inline[], linkColor: string): string {
    return toInlineArray(content)
        .map((part) => {
            if (typeof part === 'string') return escapeHtml(part);
            const inner = part.bold ? `<strong>${escapeHtml(part.text)}</strong>` : escapeHtml(part.text);
            if (part.href) {
                return `<a class="p-link" href="${escapeHtml(safeUrl(part.href))}" style="color:${linkColor};text-decoration:underline;">${inner}</a>`;
            }
            if (part.muted) {
                return `<span class="p-muted" style="color:${L.muted};">${inner}</span>`;
            }
            return inner;
        })
        .join('');
}

function renderInlineText(content: Inline | Inline[]): string {
    return toInlineArray(content)
        .map((part) => {
            if (typeof part === 'string') return part;
            if (!part.href) return part.text;
            // The URL is spelled out — a plain-text reader has no other way to reach
            // it — but not twice when the label already is the URL.
            const url = safeUrl(part.href);
            return part.text === url || part.text === part.href ? url : `${part.text} <${url}>`;
        })
        .join('');
}

/** Greedy word wrap for the plain-text part. Long unbreakable tokens (URLs) are left intact. */
export function wrapText(input: string, width = 72): string {
    return input
        .split('\n')
        .map((line) => {
            if (line.length <= width) return line;
            const out: string[] = [];
            let current = '';
            for (const word of line.split(' ')) {
                if (!current) {
                    current = word;
                } else if (`${current} ${word}`.length <= width) {
                    current = `${current} ${word}`;
                } else {
                    out.push(current);
                    current = word;
                }
            }
            if (current) out.push(current);
            return out.join('\n');
        })
        .join('\n');
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function row(inner: string): string {
    return `<tr>${inner}</tr>`;
}

/** Masthead: brand on the left, an optional string (a date range, say) on the right. */
export function header(options: { right?: string } = {}): EmailBlock {
    const right = options.right
        ? `<td align="right" class="p-muted" style="font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:18px;color:${L.muted};white-space:nowrap;">${escapeHtml(options.right)}</td>`
        : '';
    return {
        html: row(
            `<td class="p-gutter" style="padding:${GUTTER}px ${GUTTER}px 0;">` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
            `<td align="left" class="p-text" style="font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.12em;color:${L.text};">${escapeHtml(EMAIL_BRAND)}</td>` +
            right +
            `</tr></table>` +
            `</td>`
        ),
        text: options.right ? `${EMAIL_BRAND}    ${options.right}` : EMAIL_BRAND,
    };
}

export function heading(content: Inline | Inline[], options: { level?: 1 | 2 } = {}): EmailBlock {
    const level = options.level ?? 1;
    const size = level === 1 ? 24 : 17;
    const lineHeight = level === 1 ? 31 : 24;
    const topPadding = level === 1 ? 24 : 20;
    const text = renderInlineText(content);
    return {
        html: row(
            `<td class="p-text p-gutter" style="padding:${topPadding}px ${GUTTER}px 0;font-family:${EMAIL_FONT_STACK};font-size:${size}px;line-height:${lineHeight}px;font-weight:600;color:${L.text};">` +
            renderInlineHtml(content, L.accent) +
            `</td>`
        ),
        text: level === 1 ? `${text}\n${'='.repeat(Math.min(text.length, 60))}` : text,
    };
}

export function paragraph(content: Inline | Inline[], options: { muted?: boolean; small?: boolean } = {}): EmailBlock {
    const color = options.muted ? L.muted : L.text;
    const cls = options.muted ? 'p-muted' : 'p-text';
    const size = options.small ? 13 : 15;
    const lineHeight = options.small ? 20 : 23;
    return {
        html: row(
            `<td class="${cls} p-gutter" style="padding:12px ${GUTTER}px 0;font-family:${EMAIL_FONT_STACK};font-size:${size}px;line-height:${lineHeight}px;color:${color};">` +
            renderInlineHtml(content, L.accent) +
            `</td>`
        ),
        text: renderInlineText(content),
    };
}

/** Small uppercase label — used for provenance lines ("From: PR #482 · patronus/api"). */
export function eyebrow(content: Inline | Inline[]): EmailBlock {
    return {
        html: row(
            `<td class="p-muted p-gutter" style="padding:10px ${GUTTER}px 0;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:16px;letter-spacing:0.06em;text-transform:uppercase;color:${L.muted};">` +
            renderInlineHtml(content, L.accent) +
            `</td>`
        ),
        text: renderInlineText(content),
    };
}

export function bulletList(items: Array<Inline | Inline[]>): EmailBlock {
    const rows = items
        .map(
            (item) =>
                `<tr>` +
                `<td valign="top" class="p-muted" style="padding:6px 8px 0 0;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:23px;color:${L.muted};">&bull;</td>` +
                `<td valign="top" class="p-text" style="padding:6px 0 0;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:23px;color:${L.text};">${renderInlineHtml(item, L.accent)}</td>` +
                `</tr>`
        )
        .join('');
    return {
        html: row(
            `<td class="p-gutter" style="padding:6px ${GUTTER}px 0;">` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>` +
            `</td>`
        ),
        text: items.map((item) => `  - ${renderInlineText(item)}`).join('\n'),
    };
}

export function divider(): EmailBlock {
    return {
        html: row(
            `<td class="p-gutter" style="padding:24px ${GUTTER}px;">` +
            `<div class="p-rule" style="height:1px;line-height:1px;font-size:0;background-color:${L.border};">&nbsp;</div>` +
            `</td>`
        ),
        text: '-'.repeat(48),
    };
}

export function spacer(height = 16): EmailBlock {
    return {
        html: row(`<td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td>`),
        text: '',
    };
}

export type ButtonSpec = { label: string; href: string; variant?: 'primary' | 'secondary' };

function buttonCell(spec: ButtonSpec): string {
    const secondary = spec.variant === 'secondary';
    const bg = secondary ? 'transparent' : L.accent;
    const fg = secondary ? L.text : L.accentText;
    const border = secondary ? `1px solid ${L.border}` : `1px solid ${L.accent}`;
    const cls = secondary ? 'p-btn-secondary' : 'p-btn';
    const anchorCls = secondary ? 'p-btn-secondary-a' : 'p-btn-a';
    // 11 + 18 + 11 = 40px tall; min-width 120px. Thumb targets, per design/02 §K1.
    return (
        `<td class="${cls}" align="center" bgcolor="${secondary ? L.cardBg : L.accent}" style="background-color:${secondary ? L.cardBg : bg};border:${border};border-radius:8px;mso-padding-alt:11px 24px;">` +
        `<a class="${anchorCls}" href="${escapeHtml(safeUrl(spec.href))}" style="display:inline-block;min-width:120px;padding:11px 24px;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:18px;font-weight:600;color:${fg};text-decoration:none;text-align:center;">${escapeHtml(spec.label)}</a>` +
        `</td>`
    );
}

function buttonTextLines(specs: ButtonSpec[]): string {
    return specs.map((spec) => `  ${spec.label}: ${safeUrl(spec.href)}`).join('\n');
}

export function button(spec: ButtonSpec): EmailBlock {
    return buttonRow([spec]);
}

/** One or more buttons side by side. Always real links — never images. */
export function buttonRow(specs: ButtonSpec[], options: { align?: 'left' | 'center' } = {}): EmailBlock {
    if (specs.length === 0) return { html: '', text: '' };
    const align = options.align ?? 'left';
    const cells = specs.map(buttonCell).join(`<td style="width:10px;line-height:10px;font-size:0;">&nbsp;</td>`);
    return {
        html: row(
            `<td class="p-gutter" align="${align}" style="padding:20px ${GUTTER}px 0;">` +
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>${cells}</tr></table>` +
            `</td>`
        ),
        text: buttonTextLines(specs),
    };
}

/**
 * Groups blocks into a tinted, optionally rule-marked panel. Nested table, so the
 * child rows keep working unchanged.
 */
export function section(blocks: EmailBlock[], options: { tone?: 'plain' | 'subtle' } = {}): EmailBlock {
    const tinted = options.tone === 'subtle';
    const inner = blocks.map((b) => b.html).join('');
    const bg = tinted ? ` bgcolor="${L.subtleBg}"` : '';
    const bgStyle = tinted ? `background-color:${L.subtleBg};border-radius:10px;` : '';
    const cls = tinted ? ' class="p-subtle"' : '';
    return {
        html: row(
            `<td style="padding:8px ${GUTTER / 2}px 0;">` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${cls}${bg} style="${bgStyle}">${inner}</table>` +
            `</td>`
        ),
        text: blocks
            .map((b) => b.text)
            .filter(Boolean)
            .join('\n\n'),
    };
}

/**
 * The footer. `unsubscribeUrl` is required — there is no code path that sends an
 * email without a visible unsubscribe, independent of the List-Unsubscribe header.
 */
export function footer(options: {
    unsubscribeUrl: string;
    preferencesUrl?: string;
    summary?: string;
    address?: string;
}): EmailBlock {
    const links: string[] = [];
    const textLinks: string[] = [];
    if (options.preferencesUrl) {
        links.push(
            `<a class="p-link" href="${escapeHtml(safeUrl(options.preferencesUrl))}" style="color:${L.muted};text-decoration:underline;">Change when you get this</a>`
        );
        textLinks.push(`Change when you get this: ${safeUrl(options.preferencesUrl)}`);
    }
    links.push(
        `<a class="p-link" href="${escapeHtml(safeUrl(options.unsubscribeUrl))}" style="color:${L.muted};text-decoration:underline;">Unsubscribe</a>`
    );
    textLinks.push(`Unsubscribe: ${safeUrl(options.unsubscribeUrl)}`);

    const summaryHtml = options.summary
        ? `<div class="p-muted" style="font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:18px;color:${L.muted};padding-bottom:6px;">${escapeHtml(options.summary)}</div>`
        : '';
    const addressHtml = options.address
        ? `<div class="p-muted" style="font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:18px;color:${L.muted};padding-top:6px;">${escapeHtml(options.address)}</div>`
        : '';

    return {
        html: row(
            `<td class="p-gutter" align="center" style="padding:20px ${GUTTER}px 8px;">` +
            summaryHtml +
            `<div class="p-muted" style="font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:18px;color:${L.muted};">${links.join(' &nbsp;·&nbsp; ')}</div>` +
            addressHtml +
            `</td>`
        ),
        text: [options.summary, ...textLinks, options.address].filter(Boolean).join('\n'),
    };
}

// ---------------------------------------------------------------------------
// Document shell
// ---------------------------------------------------------------------------

/**
 * The dark-mode media query. This is the one thing that cannot be inlined, so it
 * is the only rule in the document's <style> block. Everything it overrides also
 * has an inline light-mode value, so a client that strips <style> still renders.
 *
 * `[data-ogsc]` covers Outlook.com's dark mode, which rewrites inline colors and
 * ignores prefers-color-scheme.
 */
function darkModeStyles(): string {
    const overrides = `
      .p-body { background-color: ${D.pageBg} !important; }
      .p-card { background-color: ${D.cardBg} !important; border-color: ${D.border} !important; }
      .p-text { color: ${D.text} !important; }
      .p-muted { color: ${D.muted} !important; }
      .p-rule { background-color: ${D.border} !important; }
      .p-subtle { background-color: ${D.subtleBg} !important; }
      .p-link { color: ${D.muted} !important; }
      .p-text .p-link, .p-muted .p-link { color: ${D.accent} !important; }
      .p-btn { background-color: ${D.accent} !important; border-color: ${D.accent} !important; }
      .p-btn-a { color: ${D.accentText} !important; }
      .p-btn-secondary { background-color: ${D.cardBg} !important; border-color: ${D.border} !important; }
      .p-btn-secondary-a { color: ${D.text} !important; }
    `;
    return (
        `:root { color-scheme: light dark; supported-color-schemes: light dark; }\n` +
        `a { color: ${L.accent}; }\n` +
        `@media (prefers-color-scheme: dark) {${overrides}}\n` +
        `[data-ogsc] .p-body { background-color: ${D.pageBg} !important; }\n` +
        `[data-ogsc] .p-card { background-color: ${D.cardBg} !important; border-color: ${D.border} !important; }\n` +
        `[data-ogsc] .p-text { color: ${D.text} !important; }\n` +
        `[data-ogsc] .p-muted { color: ${D.muted} !important; }\n` +
        `[data-ogsc] .p-rule { background-color: ${D.border} !important; }\n` +
        `@media only screen and (max-width: 620px) {\n` +
        `  .p-shell { width: 100% !important; }\n` +
        `  .p-gutter { padding-left: 20px !important; padding-right: 20px !important; }\n` +
        `}\n`
    );
}

/**
 * Hidden preheader. The zero-width padding stops Gmail from pulling body copy in
 * after the preheader text in the inbox preview.
 */
function preheaderHtml(preheader: string): string {
    const pad = '&#847;&zwnj;&nbsp;'.repeat(60);
    return (
        `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">` +
        `${escapeHtml(preheader)}${pad}` +
        `</div>`
    );
}

export type RenderEmailInput = {
    /** Becomes <title>. Not shown in the body — use a `heading` block for that. */
    title: string;
    /** Inbox preview line. Required: without it clients scrape the first body text. */
    preheader: string;
    blocks: EmailBlock[];
    /** Built with `footer()`. Required — every email carries a visible unsubscribe. */
    footer: EmailBlock;
    /** Right-hand masthead string, e.g. a date range. Omit for no masthead. */
    headerRight?: string;
    /** Set false to drop the masthead entirely (magic-link style emails). */
    showHeader?: boolean;
};

/** Renders the HTML document and the plain-text alternative from one block list. */
export function renderEmail(input: RenderEmailInput): { html: string; text: string } {
    const showHeader = input.showHeader ?? true;
    const bodyBlocks = showHeader ? [header({ right: input.headerRight }), ...input.blocks] : input.blocks;

    const cardRows = bodyBlocks.map((b) => b.html).join('');
    const footerRows = input.footer.html;

    const html =
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `<meta charset="utf-8">\n` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
        `<meta http-equiv="X-UA-Compatible" content="IE=edge">\n` +
        `<meta name="x-apple-disable-message-reformatting">\n` +
        `<meta name="color-scheme" content="light dark">\n` +
        `<meta name="supported-color-schemes" content="light dark">\n` +
        `<title>${escapeHtml(input.title)}</title>\n` +
        `<style>${darkModeStyles()}</style>\n` +
        `</head>\n` +
        `<body class="p-body" style="margin:0;padding:0;width:100%;background-color:${L.pageBg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">\n` +
        preheaderHtml(input.preheader) +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="p-body" style="background-color:${L.pageBg};width:100%;">` +
        `<tr><td align="center" style="padding:24px 12px;">` +
        `<table role="presentation" class="p-card p-shell" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_MAX_WIDTH}px;max-width:${EMAIL_MAX_WIDTH}px;background-color:${L.cardBg};border:1px solid ${L.border};border-radius:12px;">` +
        cardRows +
        `<tr><td style="height:${GUTTER}px;line-height:${GUTTER}px;font-size:0;">&nbsp;</td></tr>` +
        `</table>` +
        `<table role="presentation" class="p-shell" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_MAX_WIDTH}px;max-width:${EMAIL_MAX_WIDTH}px;">` +
        footerRows +
        `</table>` +
        `</td></tr></table>\n` +
        `</body>\n` +
        `</html>`;

    const textBody = bodyBlocks
        .map((b) => b.text)
        .filter((t) => t.length > 0)
        .join('\n\n');
    const text = wrapText(`${textBody}\n\n${'-'.repeat(48)}\n${input.footer.text}`.replace(/\n{3,}/g, '\n\n'));

    return { html, text };
}
