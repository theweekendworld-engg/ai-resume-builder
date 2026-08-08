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
