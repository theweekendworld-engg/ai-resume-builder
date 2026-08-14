/**
 * Month in Review — the email (design/02 §K2, which is §E table-rendered).
 *
 * Same five blocks as the web document, same copy, same order. The email is
 * the version most people will actually read, so it is not a teaser with a
 * link: the whole review is in the message, and the CTA is what you do next
 * rather than what you have to click to see anything.
 *
 * This file renders. It does not decide: every string it is given has already
 * been computed and grounded by `src/services/monthInReview.ts`.
 */

import {
    button,
    divider,
    eyebrow,
    footer,
    heading,
    paragraph,
    type EmailBlock,
} from '../layout';
import { renderEmail } from '../layout';
import type {
    RenderedEmail,
    TemplateContext,
    TemplateDefinition,
} from './transactional';

export const MONTH_IN_REVIEW_TEMPLATE_KEY = 'month_in_review';

/** One row of the mix, already counted. */
export type MonthInReviewMixRow = { category: string; count: number };

/**
 * Everything the template renders, flat and serializable — a job payload has to
 * survive a JSON round trip through the queue.
 */
export type MonthInReviewEmailData = {
    /** "July 2026" */
    label: string;
    /** "8 wins, 5 with hard numbers" */
    headline: string;
    /** "July: 8 wins, 5 with numbers" */
    subject: string;
    /** Null when the paragraph could not be grounded. The email still sends. */
    paragraph: string | null;
    mix: MonthInReviewMixRow[];
    mixSentence: string;
    /** The honest observation, or null when there was no specific one to make. */
    observation: string | null;
    /** The value receipt (PRD 09 §4 M1). Always present. */
    receipt: string;
    winCount: number;
    /** `/log/review/2026-07` — the same document, on the web. */
    reviewUrl: string;
    packetUrl: string;
    logUrl: string;
};

/** Backticks are a marker for the web renderer; in mail they are noise. */
function plainCopy(text: string): string {
    return text.replace(/`/g, '');
}

const BAR_MAX = 6;

/**
 * The mix, as one line of blocks. Images are off in a third of inboxes and a
 * table of bars is unreadable in plain text, so the bar IS text.
 *
 * Which rows appear is the caller's decision (`visibleMixRows` in the service),
 * not this file's: a template that filters is a template that can disagree with
 * the web document about what July looked like.
 */
export function renderMixLine(mix: MonthInReviewMixRow[]): string {
    const present = mix.filter((row) => row.count > 0);
    if (present.length === 0) return '';
    const max = Math.max(...present.map((row) => row.count));

    return mix
        .map((row) => {
            const filled =
                row.count === 0 ? '·' : '▓'.repeat(Math.max(1, Math.round((row.count / max) * BAR_MAX)));
            return `${row.category} ${filled}`;
        })
        .join('   ');
}

export const monthInReviewTemplate: TemplateDefinition<MonthInReviewEmailData> = {
    key: MONTH_IN_REVIEW_TEMPLATE_KEY,
    category: 'monthlyReview',
    render(data: MonthInReviewEmailData, ctx: TemplateContext): RenderedEmail {
        const blocks: EmailBlock[] = [
            eyebrow(data.label),
            heading(data.headline),
        ];

        if (data.paragraph) {
            blocks.push(divider(), paragraph(data.paragraph));
        }

        const mixLine = renderMixLine(data.mix);
        if (mixLine) {
            blocks.push(divider(), eyebrow('Your mix'), paragraph(mixLine, { small: true }));
            if (data.mixSentence) blocks.push(paragraph(plainCopy(data.mixSentence)));
        }

        if (data.observation) {
            blocks.push(eyebrow('Worth knowing'), paragraph(plainCopy(data.observation)));
        }

        blocks.push(
            divider(),
            button({ label: 'Start your review packet', href: data.packetUrl }),
            paragraph([{ text: `See all ${data.winCount} in your log`, href: data.logUrl }], {
                small: true,
            }),
            paragraph(data.receipt, { muted: true, small: true }),
            paragraph([{ text: 'Read this on the web', href: data.reviewUrl }], {
                muted: true,
                small: true,
            }),
        );

        const { html, text } = renderEmail({
            title: data.subject,
            // States the substance, never the product. "Your monthly summary is
            // ready" is a notification; this is the thing itself.
            preheader: `${data.headline}. ${data.receipt}`,
            blocks,
            headerRight: data.label,
            footer: footer({
                unsubscribeUrl: ctx.unsubscribeUrl,
                preferencesUrl: ctx.preferencesUrl,
                summary: data.receipt,
            }),
        });

        return { subject: data.subject, html, text };
    },
};
