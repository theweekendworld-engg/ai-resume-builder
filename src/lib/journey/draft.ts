/**
 * Reply and follow-up drafts (docs/prd/11-job-journey.md §5).
 *
 * The draft is the user's to send: "Send" opens Gmail's compose window
 * prefilled, we never send mail on their behalf. Its sources are the email,
 * the job, and the user's confirmed SHAREABLE Wins, filtered in the query
 * (CLAUDE.md rule 3). The numeric guard holds the body to figures those
 * sources contain, and the prompt forbids inventing availability: times are
 * left as a placeholder the user fills in.
 */

import { z } from 'zod';

import { generateStructured } from '@/lib/ai/structured';
import { externalRetrievalFilter } from '@/lib/graph/visibility';
import { prisma } from '@/lib/prisma';

const DraftSchema = z.object({
    subject: z.string().max(200),
    body: z.string().max(3000),
});

export type Draft = z.infer<typeof DraftSchema>;

export const AVAILABILITY_PLACEHOLDER = '[your availability]';

const SYSTEM = `You draft short, warm, professional emails for a job seeker, in their voice (first person).
Rules:
- Under 140 words. No subject-line clichés, no "I hope this email finds you well".
- Never invent facts about the user. Mention experience only from the "Record" lines, and only if it helps.
- Never invent dates, times or availability. Where times are needed write ${AVAILABILITY_PLACEHOLDER} exactly.
- Never invent numbers. Any figure must appear in the email or the record lines.
- Sign off with the user's first name.`;

async function recordLines(userId: string, limit = 5): Promise<string[]> {
    const wins = await prisma.win.findMany({
        // Rule 3: sensitivity is filtered here, in the query, never in the prompt.
        where: externalRetrievalFilter(userId),
        orderBy: { occurredAt: 'desc' },
        take: limit,
        select: { title: true },
    });
    return wins.map((win) => win.title);
}

function subjectFor(original: string): string {
    return /^re:/i.test(original) ? original : `Re: ${original}`;
}

export async function draftReply(params: {
    userId: string;
    firstName: string;
    email: { fromName: string | null; fromEmail: string; subject: string; text: string };
    job: { company: string | null; role: string | null } | null;
    intent?: string;
}): Promise<Draft> {
    const record = await recordLines(params.userId);
    const source = `Email from ${params.email.fromName ?? params.email.fromEmail}\nSubject: ${params.email.subject}\n\n${params.email.text.slice(0, 6000)}`;
    const recordText = record.length ? record.map((line) => `- ${line}`).join('\n') : '(none)';
    const result = await generateStructured({
        task: 'jobEmailReply',
        feature: 'job_journey',
        userId: params.userId,
        schema: DraftSchema,
        system: SYSTEM,
        prompt: [
            `User's first name: ${params.firstName}`,
            params.job ? `The job: ${params.job.role ?? 'a role'} at ${params.job.company ?? 'the company'}` : '',
            `Record:\n${recordText}`,
            params.intent ? `What the user wants to say: ${params.intent}` : 'Write the natural reply: accept next steps, answer what was asked, or thank them.',
            `Reply to this email:\n${source}`,
        ].filter(Boolean).join('\n\n'),
        guard: { sourceText: `${source}\n${recordText}\n${params.intent ?? ''}`, fields: ['body', 'subject'] },
    });
    return { subject: subjectFor(params.email.subject), body: result.data.body.trim() };
}

export async function draftFollowUp(params: {
    userId: string;
    firstName: string;
    job: { company: string | null; role: string | null };
    appliedOn: Date | null;
    contactName: string | null;
}): Promise<Draft> {
    const record = await recordLines(params.userId, 3);
    const recordText = record.length ? record.map((line) => `- ${line}`).join('\n') : '(none)';
    const applied = params.appliedOn ? params.appliedOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null;
    const facts = `Role: ${params.job.role ?? 'the role'}\nCompany: ${params.job.company ?? 'the company'}${applied ? `\nApplied on: ${applied}` : ''}${params.contactName ? `\nContact: ${params.contactName}` : ''}`;
    const result = await generateStructured({
        task: 'jobEmailReply',
        feature: 'job_journey',
        userId: params.userId,
        schema: DraftSchema,
        system: SYSTEM,
        prompt: `User's first name: ${params.firstName}\n\nWrite a polite follow-up on an application that has had no reply. Ask, briefly, whether there is an update and restate interest in one line.\n\n${facts}\n\nRecord:\n${recordText}`,
        guard: { sourceText: `${facts}\n${recordText}`, fields: ['body', 'subject'] },
    });
    const subject = result.data.subject.trim() || `Following up: ${params.job.role ?? 'my application'}`;
    return { subject, body: result.data.body.trim() };
}

/** Gmail's compose window, prefilled. Nothing is sent until the user presses Send there. */
export function gmailComposeUrl(draft: { to: string; subject: string; body: string }): string {
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: draft.to, su: draft.subject, body: draft.body });
    return `https://mail.google.com/mail/?${params.toString()}`;
}

export function mailtoUrl(draft: { to: string; subject: string; body: string }): string {
    return `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
