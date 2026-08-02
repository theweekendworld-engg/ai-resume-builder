/**
 * Transactional templates — the only template file in Phase 0 (ADR-4, P0.3).
 *
 * A template declares three things and nothing else: its category (which
 * EmailPreference flag governs it), whether it is critical (see below), and how
 * to render. It never touches Prisma, Resend, or process.env — which is what
 * makes every template renderable in a unit test with no database and no API key.
 *
 * The category taxonomy lives here rather than in send.ts because templates are
 * what own a category; send.ts only consumes the mapping.
 */

import {
    button,
    buttonRow,
    divider,
    escapeHtml,
    eyebrow,
    footer,
    heading,
    paragraph,
    renderEmail,
    type EmailBlock,
} from '../layout';
import {
    digestNudgeTemplate,
    weeklyDigestTemplate,
    type DigestNudgeData,
    type WeeklyDigestData,
} from './weeklyDigest';
import { monthInReviewTemplate, type MonthInReviewEmailData } from './monthInReview';

/** Maps 1:1 onto the boolean columns of EmailPreference, plus `transactional`. */
export type EmailCategory =
    | 'transactional'
    | 'weeklyDigest'
    | 'monthlyReview'
    | 'radarDigest'
    | 'missionNudges'
    | 'productUpdates';

/** The EmailPreference column that governs a category. `transactional` has none. */
export const PREFERENCE_FIELD_BY_CATEGORY = {
    transactional: null,
    weeklyDigest: 'weeklyDigest',
    monthlyReview: 'monthlyReview',
    radarDigest: 'radarDigest',
    missionNudges: 'missionNudges',
    productUpdates: 'productUpdates',
} as const satisfies Record<EmailCategory, string | null>;

export type RenderedEmail = { subject: string; html: string; text: string };

/** Everything a template needs from the environment, resolved by the caller. */
export type TemplateContext = {
    /** Token-bearing unsubscribe URL. Also used for the List-Unsubscribe header. */
    unsubscribeUrl: string;
    /** In-app notification settings (design/02 §J2). */
    preferencesUrl: string;
    appUrl: string;
};

