/**
 * "Do they hire from India?" — answered from postings, not from a vendor.
 *
 * This is the question that started the feature, and it is the one most likely
 * to be answered with a confident fabrication. Ask a model and it will tell you
 * whether a company sponsors visas or hires in India; it does not know, the
 * answer is not in any document it read, and the user cannot tell the guess
 * apart from the fact. Buy it from an enrichment vendor and you get a
 * `hq_country` field that says nothing about where they are hiring NOW.
 *
 * So it is computed here, arithmetically, over `JobPosting` rows we already
 * ingested — the same rule Radar operates under (`src/lib/radar/band.ts`): no
 * model produces the figure, and every figure ships with its `n`, its window
 * and its geography.
 *
 * ── The asymmetry, which is the whole design ────────────────────────────────
 *
 * Presence and absence are not the same claim and must not share a threshold.
 *
 *   PRESENCE is an existence proof. One posting located in Bengaluru is a fact
 *   with a URL attached — "they posted this role, there, on this date". It
 *   needs no statistical floor because it is not a statistic, and so it ships
 *   with the postings themselves rather than a rate. `MIN_OBSERVATIONS = 8`
 *   governs bands because a band is an average; citing a document is not.
 *
 *   ABSENCE is a statistical claim, and a far heavier one. "No India roles" out
 *   of 4 postings is noise. Out of 60 it is a signal. Absence therefore needs a
 *   large DENOMINATOR before it may be asserted at all, and below that floor
 *   this module returns a refusal rather than a reassuring "no".
 *
 * Collapsing the two is how a tool ends up telling someone a company does not
 * hire in their country on the strength of three postings.
 *
 * ── The scope caveat is part of the answer, not a footnote ──────────────────
 *
 * We observe Greenhouse and Ashby boards (`src/lib/radar/boards.ts`). A company
 * hiring in India through Naukri, a staffing firm, or referrals — and not
 * through the board we poll — is invisible here and will read as an absence.
 * That is why `scope` is a field on the result and not a sentence in a doc: any
 * surface rendering the negative has to render what it is a negative ABOUT.
 */

import { prisma } from '@/lib/prisma';
import { canonicalCompanyKey, longestNameToken } from '@/lib/enrichment/companyName';
import { normalizeGeo } from '@/lib/radar/geo';

/** Matches Radar's window. Older postings describe a company that has moved on. */
export const HIRING_WINDOW_DAYS = 180;

/**
 * Denominator required before "no observed hiring there" may be stated.
 *
 * Twenty, not eight. The band floor of 8 is about estimating a middle from a
 * sample; this is about asserting a zero, and a zero out of 8 is entirely
 * ordinary for a company that posts a handful of roles a quarter. Twenty is
 * where the absence starts carrying information rather than reflecting how
 * little we happened to fetch.
 */
export const MIN_POSTINGS_FOR_ABSENCE = 20;

/** Enough to prove the point; a wall of links is not more convincing. */
export const MAX_CITATIONS = 5;

/**
 * Geography → the `normalizeGeo` buckets that count as being in it.
 *
 * Written out rather than derived from `geo.ts`'s internal tables, which are
 * private, and then pinned by a test that runs real location strings through
 * `normalizeGeo` and asserts they land in these sets. Without that test this is
 * exactly the kind of second copy that drifts: someone adds `chennai` to the
 * metro table, it never appears here, and India hiring quietly under-counts.
 */
export const GEOGRAPHY_BUCKETS: Record<string, { region: string; metros: readonly string[] }> = {
    india: { region: 'india', metros: ['bengaluru', 'hyderabad', 'mumbai', 'delhi', 'pune'] },
    us: {
        region: 'us',
        metros: ['nyc', 'sf_bay', 'seattle', 'los_angeles', 'austin', 'boston', 'chicago', 'denver', 'atlanta'],
    },
    uk: { region: 'uk', metros: ['london'] },
    canada: { region: 'canada', metros: ['toronto', 'vancouver'] },
    germany: { region: 'germany', metros: ['berlin', 'munich'] },
    singapore: { region: 'singapore', metros: ['singapore'] },
};

/**
 * Every bucket spelling that places a posting inside a geography.
 *
 * `remote_*` counts: a remote role scoped to India is a role they will hire an
 * India-based person into, which is the question actually being asked. A
 * `multi_*` bucket scoped to the region counts for the same reason — the
 * employer named the region themselves.
 */
export function bucketsForGeography(geography: string): Set<string> {
    const entry = GEOGRAPHY_BUCKETS[geography];
    if (!entry) return new Set();

    const buckets = new Set<string>([entry.region, `remote_${entry.region}`, `multi_${entry.region}`]);
    for (const metro of entry.metros) {
        buckets.add(metro);
        buckets.add(`remote_${metro}`);
    }
    return buckets;
}

export type HiringObservation = {
    /** Precomputed at ingest. Falls back to `location` when absent. */
    geoBucket: string | null;
    location: string | null;
    postedAt: Date | null;
    title: string;
    absoluteUrl: string;
};

export type HiringCitation = {
    title: string;
    location: string | null;
    absoluteUrl: string;
    postedAt: Date | null;
};

