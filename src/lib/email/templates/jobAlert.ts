/**
 * The job-watch morning email (PRD 12 §6), sent only when the user has no
 * chat app linked: the chat message is the daily channel, and an inbox takes
 * at most two of these a week (`jobAlerts` in the notification budget).
 *
 * Same content and same honesty rules as the chat message (`src/lib/watch/
 * alert.ts`): code writes it from the computed fit, every number is the
 * scorer's, and the "why" is the user's own line.
 */

import { button, divider, eyebrow, footer, heading, paragraph, renderEmail, type EmailBlock } from '../layout';
import type { RenderedEmail, TemplateContext, TemplateDefinition } from './transactional';
import { ALERT_MAX_ITEMS, alertSubject, type AlertItem } from '@/lib/watch/alert';

export const JOB_ALERT_TEMPLATE_KEY = 'job_alert' as const;

export type JobAlertEmailData = {
    items: AlertItem[];
    watchUrl: string;
};

export const jobAlertTemplate: TemplateDefinition<JobAlertEmailData> = {
    key: JOB_ALERT_TEMPLATE_KEY,
    category: 'jobAlerts',

    render(data: JobAlertEmailData, ctx: TemplateContext): RenderedEmail {
        const subject = alertSubject(data.items);
        const blocks: EmailBlock[] = [eyebrow('Job alerts'), heading(subject)];

        for (const item of data.items.slice(0, ALERT_MAX_ITEMS)) {
            blocks.push(
                divider(),
                paragraph([{ text: `${item.title} · ${item.company}`, href: item.url }]),
                paragraph(
                    `Match ${item.score} · evidence for ${item.mustCovered} of ${item.mustTotal} must-haves${item.location ? ` · ${item.location}` : ''}${item.compensation ? ` · ${item.compensation}` : ''}`,
                    { muted: true, small: true },
                ),
            );
            if (item.strongest) blocks.push(paragraph(`Why: "${item.strongest.requirement}" ← ${item.strongest.evidence}`, { small: true }));
            if (item.gap) blocks.push(paragraph(`Gap: ${item.gap}`, { small: true }));
            if (item.person) {
                blocks.push(paragraph(
                    item.person.url
                        ? [{ text: 'Talk to: ' }, { text: item.person.name, href: item.person.url }, { text: ` (${item.person.why})` }]
                        : `Talk to: ${item.person.name} (${item.person.why})`,
                    { small: true },
                ));
            } else if (item.searchLink) {
                blocks.push(paragraph([{ text: 'Find someone: ' }, { text: item.searchLink.label, href: item.searchLink.url }], { small: true }));
            }
        }

        blocks.push(
            divider(),
            button({ label: 'Draft outreach or track', href: data.watchUrl }),
            paragraph(
                'Only jobs that scored 85 or more against your own record are sent. The score and the reasons are computed from your record, not written by a model.',
                { muted: true, small: true },
            ),
        );

        const { html, text } = renderEmail({
            title: subject,
            preheader: data.items.map((item) => `${item.title} at ${item.company} (${item.score})`).join(' · '),
            blocks,
            headerRight: 'Job alerts',
            footer: footer({
                unsubscribeUrl: ctx.unsubscribeUrl,
                preferencesUrl: ctx.preferencesUrl,
                summary: 'New openings at the companies you watch and in the roles you target, scored against your record each night.',
            }),
        });
        return { subject, html, text };
    },
};
