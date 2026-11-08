/**
 * The web chat's half of the apply chain's result (docs/impl/07-telegram-apply.md §5):
 * what is appended to the user's web thread when tailoring is done and the
 * application draft is written. Telegram gets the PDF and the draft as two
 * messages (`sendApplyResultTelegram`); the web gets one assistant message
 * with a resume card and a draft card. Pure: the caller does the IO.
 *
 * Every fact is code's: the label is the JD's role and company, the To is the
 * posting's own address, the skipped skills are the questions the chain
 * skipped. Nothing here is written by a model.
 */

import type { DraftView } from '@/lib/drafts/types';
import { orList } from '@/lib/scout/applyChain';
import type { ChatCard } from './types';

export type ApplyResultInput = {
    runId: string;
    /** "Forward Deployed AI Engineer at Acme". */
    label: string;
    sessionId: string;
    resumeId: string | null;
    pdfUrl: string | null;
    draft: DraftView | null;
    draftError: string | null;
    skipped: readonly string[];
    applyUrl: string | null;
};

/** The reply text and cards for the web thread. */
export function applyResultReply(input: ApplyResultInput): { text: string; cards: ChatCard[] } {
    const resume: ChatCard = {
        type: 'generation',
        sessionId: input.sessionId,
        resumeId: input.resumeId,
        status: 'completed',
        title: input.label,
        question: null,
        pdfUrl: input.pdfUrl,
    };

    if (!input.draft) {
        return {
            text: `Your resume for ${input.label} is ready. I could not write the application draft: ${input.draftError ?? 'try again from the job page.'}`,
            cards: [resume, { type: 'link', label: 'Open the job', href: `/scout/${input.runId}`, description: 'Write the application draft from the job page.' }],
        };
    }

    const email = input.draft.format === 'email';
    const skippedItems = [...new Set(input.skipped.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
    const lines = [
        email
            ? `Your resume for ${input.label} is ready, and so is the application email${input.draft.toEmail ? ` to ${input.draft.toEmail}` : ''}. Attach the PDF and send it from your own mail.`
            : `Your resume for ${input.label} is ready. The posting gives no address to email, so here is a LinkedIn message for the ${input.draft.target === 'poster' ? 'poster' : 'recruiter'}: apply${input.applyUrl ? ' at the application link' : ''} with the PDF, then send it.`,
        skippedItems.length
            ? `I didn't claim ${orList(skippedItems)} experience. Add ${skippedItems.length === 1 ? 'it' : 'them'} with "Change" on the job page if you have it.`
            : null,
        'Nothing is sent from Patronus. Tap Mark as applied once you have sent it.',
    ];

    return {
        text: lines.filter(Boolean).join('\n\n'),
        cards: [
            resume,
            {
                type: 'message_draft',
                draftId: input.draft.id,
                runId: input.draft.runId ?? input.runId,
                format: input.draft.format,
                target: input.draft.target,
                version: input.draft.version,
                toEmail: input.draft.toEmail,
                subject: input.draft.subject,
                body: input.draft.body,
                title: input.label,
                applyUrl: input.applyUrl,
                ...(skippedItems.length ? { skipped: skippedItems } : {}),
            },
        ],
    };
}
