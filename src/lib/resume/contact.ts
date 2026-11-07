/**
 * The contact line, as links.
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 *
 * The LaTeX template built `\href{...}{GitHub}` from `personalInfo.github`,
 * and the live HTML preview rendered `pi.github && 'GitHub'` — the word, with
 * the URL discarded. So the document the user edited had dead contact text and
 * the document they exported had working links, and only one of those is the
 * resume a recruiter clicks.
 *
 * One function, both renderers.
 *
 * ── Why the labels, not the URLs ────────────────────────────────────────────
 *
 * "LinkedIn" reads better than "linkedin.com/in/priya-raman-8a41b2" and costs
 * a recruiter nothing — the href carries the address. The one exception is
 * email, where the address IS the useful text.
 */

export type ContactPart = {
    label: string;
    /** Absent for plain text like a location. */
    href?: string;
};

/**
 * Accepts a bare handle, a domain, or a full URL.
 *
 * Users paste all three. `linkedin.com/in/x`, `www.linkedin.com/in/x` and
 * `https://linkedin.com/in/x` must all produce a link that works — a resume
 * whose links 404 is worse than one with none.
 */
export function normalizeUrl(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^www\./i.test(value)) return `https://${value}`;
    // A bare domain — it has a dot and no spaces.
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
    return null;
}

export function contactParts(personalInfo: {
    location?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    website?: string;
}): ContactPart[] {
    const parts: ContactPart[] = [];

    if (personalInfo.location?.trim()) parts.push({ label: personalInfo.location.trim() });
    if (personalInfo.email?.trim()) {
        const email = personalInfo.email.trim();
        parts.push({ label: email, href: `mailto:${email}` });
    }
    if (personalInfo.phone?.trim()) {
        const phone = personalInfo.phone.trim();
        parts.push({ label: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` });
    }

    for (const [label, raw] of [
        ['LinkedIn', personalInfo.linkedin],
        ['GitHub', personalInfo.github],
        ['Portfolio', personalInfo.website],
    ] as const) {
        const value = raw?.trim();
        if (!value) continue;
        const href = normalizeUrl(value);
        // A value we cannot turn into a URL still tells the reader something,
        // so it renders as text rather than vanishing.
        parts.push(href ? { label, href } : { label: value });
    }

    return parts;
}

/** "https://www.github.com/jai0651/" → "github.com/jai0651". */
export function displayUrl(href: string): string {
    return href
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '');
}

/** A printed address longer than this reads as noise; the site's name is printed instead. */
const MAX_PRINTED_URL = 48;

/**
 * The contact block as two lines, for the compact template and its preview:
 * place, phone and email, then the web links printed as addresses
 * ("github.com/jai0651"), which is what the reader of a printed page can use.
 * An address too long to read falls back to the site's name.
 */
export function contactLines(personalInfo: {
    location?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    website?: string;
}): { details: ContactPart[]; links: ContactPart[] } {
    const details: ContactPart[] = [];
    if (personalInfo.location?.trim()) details.push({ label: personalInfo.location.trim() });
    if (personalInfo.phone?.trim()) details.push({ label: personalInfo.phone.trim() });
    if (personalInfo.email?.trim()) {
        const email = personalInfo.email.trim();
        details.push({ label: email, href: `mailto:${email}` });
    }

    const links: ContactPart[] = [];
    for (const [name, raw] of [
        ['LinkedIn', personalInfo.linkedin],
        ['GitHub', personalInfo.github],
        ['Portfolio', personalInfo.website],
    ] as const) {
        const value = raw?.trim();
        if (!value) continue;
        const href = normalizeUrl(value);
        if (!href) {
            links.push({ label: value });
            continue;
        }
        const printed = displayUrl(href);
        links.push({ label: printed && printed.length <= MAX_PRINTED_URL ? printed : name, href });
    }
    return { details, links };
}

export type ProjectLink = { label: string; href: string };

/**
 * The `[Live]` / `[Repo]` links beside a project title.
 *
 * The LaTeX template rendered these in blue; the live HTML preview rendered
 * nothing at all — the same split that left the contact line dead in one
 * renderer and working in the other. A project whose repo link only exists in
 * the exported PDF is a project the reader cannot open from the document they
 * were shown.
 *
 * `[Live]` first: a working thing beats source, and it is the one a
 * non-engineer reader will click.
 */
export function projectLinks(project: {
    liveUrl?: string | null;
    repoUrl?: string | null;
    url?: string | null;
}): ProjectLink[] {
    const links: ProjectLink[] = [];
    for (const [label, raw] of [
        ['Live', project.liveUrl],
        ['Repo', project.repoUrl],
    ] as const) {
        const href = normalizeUrl((raw ?? '').trim());
        if (href) links.push({ label, href });
    }

    // `url` is the legacy single field. Only used when neither of the specific
    // ones is set, so an older project row still links somewhere.
    if (links.length === 0) {
        const href = normalizeUrl((project.url ?? '').trim());
        if (href) links.push({ label: 'Link', href });
    }

    return links;
}
