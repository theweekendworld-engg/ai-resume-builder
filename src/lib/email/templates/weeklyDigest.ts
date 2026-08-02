/**
 * The weekly digest email — design/02 §K1, PRD 01 §5.2.
 *
 * §K1's layout IS the spec and its copy is final. Two templates live here:
 *
 *   `weekly_digest`  the ritual itself — up to five drafts, three real links each
 *   `digest_nudge`   the 3-empty-week prompt, which is NOT a digest and must
 *                    never look like one (PRD 01 §5.2: a "nothing this week"
 *                    email is the fastest path to an unsubscribe)
 *
 * Nothing here touches Prisma, Resend or process.env — everything the copy
 * needs arrives as data, which is what makes the whole surface renderable in a
 * unit test. Every block comes from `../layout`, so the plain-text alternative
 * is produced by the same call as the HTML and cannot drift.
 */

import {
    button,
    buttonRow,
    divider,
    eyebrow,
    footer,
    heading,
    paragraph,
    renderEmail,
    section,
    spacer,
    type EmailBlock,
} from '../layout';
import type { RenderedEmail, TemplateDefinition } from './transactional';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type DigestWinItem = {
    winId: string;
    title: string;
    /** One or two sentences. Empty is fine — plenty of drafts have no narrative. */
    narrative: string;
    /** "PR #482 · patronus/api". Null when the Win has no addressable source. */
    provenance: string | null;
    confirmUrl: string;
    editUrl: string;
    dismissUrl: string;
};

export type WeeklyDigestData = {
    /** "Jul 25 – 31", already formatted in the user's timezone by the caller. */
    dateRange: string;
    /** "Friday, Jul 31" — goes in the preheader, next to "Confirm in 20 seconds". */
    sendDateLabel: string;
    wins: DigestWinItem[];
    /** Drafts that did not make the top five. Renders as "+7 more in your log". */
    overflow: number;
    /** One-tap prefilled compose page. */
    addWinUrl: string;
    logUrl: string;
    /** "14 wins logged · 6 weeks running" */
    totalConfirmed: number;
    streakWeeks: number;
    /**
     * Set on the first send after 4 unopened digests. PRD 01 §5.2 requires we
     * TELL the user we dropped their cadence; this line is how.
     */
    cadenceNote?: string;
};

export type DigestNudgeData = {
    /** How many weeks running we have found nothing. */
    quietWeeks: number;
    /** Goes straight to the compose box with the reply prefilled-empty. */
    replyUrl: string;
    /**
     * Omitted when the connector is not available to this user.
     *
     * `/settings/sources` calls notFound() unless `github_capture` is on, so a
     * "Connect a source" button sent unconditionally is a 404 in an email —
     * the worst place for one, because the reader cannot see it is our fault.
     * Absent also changes the copy: "quiet on your connected sources" is not a
     * sentence you can write to someone who has none.
     */
    sourcesUrl?: string;
};

// ---------------------------------------------------------------------------
// Subject and preheader
// ---------------------------------------------------------------------------

/**
 * §K1: "the number is dynamic and is the whole subject line. Never 'Your weekly
 * digest.'" A one-win week says "1 thing you did this week", not "1 things".
 */
export function digestSubject(winCount: number): string {
    const n = Math.max(0, Math.floor(winCount));
    return n === 1 ? '1 thing you did this week' : `${n} things you did this week`;
}

export function digestPreheader(sendDateLabel: string): string {
    const label = sendDateLabel.trim();
    return label ? `Confirm in 20 seconds — ${label}` : 'Confirm in 20 seconds';
}

/** "14 wins logged · 6 weeks running". The streak half disappears at zero. */
export function digestFooterSummary(totalConfirmed: number, streakWeeks: number): string {
    const wins = `${totalConfirmed} ${totalConfirmed === 1 ? 'win' : 'wins'} logged`;
    if (streakWeeks <= 0) return wins;
    return `${wins} · ${streakWeeks} ${streakWeeks === 1 ? 'week' : 'weeks'} running`;
}

