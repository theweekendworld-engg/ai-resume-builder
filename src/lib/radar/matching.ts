/**
 * Batch matching: which stored postings would this person plausibly win?
 *
 * PRD 04 §4. Radar's contribution is not a new matcher — it is running the
 * existing one in batch, against the graph instead of a pasted job
 * description. The scoring comes from `computeFitScore` in
 * `src/lib/extension/analyze.ts`, which the extension's single-page analysis
 * also calls, so there is one definition of fit and not two that drift.
 *
 * What Radar deliberately does NOT reuse is the AI job-description parse that
 * sits above that scorer in the extension path. Matching runs over thousands
 * of stored postings whose skills were already extracted deterministically at
 * ingest; re-parsing each with a model would cost thousands of calls per user
 * to reach the same answer, and would break Radar's rule that no model touches
 * this feature.
 *
 * ── Why five ───────────────────────────────────────────────────────────
 *
 * §4 is explicit and worth honouring literally: more than five reads as a job
 * board and triggers "I'm not looking, unsubscribe". Five reads as curation.
 * The cap is a product decision, not a performance one.
 */

import { prisma } from '@/lib/prisma';
import { computeFitScore } from '@/lib/extension/fitScore';
import type { Seniority } from '@/lib/radar/role';

/** §4 — five reads as curation, more reads as a job board. */
export const MATCH_LIMIT = 5;

/** Only postings from the last 30 days are offered. */
const RECENCY_WINDOW_DAYS = 30;

/**
 * A posting must name at least this many recognised skills to be matchable.
 *
 * Without it, sparsity wins. `computeFitScore` works on the RATIO of matched
 * to asked-for skills, so a posting listing one skill the person happens to
 * have scores 1/1 — a perfect 90 — while a rich posting they genuinely fit
 * 6 ways out of 10 scores 62. Run against real postings that put
 * "Growth - Lifecycle Lead" at the top of a backend engineer's matches on the
 * strength of a single `observability` mention.
 *
 * Three is the point where a match is about the role rather than a coincidence.
 */
const MIN_SKILLS_FOR_MATCH = 3;

/**
 * A match must clear this to be shown at all.
 *
 * `computeFitScore` floors at 20, so a posting matching NOTHING still returns
 * a number. Rendering that as a match tells someone "you'd likely win this"
 * on zero evidence — the same unearned claim this product refuses to put in a
 * resume. An empty matches panel is a real answer; five roles at the floor is
 * a lie with a layout.
 */
const MIN_FIT_TO_SHOW = 35;

export type MatchCandidate = {
    postingId: string;
    title: string;
    companyName: string;
    absoluteUrl: string;
    geoBucket: string | null;
    seniority: string | null;
    postedAt: Date | null;
    compAnnualLow: number | null;
    compAnnualHigh: number | null;
    compCurrency: string | null;
    skills: string[];
};

export type Match = {
    posting: MatchCandidate;
    fitScore: number;
    /** Skills the person already evidences. Shown as the reason. */
    matched: string[];
    /** Skills the posting asks for that the log cannot support. */
    missing: string[];
    /** Days since posting, for the recency weighting and the UI. */
    ageDays: number;
};

export type MatchInput = {
    /** Everything the person has actually done, as one searchable string. */
    corpus: string;
    /** Geo buckets the person will consider. Empty means anywhere. */
    geoBuckets: readonly string[];
    /** Levels worth showing them. Empty means any. */
    seniorities: readonly Seniority[];
    /**
     * Role families to stay within. Empty means any, but callers should almost
     * always set it: without it a backend engineer is offered "Manager,
     * Strategic Finance" because both mention SQL.
     */
    roleFamilies: readonly string[];
    /** Companies to leave out: current employer, and anything already tracked. */
    excludeCompanies: readonly string[];
};

/**
 * Rank a candidate.
 *
 * Fit dominates, recency breaks ties. A posting from yesterday and one from
 * four weeks ago are both live, so recency is a light thumb on the scale
 * rather than a second axis — ranking mostly by freshness would surface
 * whatever was posted this morning regardless of whether the person could win
 * it.
 */
