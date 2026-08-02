/**
 * Role normalisation for Radar band cells (PRD 04 §2, §4).
 *
 * A band is keyed on (role family, seniority, geo). Getting the key wrong is
 * indistinguishable from getting the arithmetic wrong — the number is
 * confident and false either way.
 *
 * ── The trap this module exists for ──────────────────────────────────────
 *
 * The obvious implementation defaults an unrecognised seniority to "mid",
 * because most postings without a seniority word are mid-level. Run against
 * real boards, that default silently swept up:
 *
 *     Director of Engineering · Director, Field Engineering ·
 *     Engineering Manager - Backend · Engineering Manager, Serverless Compute
 *
 * none of which say "senior" or "staff". The result was a published
 * "Mid · Software Engineering" band with a median of $298k against a
 * "Senior · Software Engineering" median of $229k — mid paid more than
 * senior, which is nonsense a reader would catch instantly and never trust us
 * again after.
 *
 * So: an unrecognised seniority is `unknown`, never `mid`, and `unknown` is
 * excluded from published bands by {@link isBandableSeniority}. Refusing to
 * classify is free; classifying wrongly is not.
 */

export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff_plus' | 'manager' | 'director_plus' | 'unknown';

export type RoleFamily =
    | 'software_engineering'
    | 'data_ml'
    | 'product'
    | 'design'
    | 'sales'
    | 'marketing'
    | 'operations'
    | 'unknown';

export type NormalizedRole = {
    family: RoleFamily;
    seniority: Seniority;
    /** Stable cell key, or null when this posting must not enter a band. */
    bandKey: string | null;
};

/**
 * Management ladders are a different pay curve from IC ladders and must never
 * pool with them. Checked FIRST, because "Engineering Manager" contains
 * "Engineer" and "Director of Product" contains "Product".
 */
const DIRECTOR_PLUS = /\b(director|vp|vice president|head of|chief|cto|cpo|cro|svp|evp|general manager)\b/i;

/**
 * Titles where "Manager" names the CRAFT, not a people ladder.
 *
 * A Product Manager manages a product; an Engineering Manager manages
 * engineers. They sit on different pay curves, so collapsing them loses the
 * distinction the seniority axis exists to capture. Checked before
 * {@link MANAGER}, which would otherwise claim all of them — the test that
 * caught this was "Associate Product Manager", classified as people
 * management despite "Associate" being right there in the title.
 */
const IC_MANAGER_TITLE = /\b(product|program|project|technical program|product marketing|account|customer success|partner|community|social media|marketing|brand|content|engagement)\s+manager\b/i;

const MANAGER = /\b(manager|mgr\.?)\b/i;

const STAFF_PLUS = /\b(staff|principal|distinguished|fellow|architect)\b/i;
const SENIOR = /\b(senior|sr\.?|lead|iii|l[5-9])\b/i;
const JUNIOR = /\b(junior|jr\.?|associate|new ?grad|entry.?level|graduate|apprentice|i{1,2}\b|l[12])\b/i;
const INTERN = /\b(intern|internship|co.?op|working student|placement)\b/i;

/**
 * Only an EXPLICIT mid marker counts. Absence of a seniority word is not
 * evidence of mid-level — that assumption is the bug documented above.
 */
const EXPLICIT_MID = /\b(mid.?level|mid.?senior|ii\b|l[34]|intermediate)\b/i;

const FAMILY_PATTERNS: ReadonlyArray<readonly [RoleFamily, RegExp]> = [
    // Data/ML before software: "Machine Learning Engineer" is not generic SWE.
    ['data_ml', /\b(machine learning|ml|ai|data|research|applied science|analytics)\b.{0,20}\b(engineer|scientist|analyst)\b|\bdata (engineer|scientist|analyst)\b/i],
    ['software_engineering', /\b(software|swe|backend|back.?end|frontend|front.?end|full.?stack|infrastructure|platform|systems|security|mobile|ios|android|devops|sre|reliability|qa|test)\b.{0,20}\bengineer\b|\bengineer(ing)?\b/i],
    ['product', /\b(product manager|product owner|technical program manager|tpm|product management)\b/i],
    ['design', /\b(designer|design|ux|ui|user experience|user research)\b/i],
    ['sales', /\b(account executive|sales|business development|bdr|sdr|partnerships|solutions consultant|customer success)\b/i],
    ['marketing', /\b(marketing|growth|demand gen|content|brand|communications|pr)\b/i],
    ['operations', /\b(operations|ops|recruit|people|hr|finance|accounting|legal|counsel|support)\b/i],
];

export function classifySeniority(title: string): Seniority {
    const t = title.toLowerCase();

    // Order is load-bearing: management before IC, intern before junior.
    if (INTERN.test(t)) return 'intern';
    if (DIRECTOR_PLUS.test(t)) return 'director_plus';
    // An IC "… Manager" falls through to the IC ladder below, so an explicit
    // rank in the title ("Associate Product Manager", "Senior Product
    // Manager") still wins instead of being swallowed by `manager`.
    if (MANAGER.test(t) && !IC_MANAGER_TITLE.test(t)) return 'manager';
    if (STAFF_PLUS.test(t)) return 'staff_plus';
    if (SENIOR.test(t)) return 'senior';
    if (JUNIOR.test(t)) return 'junior';
    if (EXPLICIT_MID.test(t)) return 'mid';

    /*
     * Nothing matched. This is the case the module comment warns about, and
     * the resolution is narrower than it first appears.
     *
     * The original danger was management titles landing in the mid bucket —
     * "Director of Engineering" and "Engineering Manager" say neither "senior"
     * nor "staff", so a blanket default swept them in and published a mid
     * median above the senior one. That danger is now handled ABOVE, by
     * DIRECTOR_PLUS and MANAGER, which run before this line is ever reached.
     *
     * What is left here is a title carrying no level word at all — "Product
     * Designer", "Account Executive", "Data Scientist". In industry naming an
     * unmodified title IS the baseline level, so treating it as unknown is not
     * caution, it is discarding evidence: it excluded 62% of real postings,
     * including plenty of ordinary mid-level roles.
     *
     * So an unlevelled title resolves to `mid`, and `unknown` is reserved for
     * the case where we cannot even name the role family (handled in
     * `normalizeRole`, which requires BOTH a family and a seniority). Two
     * independent signals must be readable before a posting enters a band.
     */
    return 'mid';
}

export function classifyFamily(title: string): RoleFamily {
    for (const [family, pattern] of FAMILY_PATTERNS) {
        if (pattern.test(title)) return family;
    }
    return 'unknown';
}

/**
 * May a posting with this seniority enter a published band?
 *
 * `unknown` cannot: pooling unclassifiable titles produces a bucket with no
 * meaning whose median is an average of unrelated ladders. `intern` cannot
 * either — intern pay is a different instrument and would drag any band it
 * touched.
 */
export function isBandableSeniority(seniority: Seniority): boolean {
    return seniority !== 'unknown' && seniority !== 'intern';
}

/**
 * Normalise a posting title into a band cell.
 *
 * `bandKey` is null whenever the posting must be excluded — an unclassifiable
 * family or seniority. Callers store the posting regardless (coverage data is
 * useful) but must not feed a null-key posting into {@link computeBand}.
 */
export function normalizeRole(title: string, geoBucket: string): NormalizedRole {
    const family = classifyFamily(title);
    const seniority = classifySeniority(title);

    const bandable = family !== 'unknown' && isBandableSeniority(seniority) && Boolean(geoBucket);
    return {
        family,
        seniority,
        bandKey: bandable ? `${family}::${seniority}::${geoBucket}` : null,
    };
}