export type TemplateDefinition<D> = {
    key: string;
    category: EmailCategory;
    /**
     * A critical email reaches the user even when unsubscribedAll is set.
     * Reserved for account-access mail: suppressing a sign-in link locks a paying
     * user out of the product, which is worse than an unwanted email.
     * Everything else — including other transactional mail — obeys unsubscribedAll.
     */
    critical?: boolean;
    render(data: D, ctx: TemplateContext): RenderedEmail;
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function standardFooter(ctx: TemplateContext, summary?: string): EmailBlock {
    return footer({
        unsubscribeUrl: ctx.unsubscribeUrl,
        preferencesUrl: ctx.preferencesUrl,
        summary,
    });
}

/**
 * Every button in every template also gets spelled out as a bare URL, because a
 * link that only exists inside an <a> is invisible to a plain-text reader and to
 * the handful of clients that mangle anchors.
 */
function fallbackLink(label: string, url: string): EmailBlock {
    return paragraph(
        [`${label} `, { text: url, href: url }],
        { muted: true, small: true }
    );
}

function greeting(firstName?: string): string {
    const trimmed = (firstName ?? '').trim();
    return trimmed ? `${trimmed},` : 'Hi,';
}

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

export type TransactionalTemplateData = {
    welcome: { firstName?: string; logUrl: string };
    magic_link: { url: string; expiresInMinutes?: number; requestedFrom?: string };
    source_disconnected: { sourceName: string; reconnectUrl: string };
    packet_ready: { packetTitle: string; url: string };
    // Non-transactional templates that still go out through `sendEmail`, which
    // is the only place preferences, List-Unsubscribe and EmailSend rows are
    // handled. Their definitions live in their own files; only the registry
    // entry belongs here.
    weekly_digest: WeeklyDigestData;
    digest_nudge: DigestNudgeData;
    month_in_review: MonthInReviewEmailData;
};

export type TransactionalTemplateKey = keyof TransactionalTemplateData;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const welcome: TemplateDefinition<TransactionalTemplateData['welcome']> = {
    key: 'welcome',
    category: 'transactional',
    render(data, ctx) {
        const subject = 'Your work log is open';
        const { html, text } = renderEmail({
            title: subject,
            preheader: 'One habit: log the thing you just finished. Everything else follows.',
            blocks: [
                heading('Your work log is open'),
                paragraph(greeting(data.firstName)),
                paragraph(
                    'Patronus keeps a running record of what you actually did — with the evidence attached, so nothing you claim later needs defending.'
                ),
                paragraph('The only habit that matters: log the thing you just finished, while you still remember the numbers.'),
                button({ label: 'Log your first win', href: data.logUrl }),
                fallbackLink('Or paste this into your browser:', data.logUrl),
                divider(),
                paragraph(
                    'Every Friday we will send you the things we noticed you did that week. You confirm the real ones in about twenty seconds.',
                    { muted: true, small: true }
                ),
            ],
            footer: standardFooter(ctx),
        });
        return { subject, html, text };
    },
};

const magicLink: TemplateDefinition<TransactionalTemplateData['magic_link']> = {
    key: 'magic_link',
    category: 'transactional',
    critical: true,
    render(data, ctx) {
        const minutes = data.expiresInMinutes ?? 15;
        const subject = 'Your sign-in link';
        const blocks: EmailBlock[] = [
            heading('Sign in to Patronus'),
            paragraph(`This link works once and expires in ${minutes} minutes.`),
            button({ label: 'Sign in', href: data.url }),
            fallbackLink('Or paste this into your browser:', data.url),
        ];
        if (data.requestedFrom) {
            blocks.push(eyebrow(`Requested from ${escapeHtml(data.requestedFrom)}`));
        }
        blocks.push(
            divider(),
            paragraph('If you did not ask for this, ignore it — the link is useless without your inbox.', {
                muted: true,
                small: true,
            })
        );
        const { html, text } = renderEmail({
            title: subject,
            preheader: `Expires in ${minutes} minutes.`,
            blocks,
            footer: standardFooter(ctx),
        });
        return { subject, html, text };
    },
};

const sourceDisconnected: TemplateDefinition<TransactionalTemplateData['source_disconnected']> = {
    key: 'source_disconnected',
    category: 'transactional',
    render(data, ctx) {
        const subject = `${data.sourceName} stopped sending us your work`;
        const { html, text } = renderEmail({
            title: subject,
            preheader: 'Reconnecting takes one click. Until then, your log has a hole in it.',
            blocks: [
                heading(`${data.sourceName} disconnected`),
                paragraph(
                    `We can no longer read your activity from ${data.sourceName}. Anything you ship there from now on will be missing from your log — and from the weekly digest.`
                ),
                buttonRow([{ label: `Reconnect ${data.sourceName}`, href: data.reconnectUrl }]),
                fallbackLink('Or paste this into your browser:', data.reconnectUrl),
                divider(),
                paragraph('Nothing already logged is affected. This only concerns new activity.', {
                    muted: true,
                    small: true,
                }),
            ],
            footer: standardFooter(ctx),
        });
        return { subject, html, text };
    },
};

const packetReady: TemplateDefinition<TransactionalTemplateData['packet_ready']> = {
    key: 'packet_ready',
    category: 'transactional',
    render(data, ctx) {
        const subject = `"${data.packetTitle}" is ready`;
        const { html, text } = renderEmail({
            title: subject,
            preheader: 'Every claim in it links back to the evidence you logged.',
            blocks: [
                heading('Your packet is ready'),
                paragraph([{ text: data.packetTitle, bold: true }]),
                paragraph(
                    'Every claim in it links back to the evidence you logged. Read it before you send it — you are the one who has to defend it in the room.'
                ),
                buttonRow([
                    { label: 'Open the packet', href: data.url },
                    { label: 'Open your log', href: `${ctx.appUrl}/log`, variant: 'secondary' },
                ]),
                fallbackLink('Or paste this into your browser:', data.url),
            ],
            footer: standardFooter(ctx),
        });
        return { subject, html, text };
    },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const transactionalTemplates: {
    [K in TransactionalTemplateKey]: TemplateDefinition<TransactionalTemplateData[K]>;
} = {
    welcome,
    magic_link: magicLink,
    source_disconnected: sourceDisconnected,
    packet_ready: packetReady,
    weekly_digest: weeklyDigestTemplate,
    digest_nudge: digestNudgeTemplate,
    month_in_review: monthInReviewTemplate,
};

export function getTransactionalTemplate<K extends TransactionalTemplateKey>(
    key: K
): TemplateDefinition<TransactionalTemplateData[K]> {
    return transactionalTemplates[key];
}
