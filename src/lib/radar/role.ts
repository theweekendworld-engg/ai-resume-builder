/**
 * Role normalisation for Radar band cells (PRD 04 §2, §4).
 *
 * A band is keyed on (role family, seniority, geo). Getting the key wrong is
 * indistinguishable from getting the arithmetic wrong — the number is
 * confident and false either way.
 *
 * ── Three things real data forced, none of them obvious ──────────────────
 *
 * 1. A MANAGEMENT title must never fall through to an IC default.
 *    "Director of Engineering" and "Engineering Manager - Backend" say
 *    neither "senior" nor "staff", so a naive default swept them into mid and
 *    published a mid median above senior. Hence the guards that run first.
 *
 * 2. IC and management are PARALLEL ladders, not one scale. Measured across
 *    real postings, a first-line Engineering Manager frequently earns less
 *    than a Staff engineer. Ranking the two against each other manufactures
 *    an inversion out of a correct observation — see {@link sameLadder}.
 *
 * 3. An UNLEVELLED title is not evidence of a level. Treating it as mid
 *    produced San Francisco software engineering at mid $308k (n=186) against
 *    senior $196k (n=45), because unlevelled frontier-lab roles paying
 *    $380–555k all landed in mid. It gets its own bucket instead.
 *
 * The through-line: a cell key is only as trustworthy as its least certain
 * component, and inventing certainty is worse than admitting its absence.
 */

export type Seniority =
    | 'intern'
    | 'junior'
    | 'mid'
    | 'senior'
    | 'staff_plus'
    /** People-management ladder. A PARALLEL track, not a rung above staff. */
    | 'manager'
    | 'director_plus'
    /** A real role whose title states no level. Its own bucket — see below. */
    | 'unlevelled'
    /** Not classifiable at all. Excluded from bands. */
    | 'unknown';

/**
 * The IC ladder, in pay order. Comparisons are only meaningful within a track.
 */
export const IC_LADDER: readonly Seniority[] = ['junior', 'mid', 'senior', 'staff_plus'];

/** The management ladder, in pay order. */
export const MANAGEMENT_LADDER: readonly Seniority[] = ['manager', 'director_plus'];

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
/**
 * `i\b` matches a single roman numeral only. `i{1,2}` also matched "II",
 * which is a MID level (L3/L4) — so "Software Engineer II" classified as
 * junior and would have pulled the junior band upward while thinning mid.
 */
const JUNIOR = /\b(junior|jr\.?|associate|new ?grad|entry.?level|graduate|apprentice|i\b|l[12])\b/i;
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
     * Nothing matched: the title states no level.
     *
     * This rule has been wrong twice, each time for a reason only real data
     * showed, and the history is worth keeping because both wrong answers look
     * reasonable.
     *
     *   Returning `unknown` and excluding the posting dropped 62% of real
     *   postings, including ordinary roles like "Product Designer".
     *
     *   Returning `mid` then corrupted the mid band. In San Francisco software
     *   engineering it produced mid $308k (n=186) against senior $196k (n=45).
     *   The cause: every high-paid unlevelled title at a frontier lab —
     *   "Software Engineer, Collective Communication" at $380–555k — landed in
     *   `mid` and dragged the median above senior.
     *
     * The resolution is that an unlevelled title is not evidence of a level at
     * all. It is its own bucket: still banded, still counted, never pooled with
     * roles that DID state a level. A band labelled "level not stated" is a
     * true statement; a mid band containing $555k roles is not.
     */
    return 'unlevelled';
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
 * Are two levels comparable?
 *
 * IC and management are parallel ladders, not one scale. Measured on real
 * postings a first-line Engineering Manager frequently earns LESS than a
 * Staff engineer — that is how the two tracks are actually paid, not a defect.
 * Ranking them against each other would manufacture an inversion out of a
 * correct observation, so callers that compare levels must check this first.
 */
export function sameLadder(a: Seniority, b: Seniority): boolean {
    const ic = (s: Seniority) => IC_LADDER.includes(s);
    const mgmt = (s: Seniority) => MANAGEMENT_LADDER.includes(s);
    return (ic(a) && ic(b)) || (mgmt(a) && mgmt(b));
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