/** ①②③④⑤ — the numbering in §K1. Falls back to "6." past the glyph range. */
export function itemMarker(index: number): string {
    const glyphs = ['①', '②', '③', '④', '⑤'];
    return glyphs[index] ?? `${index + 1}.`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function winBlocks(item: DigestWinItem, index: number): EmailBlock[] {
    const blocks: EmailBlock[] = [heading(`${itemMarker(index)}  ${item.title}`, { level: 2 })];

    if (item.narrative.trim()) blocks.push(paragraph(item.narrative.trim()));
    if (item.provenance?.trim()) blocks.push(eyebrow(`From: ${item.provenance.trim()}`));

    // Three real links. Never images, never JS, and each one is 40px tall and
    // ≥120px wide by construction inside `buttonRow` (design/02 §K1).
    blocks.push(
        buttonRow([
            { label: '✓ Log it', href: item.confirmUrl },
            { label: '✎ Edit', href: item.editUrl, variant: 'secondary' },
            { label: '✕ Not a win', href: item.dismissUrl, variant: 'secondary' },
        ]),
    );

    return blocks;
}

// ---------------------------------------------------------------------------
// weekly_digest
// ---------------------------------------------------------------------------

export const weeklyDigestTemplate: TemplateDefinition<WeeklyDigestData> = {
    key: 'weekly_digest',
    category: 'weeklyDigest',
    render(data, ctx): RenderedEmail {
        const subject = digestSubject(data.wins.length);

        const blocks: EmailBlock[] = [heading(subject)];

        if (data.cadenceNote) {
            blocks.push(paragraph(data.cadenceNote, { muted: true, small: true }));
        }

        data.wins.forEach((win, index) => {
            if (index > 0) blocks.push(divider());
            blocks.push(...winBlocks(win, index));
        });

        if (data.overflow > 0) {
            blocks.push(
                spacer(8),
                paragraph(
                    [
                        `+${data.overflow} more ${data.overflow === 1 ? 'draft' : 'drafts'} waiting in your log. `,
                        { text: 'Review them', href: data.logUrl },
                    ],
                    { muted: true, small: true },
                ),
            );
        }

        blocks.push(
            divider(),
            section([
                paragraph('Anything we missed?'),
                button({ label: 'Add a win →', href: data.addWinUrl }),
                spacer(12),
            ], { tone: 'subtle' }),
        );

        const { html, text } = renderEmail({
            title: subject,
            preheader: digestPreheader(data.sendDateLabel),
            headerRight: data.dateRange,
            blocks,
            footer: footer({
                unsubscribeUrl: ctx.unsubscribeUrl,
                preferencesUrl: ctx.preferencesUrl,
                summary: digestFooterSummary(data.totalConfirmed, data.streakWeeks),
            }),
        });

        return { subject, html, text };
    },
};

// ---------------------------------------------------------------------------
// digest_nudge — PRD 01 §5.2, at most once every 3 empty weeks
// ---------------------------------------------------------------------------

/**
 * Deliberately not a digest. No numbered list, no confirm buttons, one question.
 * The copy names the reason GitHub is quiet so the user does not read it as
 * "the product is broken" or "you did nothing".
 */
export const digestNudgeTemplate: TemplateDefinition<DigestNudgeData> = {
    key: 'digest_nudge',
    category: 'weeklyDigest',
    render(data, ctx): RenderedEmail {
        const subject = 'What did you work on?';
        const { html, text } = renderEmail({
            title: subject,
            preheader: 'One line is enough. Reviews and mentoring never show up in a commit log.',
            blocks: [
                heading('What did you work on?'),
                paragraph(
                    data.sourcesUrl
                        ? `Quiet ${data.quietWeeks === 1 ? 'week' : `${data.quietWeeks} weeks`} on your connected sources — which usually means the work moved somewhere they cannot see. Reviews, mentoring, design calls and unblocking other people never show up in a commit log.`
                        : `Quiet ${data.quietWeeks === 1 ? 'week' : `${data.quietWeeks} weeks`} in your log. The work that is hardest to remember later is usually the work that left no trace — reviews, mentoring, design calls, unblocking someone.`,
                ),
                paragraph("What's one thing you'd want your manager to know about?"),
                buttonRow([
                    { label: 'Log it in one line', href: data.replyUrl },
                    ...(data.sourcesUrl
                        ? [{ label: 'Connect a source', href: data.sourcesUrl, variant: 'secondary' as const }]
                        : []),
                ]),
                divider(),
                paragraph(
                    'We will not send this again for another few weeks. The Friday digest comes back on its own as soon as there is something in it.',
                    { muted: true, small: true },
                ),
            ],
            footer: footer({ unsubscribeUrl: ctx.unsubscribeUrl, preferencesUrl: ctx.preferencesUrl }),
        });
        return { subject, html, text };
    },
};

// ---------------------------------------------------------------------------
// Telegram variant — PRD 01 §5.2
// ---------------------------------------------------------------------------

/**
 * Same content, zero navigation. Telegram's `Markdown` parse mode is what
 * `sendTelegramMessage` sets, so the escaping below matches legacy Markdown
 * (`_ * [ ` `), not MarkdownV2.
 */
export function escapeTelegramMarkdown(value: string): string {
    return value.replace(/[_*[\]`]/g, '\\$&');
}

/** What the message says about one Win, which changes as buttons are tapped. */
export type TelegramDigestItem = {
    winId: string;
    title: string;
    narrative?: string;
    provenance?: string | null;
    state: 'draft' | 'confirmed' | 'dismissed';
};

export type TelegramDigestView = {
    headline: string;
    note?: string;
    items: TelegramDigestItem[];
    overflow: number;
    footer: string;
};

const STATE_PREFIX: Record<TelegramDigestItem['state'], string> = {
    draft: '',
    confirmed: '✓ ',
    dismissed: '✕ ',
};

/**
 * One renderer for both the first send and every in-place edit, so a message
 * cannot say something different after a tap than it said before one.
 */
export function renderTelegramDigest(view: TelegramDigestView): string {
    const lines: string[] = [`*${escapeTelegramMarkdown(view.headline)}*`, ''];
    if (view.note) lines.push(`_${escapeTelegramMarkdown(view.note)}_`, '');

    view.items.forEach((item, index) => {
        const prefix = STATE_PREFIX[item.state];
        const title = escapeTelegramMarkdown(item.title);
        // Legacy Markdown has no strikethrough, so an actioned item drops to
        // plain weight with a glyph in front of it. That reads as "done"
        // without relying on a formatting mode Telegram may not apply.
        lines.push(
            item.state === 'draft' ? `${itemMarker(index)} *${title}*` : `${itemMarker(index)} ${prefix}${title}`,
        );
        if (item.state === 'draft') {
            if (item.narrative?.trim()) lines.push(escapeTelegramMarkdown(item.narrative.trim()));
            if (item.provenance?.trim()) lines.push(`_From: ${escapeTelegramMarkdown(item.provenance.trim())}_`);
        }
        lines.push('');
    });

    if (view.overflow > 0) lines.push(`+${view.overflow} more waiting in your log.`, '');
    lines.push(`_${escapeTelegramMarkdown(view.footer)}_`);
    return lines.join('\n').trim();
}

export function toTelegramView(data: WeeklyDigestData): TelegramDigestView {
    return {
        headline: digestSubject(data.wins.length),
        note: data.cadenceNote,
        items: data.wins.map((win) => ({
            winId: win.winId,
            title: win.title,
            narrative: win.narrative,
            provenance: win.provenance,
            state: 'draft' as const,
        })),
        overflow: data.overflow,
        footer: digestFooterSummary(data.totalConfirmed, data.streakWeeks),
    };
}

export type TelegramInlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/**
 * Telegram caps `callback_data` at 64 bytes, so the signed token cannot ride in
 * it. The callback carries `d:<action><index>:<digestId>` and the webhook mints
 * nothing — it re-derives the (digest, win) pair server-side, which is strictly
 * safer than putting a credential in a chat payload.
 */
export function digestCallbackData(action: 'c' | 'd', index: number, digestId: string): string {
    return `d:${action}${index}:${digestId}`;
}

export function parseDigestCallbackData(
    raw: string | undefined,
): { action: 'confirm' | 'dismiss'; index: number; digestId: string } | null {
    const match = /^d:([cd])(\d{1,2}):([A-Za-z0-9_-]{1,64})$/.exec(String(raw ?? ''));
    if (!match) return null;
    return {
        action: match[1] === 'c' ? 'confirm' : 'dismiss',
        index: Number(match[2]),
        digestId: match[3],
    };
}

/**
 * A row per Win that is still a draft. Rows for items already actioned are
 * dropped rather than disabled — Telegram has no disabled state, and a button
 * that does nothing is worse than no button.
 */
export function digestInlineKeyboard(view: TelegramDigestView, digestId: string): TelegramInlineKeyboard {
    return {
        inline_keyboard: view.items
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.state === 'draft')
            .map(({ index }) => [
                { text: `✓ ${itemMarker(index)} Log it`, callback_data: digestCallbackData('c', index, digestId) },
                { text: '✕ Not a win', callback_data: digestCallbackData('d', index, digestId) },
            ]),
    };
}