function rank(fitScore: number, ageDays: number): number {
    const freshness = 1 - Math.min(ageDays, RECENCY_WINDOW_DAYS) / RECENCY_WINDOW_DAYS;
    return fitScore + freshness * 5;
}

function normalizeCompany(name: string): string {
    return name.trim().toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|llc|ltd|corp|co)\b/g, '').trim();
}

/**
 * Load postings that pass the hard filters, before scoring.
 *
 * The filters are applied in the QUERY rather than after loading, so a person
 * in London never has thousands of San Francisco postings pulled into memory
 * to be discarded.
 */
export async function loadCandidates(
    input: MatchInput,
    limit = 500,
): Promise<MatchCandidate[]> {
    const since = new Date(Date.now() - RECENCY_WINDOW_DAYS * 86_400_000);

    const rows = await prisma.jobPosting.findMany({
        where: {
            closedAt: null,
            postedAt: { gte: since },
            bandKey: { not: null },
            ...(input.geoBuckets.length > 0 ? { geoBucket: { in: [...input.geoBuckets] } } : {}),
            ...(input.seniorities.length > 0 ? { seniority: { in: [...input.seniorities] } } : {}),
            ...(input.roleFamilies.length > 0 ? { roleFamily: { in: [...input.roleFamilies] } } : {}),
        },
        orderBy: { postedAt: 'desc' },
        take: limit,
        select: {
            id: true,
            title: true,
            absoluteUrl: true,
            geoBucket: true,
            seniority: true,
            postedAt: true,
            compAnnualLow: true,
            compAnnualHigh: true,
            compCurrency: true,
            skills: true,
            source: { select: { companyName: true } },
        },
    });

    const excluded = new Set(input.excludeCompanies.map(normalizeCompany));

    return rows.flatMap((row) => {
        const companyName = row.source.companyName ?? '';
        if (excluded.has(normalizeCompany(companyName))) return [];
        return [
            {
                postingId: row.id,
                title: row.title,
                companyName,
                absoluteUrl: row.absoluteUrl,
                geoBucket: row.geoBucket,
                seniority: row.seniority,
                postedAt: row.postedAt,
                compAnnualLow: row.compAnnualLow,
                compAnnualHigh: row.compAnnualHigh,
                compCurrency: row.compCurrency,
                skills: Array.isArray(row.skills)
                    ? (row.skills as unknown[]).filter((s): s is string => typeof s === 'string')
                    : [],
            },
        ];
    });
}

/**
 * Score and rank candidates. Pure — no database, no network, no model.
 *
 * Postings naming fewer than {@link MIN_SKILLS_FOR_MATCH} recognised skills are
 * dropped rather than scored, because a ratio over a tiny denominator is not a
 * measurement — it is a coincidence with a confident number attached.
 */
export function rankCandidates(candidates: MatchCandidate[], input: MatchInput): Match[] {
    const now = Date.now();

    return candidates
        .flatMap((posting) => {
            // Too little evidence to rank honestly — see MIN_SKILLS_FOR_MATCH.
            if (posting.skills.length < MIN_SKILLS_FOR_MATCH) return [];

            const { fitScore, matchedRequired, missingRequired } = computeFitScore({
                // Stored postings carry one skill list, not a required/preferred
                // split — boards rarely make that distinction cleanly enough to
                // trust. Treating them all as required is the conservative
                // reading: it makes a high score harder to earn.
                requiredSkills: posting.skills,
                preferredSkills: [],
                corpus: input.corpus,
            });

            const ageDays = posting.postedAt
                ? Math.max(0, Math.floor((now - posting.postedAt.getTime()) / 86_400_000))
                : RECENCY_WINDOW_DAYS;

            return [{ posting, fitScore, matched: matchedRequired, missing: missingRequired, ageDays }];
        })
        .filter((match) => match.fitScore >= MIN_FIT_TO_SHOW)
        .sort((a, b) => rank(b.fitScore, b.ageDays) - rank(a.fitScore, a.ageDays))
        .slice(0, MATCH_LIMIT);
}

/** Load, filter, score, and take the top five. */
export async function findMatches(input: MatchInput): Promise<Match[]> {
    return rankCandidates(await loadCandidates(input), input);
}
