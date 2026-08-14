/**
 * The mission nudge (PRD 05 §7).
 *
 * The only message in the product with a licence to interrupt someone about
 * work they have not done, and it earns that by being specific: it names the
 * one step they are on and the exact distance left. "Cross-team influence:
 * still 1 win. Anything this week?" is a nudge. "Don't forget your goals!" is
 * spam with a progress bar.
 *
 * Three rules, all of which exist because a weekly guilt email is the fastest
 * way to lose someone who is already behind:
 *
 *   One step, never a list. The mission has six; the nudge mentions the
 *   current one. A digest of everything outstanding is a to-do list arriving
 *   by email, and it reads as an accusation.
 *
 *   The number is stated, never editorialised. "1 of 3" — no "only", no "still
 *   just", no streak. Someone at 1 of 3 in week five already knows.
 *
 *   Pausing is offered in the mail itself. §2 rule 2 says a mission can be
 *   paused without guilt, and the moment that matters most is when a nudge
 *   lands during a bad month. If the honest answer is "not now", the email
 *   that asked should be the place to say so.
 */

import {
    buttonRow,
    divider,
    eyebrow,
    footer,
    heading,
    paragraph,
    renderEmail,
    type EmailBlock,
} from '../layout';
import type { RenderedEmail, TemplateContext, TemplateDefinition } from './transactional';

export const MISSION_NUDGE_TEMPLATE_KEY = 'mission_nudge' as const;

export type MissionNudgeEmailData = {
    /** The user's own title for it — "Staff by March", not "Get promoted". */
    missionTitle: string;
    /** The step they are on. */
    stepTitle: string;
    /** The step's one-line explanation, when it has one. */
    stepHint?: string | null;
    /** Present only for threshold steps. */
    progress?: { current: number; target: number } | null;
    /** Whole weeks until the target date. Absent when there is no date. */
    weeksRemaining?: number | null;
    missionUrl: string;
    /** Goes straight to quick capture — the action most nudges want. */
    logUrl: string;
};

export const missionNudgeTemplate: TemplateDefinition<MissionNudgeEmailData> = {
    key: MISSION_NUDGE_TEMPLATE_KEY,
    category: 'missionNudges',

    render(data: MissionNudgeEmailData, ctx: TemplateContext): RenderedEmail {
        // The subject IS the step. A generic subject would be filtered within
        // three weeks, and then the whole mechanic is dead.
        const subject = data.progress
            ? `${data.stepTitle} — ${data.progress.current} of ${data.progress.target}`
            : data.stepTitle;

        const blocks: EmailBlock[] = [
            eyebrow(data.missionTitle),
            heading(data.stepTitle),
        ];

        if (data.stepHint) blocks.push(paragraph(data.stepHint));

        if (data.progress) {
            const left = Math.max(data.progress.target - data.progress.current, 0);
            blocks.push(
                paragraph(
                    // Stated flatly. No "only", no "still just" — someone at 1
                    // of 3 in week five does not need it pointed out.
                    `${data.progress.current} of ${data.progress.target}. ${
                        left === 1 ? 'One more' : `${left} more`
                    } and this step is done.`,
                ),
            );
        }

        if (typeof data.weeksRemaining === 'number') {
            blocks.push(
                paragraph(
                    data.weeksRemaining <= 0
                        ? 'Your target date has passed. That happens — the mission is still here whenever you want it.'
                        : `${data.weeksRemaining} ${data.weeksRemaining === 1 ? 'week' : 'weeks'} until your target date.`,
                    { muted: true, small: true },
                ),
            );
        }

        blocks.push(
            buttonRow([
                { label: 'Log it in one line', href: data.logUrl },
                { label: 'Open the mission', href: data.missionUrl, variant: 'secondary' },
            ]),
            divider(),
            // The escape hatch, in the message most likely to arrive at a bad
            // moment. Cheaper for us than an unsubscribe and kinder than one.
            paragraph(
                'Bad month? Pause the mission and we will stop nudging until you pick it back up. Nothing is lost.',
                { muted: true, small: true },
            ),
        );

        const { html, text } = renderEmail({
            title: subject,
            preheader: data.progress
                ? `${data.progress.current} of ${data.progress.target} on ${data.missionTitle}.`
                : `Next on ${data.missionTitle}.`,
            blocks,
            footer: footer({
                unsubscribeUrl: ctx.unsubscribeUrl,
                preferencesUrl: ctx.preferencesUrl,
                summary: 'You get this because you started a mission. Pausing it stops these.',
            }),
        });

        return { subject, html, text };
    },
};
