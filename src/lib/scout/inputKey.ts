import { createHash } from 'node:crypto';
import { canonicalUrl } from '@/lib/agent/sources';
import type { ScoutInput } from '@/lib/scout/types';

/**
 * LinkedIn shows one job under many URLs: `/jobs/view/<id>`,
 * `/jobs/view/<slug>-<id>`, `/jobs/search/?currentJobId=<id>`,
 * `/jobs/collections/recommended/?currentJobId=<id>`. They are one job, so they
 * must be one run. Returns the numeric id, or null.
 */
export function linkedinJobId(raw: string): string | null {
    try {
        const url = new URL(raw.trim());
        if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
        const current = url.searchParams.get('currentJobId');
        if (current && /^\d{6,}$/.test(current)) return current;
        const view = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/);
        return view ? view[1] : null;
    } catch {
        return null;
    }
}

/**
 * The dedupe key for a Scout input. The same link shared twice — from
 * Telegram, then the dashboard — is one run (unique `(userId, inputKey)`).
 */
export function scoutInputKey(input: Pick<ScoutInput, 'url' | 'text'>): string {
    if (input.url) {
        const jobId = linkedinJobId(input.url);
        if (jobId) return `linkedin_job:${jobId}`;
        return `url:${canonicalUrl(input.url)}`;
    }
    const normalized = String(input.text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    return `text:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}
