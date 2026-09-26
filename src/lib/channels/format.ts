/**
 * Channel formatters: `RichMessage` → wire text + buttons.
 *
 * Telegram uses HTML parse mode, not the legacy `Markdown` the rest of the bot
 * sends. HTML needs exactly three escapes (`& < >`), and legacy Markdown has no
 * escape for `_` or `*` at all — a job title like "C++_Dev" or a comp figure
 * like "*₹40 LPA" would otherwise break the whole message.
 *
 * WhatsApp has no parse mode: `*bold*` and `_italic_` are literal characters
 * the client styles. There is no escape, so markers inside user content are
 * neutralised instead of escaped.
 */

import { encodeScoutAction } from '@/lib/channels/scoutActions';
import type { ChannelButton, ChannelLimits, FormattedMessage, Line, RichMessage, ScoutAction, Segment } from '@/lib/channels/types';

export const TELEGRAM_LIMITS: ChannelLimits = { maxText: 4096, maxButtons: 6, maxButtonLabel: 40 };
/** Text body 4096; reply buttons max 3 with 20-char titles (Graph API v25.0). */
export const WHATSAPP_LIMITS: ChannelLimits = { maxText: 4096, maxButtons: 3, maxButtonLabel: 20 };
/** Interactive message body limit — lower than a plain text message. */
export const WHATSAPP_INTERACTIVE_BODY_MAX = 1024;

