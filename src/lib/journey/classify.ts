/**
 * File one forwarded email (docs/prd/11-job-journey.md §4).
 *
 * One `generateStructured` call: what kind of email it is, which of the
 * user's applications it belongs to, and one line of summary. The model picks
 * the application BY INDEX from a shortlist the code built, exactly as the
 * chat router does; it never writes an id. The summary runs the numeric guard
 * against the email, so a figure in it is one the email contains.
 */

import { z } from 'zod';
import type { ApplicationStatus, JobEmailKind } from '@prisma/client';

import { generateStructured } from '@/lib/ai/structured';
import { GENERIC_DOMAINS, senderDomain } from './inbound';

export const JOB_EMAIL_KINDS = [
    'recruiter_outreach',
    'application_received',
    'assessment',
    'interview_request',
    'scheduling',
    'rejection',
    'offer',
    'other_job',
    'not_job',
] as const satisfies readonly JobEmailKind[];

export type Candidate = {
    workspaceId: string;
    company: string | null;
    role: string | null;
    status: ApplicationStatus;
    /** Sender domains of emails already filed against this job. */
    knownDomains: string[];
};

export type EmailForClassify = { fromEmail: string; fromName: string | null; subject: string; text: string };

/** How many applications the model is shown. */
export const SHORTLIST = 12;

function norm(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Rank the user's applications by how likely this email is about them, so
 * the shortlist the model sees holds the right one. Pure.
 */
export function rankCandidates(email: EmailForClassify, candidates: readonly Candidate[]): Candidate[] {
    const domain = senderDomain(email.fromEmail);
    const orgDomain = domain && !GENERIC_DOMAINS.has(domain) ? domain : null;
    const haystack = norm(`${email.fromName ?? ''} ${email.subject} ${email.text.slice(0, 4000)}`);
    const scored = candidates.map((candidate, order) => {
        let score = 0;
        const company = candidate.company ? norm(candidate.company) : '';
        if (orgDomain && candidate.knownDomains.includes(orgDomain)) score += 50;
        if (company.length >= 3) {
            const label = orgDomain?.split('.')[0] ?? '';
            if (label && (label === company.replace(/ /g, '') || company.split(' ')[0] === label)) score += 30;
            if (` ${haystack} `.includes(` ${company} `)) score += 20;
        }
        if (candidate.role && norm(candidate.role).length >= 4 && haystack.includes(norm(candidate.role))) score += 10;
        return { candidate, score, order };
    });
    return scored
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((entry) => entry.candidate);
}

const ClassifySchema = z.object({
    kind: z.enum(JOB_EMAIL_KINDS),
    /** 1-based index into the listed applications; 0 when none fits. */
    jobIndex: z.number().int().min(0).max(SHORTLIST),
    summary: z.string().max(240),
    /** For an email about a job not in the list: what it is, as written. */
    company: z.string().max(120),
    role: z.string().max(160),
});

export type Classification = {
    kind: JobEmailKind;
    workspaceId: string | null;
    summary: string;
    company: string | null;
    role: string | null;
};

const SYSTEM = `You file emails for a job seeker. Each email was forwarded by the user from their inbox.

Decide what kind of email it is:
- recruiter_outreach: a recruiter or hiring manager reaching out about a role.
- application_received: an automatic or human acknowledgement that an application arrived.
- assessment: a take-home, coding test or questionnaire to complete.
- interview_request: an invitation to interview, or to pick interview times.
- scheduling: confirming, moving or cancelling an interview already agreed.
- rejection: the employer is not moving forward.
- offer: a job offer or offer details.
- other_job: about a job search but none of the above (a question, a referral, a networking reply).
- not_job: newsletters, receipts, anything not about the user's job search.

Then pick which of the listed applications it is about, by its number. Use 0 when none clearly fits: never guess between two.
Summary: one plain sentence, what the email asks or says, max 25 words. Copy any date, time or figure exactly as the email writes it; never add one.
company and role: only when the email names them; otherwise "".`;

export function renderCandidates(list: readonly Candidate[]): string {
    if (list.length === 0) return 'The user has no applications yet.';
    return list
        .map((c, i) => `${i + 1}. ${c.role || 'Unknown role'} at ${c.company || 'unknown company'} (status ${c.status})`)
        .join('\n');
}

export async function classifyJobEmail(params: {
    userId: string;
    email: EmailForClassify;
    candidates: readonly Candidate[];
}): Promise<Classification> {
    const shortlist = rankCandidates(params.email, params.candidates).slice(0, SHORTLIST);
    const emailText = `From: ${params.email.fromName ? `${params.email.fromName} ` : ''}<${params.email.fromEmail}>\nSubject: ${params.email.subject}\n\n${params.email.text.slice(0, 8000)}`;
    const result = await generateStructured({
        task: 'jobEmailClassify',
        feature: 'job_journey',
        userId: params.userId,
        schema: ClassifySchema,
        system: SYSTEM,
        prompt: `Applications:\n${renderCandidates(shortlist)}\n\nEmail:\n${emailText}`,
        guard: { sourceText: emailText, fields: ['summary'] },
    });
    const data = result.data;
    const picked = data.jobIndex > 0 ? shortlist[data.jobIndex - 1] ?? null : null;
    return {
        kind: data.kind,
        // Unrelated mail is never filed against a job, whatever index came back.
        workspaceId: data.kind === 'not_job' ? null : picked?.workspaceId ?? null,
        summary: data.summary.trim(),
        company: data.company.trim() || null,
        role: data.role.trim() || null,
    };
}
