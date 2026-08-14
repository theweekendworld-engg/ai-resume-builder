/**
 * The monthly Radar email (PRD 04 §5).
 *
 * Separate cadence and separate unsubscribe from the weekly log digest, because
 * they do different jobs: the weekly one asks you to confirm wins, this one
 * tells you where you stand. A person may reasonably want one and not the
 * other, and bundling them would make declining either mean declining both.
 * The category is `radarDigest`, which maps to its own `EmailPreference`
 * column, so that separation is enforced by the send path rather than by
 * convention.
 *
 * The honesty rules from the screen apply verbatim, and matter more here —
 * email is read away from its context and forwarded out of it:
 *
 *   Every band carries `n` and its window inline. A number in an inbox with no
 *   provenance is unfalsifiable, and this is the one surface where the reader
 *   cannot click through to check the working.
 *
 *   A suppressed band says so plainly. "Not enough public data yet" is a real
 *   monthly update; a fabricated range would be the most damaging thing this
 *   product could put in writing.
 */

import {
    button,
    divider,
    eyebrow,
    footer,
    heading,
    paragraph,
    renderEmail,
    type EmailBlock,
} from '../layout';
import type { RenderedEmail, TemplateContext, TemplateDefinition } from './transactional';

export const RADAR_DIGEST_TEMPLATE_KEY = 'radar_digest' as const;

export type RadarDigestEmailData = {
    /** "August" — the month this snapshot describes. */
    monthLabel: string;
    /** "Senior · software engineering" */
    roleLabel: string;
    /** "sf bay" */
    geoLabel: string;
    band:
        | { kind: 'band'; low: string; high: string; median: string; provenance: string }
        | { kind: 'suppressed'; reason: string };
    matches: Array<{ title: string; company: string; url: string; pay: string | null }>;
    skills: Array<{ label: string; postingCount: number; pay: string | null }>;
    radarUrl: string;
};

export const radarDigestTemplate: TemplateDefinition<RadarDigestEmailData> = {
    key: RADAR_DIGEST_TEMPLATE_KEY,
    category: 'radarDigest',

    render(data: RadarDigestEmailData, ctx: TemplateContext): RenderedEmail {
        const subject = `Your market, ${data.monthLabel}`;

        const blocks: EmailBlock[] = [
            eyebrow(`${data.roleLabel} · ${data.geoLabel}`),
        ];

        if (data.band.kind === 'band') {
            blocks.push(
                heading(`${data.band.low} – ${data.band.high}`),
                paragraph(`Typically ${data.band.median}.`),
                // Provenance travels with the number, always.
                paragraph(data.band.provenance, { muted: true, small: true }),
            );
        } else {
            blocks.push(
                heading('Not enough public data yet'),
                paragraph(data.band.reason, { muted: true, small: true }),
            );
        }

        blocks.push(divider(), eyebrow('Roles you would likely win'));

        if (data.matches.length === 0) {
            // An empty month is a real answer, not a failure to fill space.
            blocks.push(
                paragraph(
                    'Nothing worth showing you this month. We only surface roles your log actually evidences.',
                ),
            );
        } else {
            for (const match of data.matches) {
                blocks.push(
                    paragraph([{ text: match.title, href: match.url }]),
                    paragraph(`${match.company}${match.pay ? ` · ${match.pay}` : ''}`, {
                        muted: true,
                        small: true,
                    }),
                );
            }
        }

        if (data.skills.length > 0) {
            blocks.push(divider(), eyebrow(`Most asked for in ${data.geoLabel}`));
            for (const skill of data.skills) {
                blocks.push(
                    paragraph(
                        `${skill.label} — ${skill.postingCount} posting${skill.postingCount === 1 ? '' : 's'}${skill.pay ? ` · ${skill.pay}` : ''}`,
                        { small: true },
                    ),
                );
            }
        }

        blocks.push(
            divider(),
            button({ label: 'Open Radar', href: data.radarUrl }),
            paragraph(
                'Every figure here is arithmetic over ranges employers published themselves. Nothing in this email is estimated by a model.',
                { muted: true, small: true },
            ),
        );

        const { html, text } = renderEmail({
            title: subject,
            // States the substance, not that a notification exists.
            preheader:
                data.band.kind === 'band'
                    ? `${data.roleLabel} in ${data.geoLabel}: ${data.band.low}–${data.band.high}.`
                    : `Not enough public data for ${data.roleLabel} in ${data.geoLabel} yet.`,
            blocks,
            headerRight: data.monthLabel,
            footer: footer({
                unsubscribeUrl: ctx.unsubscribeUrl,
                preferencesUrl: ctx.preferencesUrl,
                summary:
                    data.band.kind === 'band'
                        ? data.band.provenance
                        : 'Bands appear once enough employers have published ranges for your market.',
            }),
        });

        return { subject, html, text };
    },
};
