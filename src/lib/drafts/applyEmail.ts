/**
 * The address a posting says to apply to ("send resumes to jobs@x.com"), read
 * by code from the text the run itself read (docs/impl/07-telegram-apply.md §2).
 *
 * Never from model output: an address a model wrote is an address nobody
 * checked, and the draft goes to whoever it names. The extractor is a regex
 * over the posting text plus a short list of addresses that are on the page
 * but are not where an application goes (noreply, privacy, legal, image
 * names like `logo@2x.png`, placeholders like `name@example.com`).
 *
 * Order matters, because the first address becomes the draft's `To`: an
 * address next to "send your resume" or with a hiring local part (`jobs@`,
 * `careers@`) comes before one that merely appears on the page.
 */

import { dataOf } from '@/lib/scout/section';
import type { ScoutSections } from '@/lib/scout/types';

/** More than this and the page is a directory, not a posting. */
export const MAX_APPLY_EMAILS = 5;

/**
 * Deliberately plain: ASCII local part and domain, a letter-only TLD. The TLD
 * rule is what keeps `jobs@x.com.` from swallowing the full stop.
 */
const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.[a-z]{2,24}/gi;

/** "jobs [at] x [dot] com" and friends. Bare " at " is too common in prose to rewrite. */
function deobfuscate(text: string): string {
    return text
        .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, '@')
        .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.');
}

/** Local parts that are on careers pages but never where an application goes. */
const NOT_APPLY_LOCAL = new Set([
    'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply', 'mailer-daemon',
    'postmaster', 'hostmaster', 'webmaster', 'abuse', 'unsubscribe', 'bounce', 'bounces', 'notifications',
    'privacy', 'legal', 'gdpr', 'dpo', 'dataprotection', 'data-protection', 'dataprivacy', 'compliance',
    'security', 'accessibility', 'accommodation', 'accommodations', 'eeo', 'eeoc',
    'press', 'media', 'pr', 'investors', 'investor', 'ir', 'billing', 'invoice', 'invoices', 'sales', 'support', 'help',
]);

/** Placeholder local parts from "email us at yourname@…" style copy. */
const PLACEHOLDER_LOCAL = /^(your|you|name|yourname|your\.name|firstname|first\.last|firstname\.lastname|john\.?doe|jane\.?doe|user|username|email|someone|test)$/;

/** Domains that are documentation, trackers or the job board itself. */
const NOT_APPLY_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourcompany\.com|company\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|linkedin\.com|licdn\.com|indeed\.com|glassdoor\.com)$/;

/** `logo@2x.png`: an image name with a retina suffix, not an address. */
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|css|js|mjs|json|pdf|mp4|webm|woff2?)$/;

const HIRING_LOCAL = /^(jobs?|careers?|hiring|recruit(ing|ment|er|ers)?|talent|hr|people|apply|applications?|cv|resumes?)([._+-]|$)/;
const APPLY_CONTEXT = /\b(send|email|mail|apply|application|applications|resumes?|cv|cvs|portfolio|interested|reach out|drop|dm)\b/i;

function isApplyCandidate(address: string): boolean {
    const [local, domain] = address.split('@');
    if (!local || !domain) return false;
    if (FILE_TLD.test(domain) || /@\d+x\./.test(address)) return false;
    if (NOT_APPLY_LOCAL.has(local) || NOT_APPLY_LOCAL.has(local.split(/[+.]/)[0])) return false;
    if (PLACEHOLDER_LOCAL.test(local)) return false;
    if (NOT_APPLY_DOMAIN.test(domain)) return false;
    // A long hex/base64 local part is a tracking id (Sentry DSNs, bounce ids).
    if (/^[a-f0-9]{20,}$/.test(local) || local.length > 48) return false;
    return true;
}

/**
 * Every plausible apply address in the text, best first: lowercased, deduped,
 * at most {@link MAX_APPLY_EMAILS}.
 */
export function extractApplyEmails(text: string | null | undefined): string[] {
    if (!text) return [];
    const source = deobfuscate(text);
    const scored = new Map<string, { score: number; at: number }>();
    for (const match of source.matchAll(EMAIL)) {
        const address = match[0].toLowerCase().replace(/^mailto:/, '');
        if (scored.has(address) || !isApplyCandidate(address)) continue;
        const at = match.index ?? 0;
        const around = source.slice(Math.max(0, at - 80), at + address.length + 40);
        const local = address.split('@')[0];
        const score = (APPLY_CONTEXT.test(around) ? 2 : 0) + (HIRING_LOCAL.test(local) ? 1 : 0);
        scored.set(address, { score, at });
    }
    return [...scored.entries()]
        .sort((a, b) => b[1].score - a[1].score || a[1].at - b[1].at)
        .slice(0, MAX_APPLY_EMAILS)
        .map(([address]) => address);
}

/**
 * Any address the USER typed ("send it to hr@acme.in instead"). Looser than
 * {@link extractApplyEmails}: the user is the source, so only shape is checked.
 */
export function extractTypedEmail(text: string | null | undefined): string | null {
    if (!text) return null;
    const match = deobfuscate(text).match(EMAIL)?.[0];
    if (!match) return null;
    const address = match.toLowerCase();
    return FILE_TLD.test(address) ? null : address;
}

/**
 * The run's apply addresses. Read from `jd.applyEmails` when the run stored
 * them, else from the posting text itself: runs stored before the field
 * existed, and short recruiter posts whose JD section was too thin to run
 * ("Hiring an FDE, send CVs to jobs@x.com" is 40 characters), still have
 * the text the address is in.
 */
export function applyEmailsOf(sections: ScoutSections): string[] {
    const stored = dataOf(sections, 'jd')?.applyEmails;
    if (Array.isArray(stored)) return stored;
    return extractApplyEmails(dataOf(sections, 'ingest')?.text);
}
