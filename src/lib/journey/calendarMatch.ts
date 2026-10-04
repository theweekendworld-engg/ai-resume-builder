/**
 * Which calendar events are interviews, and for which application (docs/prd/11 §6). Pure.
 *
 * Fail closed: an event is filed only when it is clearly about one job. A
 * company named in the title AND an interview word, or an attendee from a
 * domain that has already emailed the user about that job. Two jobs tied is
 * no match: a wrong interview on a timeline is worse than a missing one.
 */

import { GENERIC_DOMAINS, senderDomain } from './inbound';
import type { CalendarEvent } from '@/lib/google/calendar';

export type CalendarCandidate = { workspaceId: string; company: string | null; knownDomains: string[] };

const INTERVIEW_WORDS = /\b(interview|screen(ing)?|phone call|video call|call with|chat with|round|onsite|on-site|technical|tech|coding|system design|hiring manager|recruiter|panel|loop|culture fit|behaviou?ral|final)\b/i;

function norm(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function companyMentioned(company: string, text: string): boolean {
    const name = norm(company);
    if (name.length < 3) return false;
    return ` ${norm(text)} `.includes(` ${name} `);
}

export function matchEvent(event: CalendarEvent, candidates: readonly CalendarCandidate[]): string | null {
    if (event.status === 'cancelled') return null;
    const text = `${event.summary ?? ''} ${event.location ?? ''} ${(event.description ?? '').slice(0, 2000)}`;
    const interviewish = INTERVIEW_WORDS.test(event.summary ?? '') || INTERVIEW_WORDS.test((event.description ?? '').slice(0, 500));
    const attendeeDomains = new Set(
        (event.attendees ?? [])
            .filter((attendee) => !attendee.self && attendee.email)
            .map((attendee) => senderDomain(attendee.email ?? ''))
            .filter((domain): domain is string => !!domain && !GENERIC_DOMAINS.has(domain)),
    );

    const scored = candidates
        .map((candidate) => {
            let score = 0;
            if (candidate.knownDomains.some((domain) => attendeeDomains.has(domain))) score += 2;
            if (candidate.company && interviewish && companyMentioned(candidate.company, text)) score += 2;
            if (candidate.company && attendeeDomains.size > 0) {
                const label = norm(candidate.company).split(' ')[0];
                if (label.length >= 3 && [...attendeeDomains].some((domain) => domain.split('.')[0] === label)) score += 1;
            }
            return { candidate, score };
        })
        .filter((entry) => entry.score >= 2)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;
    if (scored.length > 1 && scored[0].score === scored[1].score) return null;
    return scored[0].candidate.workspaceId;
}
