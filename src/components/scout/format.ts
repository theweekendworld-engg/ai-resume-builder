/**
 * Pure formatting for the Scout screens. No React, no server imports, so it is
 * testable directly and safe in client bundles.
 *
 * Every helper that touches a figure or a link is conservative in the same
 * direction the pipeline is: when it cannot say something precisely, it says
 * less (an empty string, `null`), never something approximate.
 */

import type { StoredSection } from '@/lib/agent/run';
import {
    LINKEDIN_NOTE_MAX,
    type DraftFormat,
    type FitVerdict,
    type InterviewLink,
    type InterviewSourceKind,
    type ScoutKind,
    type ScoutRunView,
} from '@/lib/scout/types';

// ─────────────────────────────────────────────────────────────── status

export type RunStatus = ScoutRunView['status'];

/** Poll while the run can still change on its own. */
export function isLive(status: RunStatus): boolean {
    return status === 'queued' || status === 'running';
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
    queued: 'Queued',
    running: 'Working',
    awaiting_input: 'Needs your answer',
    succeeded: 'Done',
    partial: 'Done · some parts unavailable',
    failed: 'Did not finish',
};

export const KIND_LABEL: Record<ScoutKind, string> = {
    job_posting: 'Job',
    hiring_post: 'Hiring post',
    company_signal: 'Company news',
    knowledge: 'Reading',
    work_note: 'Work note',
    other: 'Other',
};

export const VERDICT_LABEL: Record<FitVerdict, string> = {
    strong: 'Strong fit',
    possible: 'Possible fit',
    stretch: 'Stretch',
    not_a_fit: 'Not a fit',
    unknown: 'Fit unclear',
};

/**
 * The display state of one section. `pending` covers both "not reached yet"
 * and "running now": a section has no row until it finishes, and the step
 * timeline is where the difference is visible.
 */
export type SectionDisplayState = 'pending' | 'ok' | 'unavailable' | 'skipped' | 'failed' | 'needs_input';

export function sectionState(section: StoredSection | undefined): SectionDisplayState {
    return section ? section.status : 'pending';
}

/** Why a section has nothing to show, in the words the pipeline stored. */
export function sectionReason(section: StoredSection | undefined): string | null {
    if (!section) return null;
    if (section.status === 'unavailable' || section.status === 'skipped' || section.status === 'failed') {
        return section.reason || null;
    }
    if (section.status === 'needs_input') return section.question.prompt;
    return null;
}

// ───────────────────────────────────────────────────────────────── links

/** `www.reddit.com/r/…` → `reddit.com`. Empty for anything unparseable. */
export function domainOf(url: string | null | undefined): string {
    if (!url) return '';
    try {
        return new URL(url).hostname.replace(/^(www\.|m\.|in\.)/i, '').toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Only http(s) links are rendered as anchors. A model-shaped `javascript:`
 * string should never have survived the pipeline's citation check, but the
 * UI does not rely on that.
 */
export function safeHref(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
    } catch {
        return null;
    }
}

// ────────────────────────────────────────────────────────────────── time

/** `just now`-free relative time: "4 min ago", "3 h ago", "2 d ago", then a date. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
    if (!iso) return '';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';
    const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
    if (seconds < 60) return 'less than a minute ago';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} d ago`;
    return shortDate(iso);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mar 4, 2026`, in UTC so server and client render the same string. */
export function shortDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// ──────────────────────────────────────────────────────── observability

/** `840 ms`, `12.4 s`. Empty when unknown — never a made-up zero. */
export function formatLatency(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

// ─────────────────────────────────────────────────────────────── drafts

/**
 * The practical length limit per format. The LinkedIn connection note is a
 * hard platform limit; the others are the length past which nobody replies.
 */
export const DRAFT_LIMIT: Record<DraftFormat, number | null> = {
    linkedin_note: LINKEDIN_NOTE_MAX,
    linkedin_message: 1_000,
    email: null,
};

export const DRAFT_FORMAT_LABEL: Record<DraftFormat, string> = {
    linkedin_note: 'Connection note',
    linkedin_message: 'LinkedIn message',
    email: 'Email',
};

export function charCount(body: string, format: DraftFormat): { count: number; limit: number | null; over: boolean } {
    const count = [...body].length;
    const limit = DRAFT_LIMIT[format];
    return { count, limit, over: limit !== null && count > limit };
}

/** What the clipboard receives: subject on its own line for email. */
export function draftClipboardText(draft: { subject: string | null; body: string; format: DraftFormat }): string {
    if (draft.format === 'email' && draft.subject) return `Subject: ${draft.subject}\n\n${draft.body}`;
    return draft.body;
}

// ─────────────────────────────────────────────────────────── interviews

export const INTERVIEW_SOURCE_LABEL: Record<InterviewSourceKind, string> = {
    reddit: 'Reddit',
    leetcode: 'LeetCode',
    youtube: 'YouTube',
    glassdoor: 'Glassdoor',
    geeksforgeeks: 'GeeksforGeeks',
    blind: 'Blind',
    medium: 'Medium',
    other: 'Other sources',
};

const SOURCE_ORDER: InterviewSourceKind[] = ['leetcode', 'reddit', 'youtube', 'glassdoor', 'geeksforgeeks', 'blind', 'medium', 'other'];

/**
 * Group by source in a stable order, newest first inside each group. Links
 * without a date sort after dated ones — undated is less useful, not newer.
 */
export function groupInterviewLinks(links: readonly InterviewLink[]): { source: InterviewSourceKind; links: InterviewLink[] }[] {
    const groups = new Map<InterviewSourceKind, InterviewLink[]>();
    for (const link of links) {
        const list = groups.get(link.source) ?? [];
        list.push(link);
        groups.set(link.source, list);
    }
    const time = (link: InterviewLink) => {
        const value = link.publishedAt ? new Date(link.publishedAt).getTime() : Number.NaN;
        return Number.isNaN(value) ? -Infinity : value;
    };
    return SOURCE_ORDER
        .filter((source) => groups.has(source))
        .map((source) => ({ source, links: [...groups.get(source)!].sort((a, b) => time(b) - time(a)) }));
}

// ──────────────────────────────────────────────────────────── company

/**
 * Provenance values are whatever the company section wrote ("provider:pdl",
 * "job_page", a URL). Rendered as a short, honest label.
 */
export function provenanceLabel(value: string | null | undefined): string {
    if (!value) return '';
    if (value.startsWith('provider:')) return value.slice('provider:'.length);
    if (value === 'job_page' || value === 'job-page-derived') return 'from the job page';
    if (value === 'observed_postings') return 'observed postings';
    const domain = domainOf(value);
    return domain || value;
}

/** `1234` → `1,234`, locale-independent so server and client agree. */
export function formatCount(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─────────────────────────────────────────────────────── settings input

/** "Backend Engineer, SDE II" → ["Backend Engineer", "SDE II"], deduped, capped. */
export function splitList(raw: string, max = 8): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const piece of raw.split(/[,\n]/)) {
        const value = piece.trim().replace(/\s+/g, ' ').slice(0, 80);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length >= max) break;
    }
    return out;
}
