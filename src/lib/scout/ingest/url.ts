/**
 * What kind of link is this? String parsing only — no network, no model.
 *
 * The answer picks the fetcher, and for job links it also lets `classify`
 * skip its model call entirely: a `/jobs/view/` URL is a job posting, and
 * asking a model to confirm that is paying for a fact we already have.
 */

import { linkedinJobId } from '@/lib/scout/inputKey';
import type { LinkKind } from '@/lib/scout/types';

export type AtsRef =
    | { provider: 'greenhouse'; boardToken: string; jobId: string }
    | { provider: 'lever'; company: string; postingId: string }
    | { provider: 'ashby'; boardToken: string; jobId: string }
    /** Workday has no public JSON API; its pages carry JSON-LD, read generically. */
    | { provider: 'workday' };

export type ClassifiedUrl = {
    url: URL;
    linkKind: Exclude<LinkKind, 'text'>;
    /** Set when linkKind is `linkedin_job`. */
    linkedinJobId: string | null;
    /** Set when linkKind is `ats_job`. */
    ats: AtsRef | null;
};

const RESERVED = new Set(['embed', 'jobs', 'job', 'apply', 'api', 'www', 'static', 'assets', 'search']);

function isLinkedInHost(host: string): boolean {
    return host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in';
}

function atsRefFor(url: URL): AtsRef | null {
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);

    // boards.greenhouse.io/<token>/jobs/<id>, job-boards.greenhouse.io/<token>/jobs/<id>
    if (/(^|\.)greenhouse\.io$/.test(host)) {
        const [token, marker, id] = segments;
        if (token && marker === 'jobs' && id && /^\d+$/.test(id) && !RESERVED.has(token.toLowerCase())) {
            return { provider: 'greenhouse', boardToken: token, jobId: id };
        }
        const ghJid = url.searchParams.get('gh_jid');
        const embedFor = url.searchParams.get('for');
        if (ghJid && embedFor && /^\d+$/.test(ghJid)) {
            return { provider: 'greenhouse', boardToken: embedFor, jobId: ghJid };
        }
        return null;
    }

    // jobs.lever.co/<company>/<uuid>[/apply]
    if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
        const [company, postingId] = segments;
        if (company && postingId && /^[0-9a-f-]{16,}$/i.test(postingId)) {
            return { provider: 'lever', company, postingId };
        }
        return null;
    }

    // jobs.ashbyhq.com/<token>/<uuid>[/application]
    if (host === 'jobs.ashbyhq.com') {
        const [token, jobId] = segments;
        if (token && jobId && /^[0-9a-f-]{16,}$/i.test(jobId)) return { provider: 'ashby', boardToken: token, jobId };
        return null;
    }

    // <tenant>.wd<N>.myworkdayjobs.com/.../job/<location>/<slug>_<reqId>
    if (/\.myworkdayjobs\.com$/.test(host) && segments.includes('job')) return { provider: 'workday' };

    return null;
}

/** Null for anything that is not an http(s) URL. */
export function classifyUrl(raw: string): ClassifiedUrl | null {
    let url: URL;
    try {
        url = new URL(String(raw ?? '').trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    if (isLinkedInHost(host)) {
        const jobId = linkedinJobId(url.toString());
        if (jobId) return { url, linkKind: 'linkedin_job', linkedinJobId: jobId, ats: null };
        if (/^\/posts\//i.test(path) || /^\/feed\/update\/urn:li:(activity|share|ugcPost):/i.test(path)) {
            return { url, linkKind: 'linkedin_post', linkedinJobId: null, ats: null };
        }
        if (/^\/pulse\//i.test(path)) return { url, linkKind: 'linkedin_article', linkedinJobId: null, ats: null };
        if (/^\/company\//i.test(path) || /^\/school\//i.test(path)) {
            return { url, linkKind: 'linkedin_company', linkedinJobId: null, ats: null };
        }
        if (/^\/in\//i.test(path)) return { url, linkKind: 'linkedin_profile', linkedinJobId: null, ats: null };
        return { url, linkKind: 'web', linkedinJobId: null, ats: null };
    }

    const ats = atsRefFor(url);
    if (ats) return { url, linkKind: 'ats_job', linkedinJobId: null, ats };

    return { url, linkKind: 'web', linkedinJobId: null, ats: null };
}
