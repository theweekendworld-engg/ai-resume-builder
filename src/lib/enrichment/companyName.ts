/**
 * Canonical company-name normalisation.
 *
 * Lifted VERBATIM out of `src/lib/extension/company.ts`, where it was private.
 * It now has two callers — the extension insight path and enrichment — and the
 * value it produces is half of `CompanyInsight`'s unique key
 * (`normalizedCompanyName`, `website`). A second, slightly different copy would
 * not throw; it would quietly create a duplicate insight row per company and
 * split every cache hit in two.
 *
 * So: do not "improve" this. Widening the suffix list or changing the character
 * class re-keys every row already written, and the old rows do not move. If it
 * ever must change, that is a migration, not an edit.
 */

/** Keeps dots and hyphens — `crunchbase.com` and `re-flow` survive. */
export function normalizeText(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s.-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Strip the legal suffix so "Stripe, Inc." and "Stripe" are one company.
 *
 * Returns '' for input that normalises to nothing, which callers must treat as
 * "no company name" rather than as a lookup key — an empty key would collide
 * every unnamed company into a single row.
 */
export function normalizeCompanyName(value: string): string {
    return normalizeText(value)
        .replace(/\b(inc|inc\.|llc|ltd|corp|corporation|company|co)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Match key. NOT a storage key — never write this to `normalizedCompanyName`.
 *
 * `normalizeCompanyName` above has a bug that is now frozen into the database:
 * its alternation lists `inc` before `inc\.`, and `\b` matches between the `c`
 * and the `.`, so the bare `inc` wins and the dot survives.
 *
 *     "Stripe, Inc."  →  "stripe ."      (not "stripe")
 *     "Stripe Inc"    →  "stripe"
 *     "Inc."          →  "."
 *
 * So "Stripe" and "Stripe, Inc." are already two separate `CompanyInsight`
 * rows in production. Fixing the function would not merge them — it would
 * strand the old rows under keys nothing computes any more, and quietly reset
 * every cached company.
 *
 * This is therefore a SECOND function, used only where we compare two names we
 * are holding in memory — matching a company against `JobSource.companyName`
 * for the hiring signal. That path is new and has no legacy rows to strand, so
 * it gets the correct behaviour. The storage key stays bug-for-bug compatible
 * until someone writes a migration that rewrites both together.
 */
export function canonicalCompanyKey(value: string): string {
    return normalizeText(value)
        // Longest-first, and the trailing dot consumed as part of the match.
        .replace(/\b(?:incorporated|corporation|inc|llc|ltd|limited|corp|company|co)\b\.?/g, ' ')
        .replace(/[.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The longest token of a normalised name, for a cheap SQL prefilter before
 * exact normalised comparison in JS.
 *
 * Longest rather than first because first is frequently the throwaway half of
 * the name — "the", "open" — while the distinctive token carries the search.
 */
export function longestNameToken(normalized: string): string {
    return normalized
        .split(' ')
        .filter(Boolean)
        .reduce((best, token) => (token.length > best.length ? token : best), '');
}
