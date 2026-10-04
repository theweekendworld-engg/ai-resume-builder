/**
 * What a job email does to the application (docs/prd/11-job-journey.md §4). Pure.
 *
 * An email can only move a job FORWARD. A late "we received your
 * application" must not pull an interviewing job back to applied, and the
 * tracker's own rule (careerInbox: never moved backwards) holds for email too.
 * Every move is recorded on the JobEmail so the user can undo it.
 */

import type { ApplicationStatus, JobEmailKind } from '@prisma/client';

export const STATUS_RANK: Record<ApplicationStatus, number> = {
    discovered: 0,
    analyzed: 1,
    drafting: 2,
    in_progress: 3,
    submitted: 4,
    applied: 4,
    in_review: 5,
    interview: 6,
    offer: 7,
    rejected: 8,
    ghosted: 8,
    archived: 9,
};

/** The status each kind of email is evidence for. Null: no move. */
export const STATUS_FOR_KIND: Record<JobEmailKind, ApplicationStatus | null> = {
    recruiter_outreach: null,
    application_received: 'applied',
    assessment: 'in_review',
    interview_request: 'interview',
    scheduling: 'interview',
    rejection: 'rejected',
    offer: 'offer',
    other_job: null,
    not_job: null,
};

/**
 * The status to move to, or null to leave the job where it is.
 * A rejection closes anything still open; nothing reopens a closed job.
 */
export function nextStatusFor(kind: JobEmailKind, current: ApplicationStatus): ApplicationStatus | null {
    const target = STATUS_FOR_KIND[kind];
    if (!target || target === current) return null;
    if (current === 'archived' || current === 'rejected' || current === 'ghosted') return null;
    if (target === 'rejected') return current === 'offer' ? null : 'rejected';
    return STATUS_RANK[target] > STATUS_RANK[current] ? target : null;
}

export const KIND_LABEL: Record<JobEmailKind, string> = {
    recruiter_outreach: 'Recruiter outreach',
    application_received: 'Application received',
    assessment: 'Assessment',
    interview_request: 'Interview request',
    scheduling: 'Scheduling',
    rejection: 'Rejection',
    offer: 'Offer',
    other_job: 'Job related',
    not_job: 'Not job related',
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
    discovered: 'To review',
    analyzed: 'To review',
    drafting: 'To review',
    in_progress: 'To review',
    submitted: 'Applied',
    applied: 'Applied',
    in_review: 'In review',
    interview: 'Interviewing',
    offer: 'Offer',
    rejected: 'Rejected',
    ghosted: 'No response',
    archived: 'Archived',
};

/** Kinds worth a reply draft offer. */
export const REPLYABLE: ReadonlySet<JobEmailKind> = new Set(['recruiter_outreach', 'interview_request', 'scheduling', 'assessment', 'offer', 'other_job']);