export type HiringSignal = {
    geography: string;
    /**
     * `hires_there` is backed by `citations`. `no_observed_hiring` is backed by
     * `placeable` being large enough that the zero means something.
     */
    verdict: 'hires_there' | 'no_observed_hiring';
    /** Postings inside the geography. */
    matched: number;
    /** Postings whose location could be placed at all. The real denominator. */
    placeable: number;
    /** Postings in the window, including ones we could not place. */
    total: number;
    /** `matched / placeable`, rounded. Zero when nothing was placeable. */
    share: number;
    windowStart: Date;
    windowEnd: Date;
    latestMatchAt: Date | null;
    /** Which cities, descending. Turns "yes" into "yes, in Bengaluru and Pune". */
    buckets: Array<{ bucket: string; n: number }>;
    /** Populated only for `hires_there`: the evidence, by URL. */
    citations: HiringCitation[];
    /** What this is a claim ABOUT. Must be rendered alongside a negative. */
    scope: 'observed_public_boards';
};

export type HiringRefusal =
    | { reason: 'no_postings'; total: 0 }
    /** We have postings but could not place any of them geographically. */
    | { reason: 'no_placeable_locations'; total: number; placeable: 0 }
    /** Zero matches, but too few postings for the zero to mean anything. */
    | { reason: 'insufficient_for_absence'; total: number; placeable: number; needed: number };

export type HiringResult =
    | { ok: true; signal: HiringSignal }
    | { ok: false; refusal: HiringRefusal };

/**
 * Compute the signal, or an explained refusal.
 *
 * Pure — no database, no clock beyond what is passed in — so the asymmetry
 * above can be tested exhaustively without fixtures. The query layer is
 * `getCompanyHiringSignal` below.
 */
export function computeHiringSignal(
    observations: readonly HiringObservation[],
    params: { geography: string; windowStart: Date; windowEnd: Date },
): HiringResult {
    if (observations.length === 0) {
        return { ok: false, refusal: { reason: 'no_postings', total: 0 } };
    }

    const wanted = bucketsForGeography(params.geography);
    const counts = new Map<string, number>();
    const matches: HiringObservation[] = [];
    let placeable = 0;

    for (const observation of observations) {
        // Prefer the bucket computed at ingest; re-normalise only when it is
        // missing, so a posting stored before `geoBucket` existed still counts.
        const bucket = observation.geoBucket ?? normalizeGeo(observation.location).bucket;
        if (!bucket) continue;
        placeable += 1;

        if (!wanted.has(bucket)) continue;
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
        matches.push(observation);
    }

    if (placeable === 0) {
        return {
            ok: false,
            refusal: { reason: 'no_placeable_locations', total: observations.length, placeable: 0 },
        };
    }

    const byRecency = [...matches].sort(
        (a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0),
    );

    // ── presence: an existence proof, so one is enough and it ships its source.
    if (matches.length > 0) {
        return {
            ok: true,
            signal: {
                geography: params.geography,
                verdict: 'hires_there',
                matched: matches.length,
                placeable,
                total: observations.length,
                share: Number((matches.length / placeable).toFixed(3)),
                windowStart: params.windowStart,
                windowEnd: params.windowEnd,
                latestMatchAt: byRecency[0]?.postedAt ?? null,
                buckets: [...counts.entries()]
                    // Ties broken by name so the output is deterministic.
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .map(([bucket, n]) => ({ bucket, n })),
                citations: byRecency.slice(0, MAX_CITATIONS).map((o) => ({
                    title: o.title,
                    location: o.location,
                    absoluteUrl: o.absoluteUrl,
                    postedAt: o.postedAt,
                })),
                scope: 'observed_public_boards',
            },
        };
    }

    // ── absence: a statistical claim, and it needs the denominator for one.
    if (placeable < MIN_POSTINGS_FOR_ABSENCE) {
        return {
            ok: false,
            refusal: {
                reason: 'insufficient_for_absence',
                total: observations.length,
                placeable,
                needed: MIN_POSTINGS_FOR_ABSENCE,
            },
        };
    }

    return {
        ok: true,
        signal: {
            geography: params.geography,
            verdict: 'no_observed_hiring',
            matched: 0,
            placeable,
            total: observations.length,
            share: 0,
            windowStart: params.windowStart,
            windowEnd: params.windowEnd,
            latestMatchAt: null,
            buckets: [],
            citations: [],
            scope: 'observed_public_boards',
        },
    };
}

/**
 * Sentence for the signal, with its provenance inline.
 *
 * The `n`, the window and the scope are in the string itself rather than left
 * to a caller to remember, because the sentence travels — into a WhatsApp
 * reply, an email, a card — and the caveat has to travel with it.
 */