export function escapeTelegramHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeTelegramAttr(value: string): string {
    return escapeTelegramHtml(value).replace(/"/g, '&quot;');
}

/** WhatsApp has no escape; swap styling markers for look-alikes. */
export function neutraliseWhatsApp(value: string): string {
    return value.replace(/\*/g, '∗').replace(/_/g, 'ˍ').replace(/~/g, '∼').replace(/`/g, 'ˋ');
}

export function truncateLabel(label: string, max: number): string {
    const clean = label.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function renderSegmentTelegram(segment: Segment): string {
    let text = escapeTelegramHtml(segment.text);
    if (segment.href && /^https?:\/\//i.test(segment.href)) {
        text = `<a href="${escapeTelegramAttr(segment.href)}">${text}</a>`;
    }
    if (segment.italic) text = `<i>${text}</i>`;
    if (segment.bold) text = `<b>${text}</b>`;
    return text;
}

function renderSegmentWhatsApp(segment: Segment): string {
    const base = neutraliseWhatsApp(segment.text);
    let text = base.trim() ? base : segment.text;
    if (segment.bold && text.trim()) text = `*${text.trim()}*`;
    if (segment.italic && text.trim()) text = `_${text.trim()}_`;
    if (segment.href && /^https?:\/\//i.test(segment.href) && segment.href !== segment.text) {
        text = `${text}: ${segment.href}`;
    }
    return text;
}

/**
 * Join lines under a hard limit. Lines are dropped from the END (the most
 * important come first by construction), the footer is always kept, and a
 * single overlong line is cut rather than dropped.
 */
export function fitLines(lines: string[], footer: string | null, max: number): string {
    const footerPart = footer ? `\n\n${footer}` : '';
    const budget = max - footerPart.length;
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
        const cost = (kept.length ? 1 : 0) + line.length;
        if (used + cost > budget) {
            if (kept.length === 0) kept.push(`${line.slice(0, Math.max(0, budget - 1))}…`);
            else if (used + 2 <= budget) kept.push('…');
            break;
        }
        kept.push(line);
        used += cost;
    }
    return `${kept.join('\n')}${footerPart}`.slice(0, max);
}

/**
 * A cut through an HTML tag breaks Telegram parsing for the whole message, so
 * lines are clamped before rendering (see `clampLine`) and `fitLines` drops
 * whole lines. The plain-text fallback below covers the pathological case of
 * escaping blowing a single line past the limit.
 */
function renderLine(line: Line, render: (segment: Segment) => string): string {
    return clampLine(line, LINE_TEXT_MAX).map(render).join('');
}

/** Per-line plain-text ceiling, so fitting drops whole lines and never cuts a tag. */
const LINE_TEXT_MAX = 1200;

export function clampLine(line: Line, max: number): Line {
    const out: Line = [];
    let used = 0;
    for (const segment of line) {
        if (used >= max) break;
        const room = max - used;
        const text = segment.text.length > room ? `${segment.text.slice(0, Math.max(0, room - 1))}…` : segment.text;
        out.push({ ...segment, text });
        used += text.length;
    }
    return out;
}

export function formatForTelegram(message: RichMessage, runId: string): FormattedMessage {
    const lines = message.lines.map((line) => renderLine(line, renderSegmentTelegram));
    const footer = message.footer ? renderLine(message.footer, renderSegmentTelegram) : null;
    let text = fitLines(lines, footer, TELEGRAM_LIMITS.maxText);
    if (text.length >= TELEGRAM_LIMITS.maxText && /<[^>]*$/.test(text)) {
        // A cut landed inside a tag. Fall back to plain escaped text.
        const plain = message.lines.map((line) => escapeTelegramHtml(line.map((s) => s.text).join('')));
        text = fitLines(plain, footer, TELEGRAM_LIMITS.maxText);
    }
    return { text, buttons: toButtons(message.actions, runId, TELEGRAM_LIMITS, true) };
}

export function formatForWhatsApp(message: RichMessage, runId: string): FormattedMessage {
    const lines = message.lines.map((line) => renderLine(line, renderSegmentWhatsApp));
    const footer = message.footer ? renderLine(message.footer, renderSegmentWhatsApp) : null;
    return {
        text: fitLines(lines, footer, WHATSAPP_LIMITS.maxText),
        // No URL buttons in WhatsApp reply messages: links travel in the text.
        buttons: toButtons(message.actions, runId, WHATSAPP_LIMITS, false),
    };
}

function isPublicHttps(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.)/.test(parsed.hostname);
    } catch {
        return false;
    }
}

function toButtons(actions: ScoutAction[], runId: string, limits: ChannelLimits, allowUrl: boolean): ChannelButton[] {
    const buttons: ChannelButton[] = [];
    for (const action of actions) {
        if (buttons.length >= limits.maxButtons) break;
        const label = truncateLabel(action.label, limits.maxButtonLabel);
        if (action.kind === 'open') {
            // Telegram rejects the whole message if a URL button points at
            // localhost, so dev keeps the link in the text only.
            if (allowUrl && isPublicHttps(action.url)) buttons.push({ kind: 'url', label, url: action.url });
            continue;
        }
        buttons.push({ kind: 'callback', label, data: encodeScoutAction(runId, action) });
    }
    return buttons;
}

/** Labels this short fit three to a row on a phone without truncating. */
export const COMPACT_LABEL_MAX = 18;
export const MAX_BUTTONS_PER_ROW = 3;

/**
 * Telegram inline keyboard. Consecutive short labels ("💾 Save", "📨 Applied",
 * "❌ Not interested") share a row, up to three; a long label ("Draft referral
 * note") gets a row of its own, because a truncated button is a guess.
 */
export function toTelegramKeyboard(buttons: ChannelButton[]): Record<string, unknown> | undefined {
    if (buttons.length === 0) return undefined;
    const toKey = (button: ChannelButton) => (button.kind === 'url'
        ? { text: button.label, url: button.url }
        : { text: button.label, callback_data: button.data });
    const rows: Array<Array<ReturnType<typeof toKey>>> = [];
    let row: Array<ReturnType<typeof toKey>> = [];
    for (const button of buttons) {
        const compact = [...button.label].length <= COMPACT_LABEL_MAX;
        if (!compact) {
            if (row.length) rows.push(row);
            row = [];
            rows.push([toKey(button)]);
            continue;
        }
        row.push(toKey(button));
        if (row.length === MAX_BUTTONS_PER_ROW) {
            rows.push(row);
            row = [];
        }
    }
    if (row.length) rows.push(row);
    return { inline_keyboard: rows };
}

export type { FormattedMessage };