export function describeHiringSignal(signal: HiringSignal): string {
    const days = Math.max(
        1,
        Math.round((signal.windowEnd.getTime() - signal.windowStart.getTime()) / 86_400_000),
    );
    const geo = signal.geography.toUpperCase();

    if (signal.verdict === 'hires_there') {
        const where = signal.buckets.map((b) => `${b.bucket} (${b.n})`).join(', ');
        return `Yes — ${signal.matched} of ${signal.placeable} located roles on their public board in the last ${days} days were in ${geo}: ${where}.`;
    }

    return `No ${geo}-located roles among ${signal.placeable} located postings on their public board in the last ${days} days. This covers only the boards we poll, so it is not evidence they never hire there.`;
}

/** Why we declined to answer, in the user's words rather than an enum. */
export function describeHiringRefusal(refusal: HiringRefusal, geography: string): string {
    const geo = geography.toUpperCase();
    switch (refusal.reason) {
        case 'no_postings':
            return `No postings observed for this company yet, so there is nothing to say about ${geo} hiring.`;
        case 'no_placeable_locations':
            return `${refusal.total} postings observed, but none stated a location we could place. No ${geo} read is possible.`;
        case 'insufficient_for_absence':
            return `No ${geo} roles seen, but only ${refusal.placeable} located postings — under the ${refusal.needed} needed before absence means anything. Treat this as unknown, not as a no.`;
    }
}

/**
 * Resolve the `JobSource` rows belonging to a company.
 *
 * `JobSource.companyName` is stored raw and has no index, so this prefilters in
 * SQL on the most distinctive token and then compares NORMALISED names in JS.
 * Comparing raw names in SQL would miss "Stripe, Inc." against "Stripe"; a full
 * scan normalised in JS would work but grows with every board we add.
 */
async function findCompanySourceIds(companyName: string): Promise<string[]> {
    // `canonicalCompanyKey`, not `normalizeCompanyName` — the storage key has a
    // frozen suffix bug that would make "Stripe, Inc." fail to match the
    // "Stripe" board and silently report no postings. See companyName.ts.
    const canonical = canonicalCompanyKey(companyName);
    if (!canonical) return [];

    const token = longestNameToken(canonical);
    if (!token) return [];

    const candidates = await prisma.jobSource.findMany({
        where: { companyName: { contains: token, mode: 'insensitive' } },
        select: { id: true, companyName: true },
    });

    return candidates
        .filter((row) => canonicalCompanyKey(row.companyName) === canonical)
        .map((row) => row.id);
}

/**
 * The signal for a company, from our own observed postings.
 *
 * Closed postings are deliberately INCLUDED. The question is whether they hire
 * in this geography, and a role that was posted in Bengaluru and has since been
 * filled is evidence for that, not against it. Excluding them would bias the
 * answer toward whatever happens to be open this week.
 */
export async function getCompanyHiringSignal(params: {
    companyName: string;
    geography?: string;
    windowDays?: number;
    now?: Date;
}): Promise<HiringResult> {
    const geography = params.geography ?? 'india';
    const windowEnd = params.now ?? new Date();
    const windowStart = new Date(
        windowEnd.getTime() - (params.windowDays ?? HIRING_WINDOW_DAYS) * 86_400_000,
    );

    const sourceIds = await findCompanySourceIds(params.companyName);
    if (sourceIds.length === 0) {
        return { ok: false, refusal: { reason: 'no_postings', total: 0 } };
    }

    const postings = await prisma.jobPosting.findMany({
        where: {
            sourceId: { in: sourceIds },
            // Postings with no posted date cannot be placed in the window, and
            // silently treating them as recent would inflate the denominator.
            postedAt: { gte: windowStart, lte: windowEnd },
        },
        select: {
            geoBucket: true,
            location: true,
            postedAt: true,
            title: true,
            absoluteUrl: true,
        },
    });

    return computeHiringSignal(postings, { geography, windowStart, windowEnd });
}

/**
 * `HiringResult` → the wire shape in `ExtensionHiringSignalSchema`.
 *
 * The `statement` is built here rather than on the client so that every surface
 * — extension card, dashboard, a chat reply — quotes the same sentence with the
 * same caveats. A caveat that each client re-writes is a caveat one of them
 * will eventually drop.
 */
export function toWireHiringSignal(result: HiringResult, geography: string) {
    if (result.ok) {
        const s = result.signal;
        return {
            ok: true as const,
            geography: s.geography,
            verdict: s.verdict,
            matched: s.matched,
            placeable: s.placeable,
            total: s.total,
            share: s.share,
            windowStart: s.windowStart.toISOString(),
            windowEnd: s.windowEnd.toISOString(),
            latestMatchAt: s.latestMatchAt ? s.latestMatchAt.toISOString() : null,
            buckets: s.buckets,
            citations: s.citations.map((c) => ({
                title: c.title,
                location: c.location,
                absoluteUrl: c.absoluteUrl,
                postedAt: c.postedAt ? c.postedAt.toISOString() : null,
            })),
            scope: s.scope,
            statement: describeHiringSignal(s),
        };
    }

    const r = result.refusal;
    return {
        ok: false as const,
        geography,
        reason: r.reason,
        total: r.total,
        placeable: r.reason === 'no_postings' ? 0 : r.placeable,
        ...(r.reason === 'insufficient_for_absence' ? { needed: r.needed } : {}),
        statement: describeHiringRefusal(r, geography),
    };
}
